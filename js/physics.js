// physics.js
// 軽量な環境物理(cannon-es)。three.js・DOM・シーンに依存しない(レンダリングとは分離)。
//
// ■ 設計原則(ARCHITECTURE.mdにも記録):
//   世界は基本的に「静的」。物理はイベント駆動で、相互作用が必要な時だけ、必要な物体にだけ
//   局所的に起動する。静止したら物理世界から外れ、静的に戻る。
//
//   STATIC ──(持ち上げる/引き金)──▶ HELD ──(離す)──▶ DYNAMIC ──(静止/スリープ)──▶ STATIC
//
//   ・何も起きていない時、物理世界のボディは0個で、step() は何もしない(コストゼロ)。
//   ・動的になる物体は、起こした物体だけ。他の静的な物体を全部起こさない。
//   ・動的な物体の「すぐ近く」にある静的な物体だけが、衝突相手(質量0の静的ボディ)として
//     一時的に物理世界へ入る(動かない。連鎖反応で起こす仕組みは wakeOnImpact で後から足せる)。
//   ・地面は、動的な物体の周りの小さな範囲だけ、地形の高さから作った Heightfield を使う。
//     地形全体を物理に入れない。
//   ・必ず静止して静的に戻る(スリープ、または最大動作時間でのタイムアウト、または地面抜けの救済)。
//
// 物理の状態(physicsState)と、ゲーム上の「できること」(stable/bridgeable/climbable/walkable)は
// 別のデータ。ここでは前者と stable だけを扱い、後者は affordances 側(次のフェーズ)が決める。

import * as CANNON from 'cannon-es';

export const PHYSICS_DEFAULTS = {
  gravity: -9.8,
  fixedStep: 1 / 60,
  maxSubSteps: 5,
  density: 400,            // kg/m^3(木)。質量は 体積×密度
  friction: 0.6,
  restitution: 0.05,
  linearDamping: 0.05,
  angularDamping: 0.85,    // 高め: 丸太は転がり続けず、斜面でも止まる(実測で約2.4秒で静止)
  sleepSpeedLimit: 0.12,
  sleepTimeLimit: 0.6,
  restSpeed: 0.08,         // v1.49: これ未満の並進速度が restTimeLimit 続いたら静止とみなす
  restAngular: 0.35,
  restTimeLimit: 0.8,
  brakedRestSpeed: 1.0,    // ブレーキ最大の後は、この速さ未満(m/s)になれば止まったとみなす
  brakedRestAngular: 4.0,
  brakeStart: 2.5,         // v1.49: これ以降、減衰を強めて転がりを自然に止める
  brakeRamp: 3,
  brakeAngular: 0.999,
  brakeLinear: 0.97,
  brakeDistance: 2.5,      // 動き出した位置からこれ以上(水平距離m)転がったら、同様にブレーキを強める
  brakeDistanceRamp: 2,
  impactMinSpeed: 0.3,     // v1.56-H3: これ未満の衝突速度は「衝突」として通知しない
  impactMinGap: 0.05,      // v1.56-H3: 同じ丸太の連続通知の最小間隔(秒)
  sustainTolerance: 0.05,  // v1.52: 重さの5%まで足りなくても、つり合っているとみなす(宙に浮かせ続ける)
  maxAltitude: 400,        // v1.52: 地面からこれ以上高く昇った物体は、物理の対象から外す(空へ消えた扱い)
  maxDynamicTime: 12,      // これを超えたら強制的に静止扱いにして静的へ戻す(必ず戻る)
  neighborRadius: 4,       // 動的な物体からこの距離内の静的な物体だけ、衝突相手として入れる
  patchStep: 0.25,         // 地面パッチの格子間隔(m)
  patchMargin: 4,          // 動的な物体の周りに確保する地面の余白(m)
  patchRebuildMargin: 1.5, // 物体がパッチの縁からこれ以内に来たら作り直す
  minPatchHalf: 5,
};

const _v = new CANNON.Vec3();

export function createPhysics({ groundHeightAt, options = {}, now = () => performance.now() / 1000 } = {}) {
  if (typeof groundHeightAt !== 'function') throw new Error('createPhysics: groundHeightAt(x,z) が必要です');
  const P = { ...PHYSICS_DEFAULTS, ...options };
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, P.gravity, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.NaiveBroadphase(); // ボディは常にごく少数なので十分
  const material = new CANNON.Material('wood-ground');
  world.defaultContactMaterial = new CANNON.ContactMaterial(material, material, { friction: P.friction, restitution: P.restitution });

  /** @type {Map<string, any>} id -> 記録 */
  const objects = new Map();
  const bodies = new Map();         // 動的ボディ id -> CANNON.Body
  // v1.69: 接着した丸太の塊(グループ)。塊は、動いている間は「複数の円柱を持つ1つの剛体」として物理を進める
  //   (関節でつなぐ方式ではないので、つなぎ目がぐらつかず、積んだ櫓が崩れない)。静止したら、また1本ずつの静的な物へ戻る。
  //   id -> { id, leaderId, ids:[...], rel: Map(id -> {p,q}) (leaderの姿勢から見た各丸太の相対姿勢), props }
  const groups = new Map();
  let nextGroupId = 1;
  const qmul = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
  const qconj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
  const qnorm = (q) => { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; };
  const qrot = (q, v) => {
    const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z, iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z;
    return { x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x };
  };
  const neighborBodies = new Map(); // 衝突相手の静的ボディ id -> CANNON.Body
  // v1.49: 世界の静的コライダー(木・岩・テント・焚き火など)。見た目より大幅に単純な形(円柱・角柱)。
  // 登録しただけでは物理世界に入れない。動的な物体の近くにある物だけを、その間だけ入れる(局所起動)。
  const staticColliders = new Map(); // id -> { id, kind, x, y, z, reach, ... }
  const colliderBodies = new Map();  // 今、物理世界に入っているコライダー id -> CANNON.Body
  const GRID = 8;                    // 空間ハッシュの格子(m)。コライダーが数百個あっても近傍検索は一定
  const grid = new Map();
  const cellKey = (i, j) => i * 100003 + j;
  let patch = null;                 // { body, x0, x1, z0, z1 }
  let accumulator = 0;
  let simTime = 0;
  const stats = { steps: 0, settled: 0, woke: 0, patchBuilds: 0, failsafes: 0, timeouts: 0, depenetrated: 0, sustainedSteps: 0, ceilings: 0 };
  const listeners = { woke: [], settled: [], held: [], released: [], impact: [] }; // v1.56-H3: impact = 衝突(音用)
  const emit = (ev, rec) => { for (const fn of listeners[ev]) fn(rec); };

  const copyPose = (rec, p, q) => { rec.position = { x: p.x, y: p.y, z: p.z }; rec.quaternion = { x: q.x, y: q.y, z: q.z, w: q.w }; };

  function makeBody(rec, mass) {
    const shape = new CANNON.Cylinder(rec.radiusTop, rec.radiusBottom, rec.length, 8);
    const body = new CANNON.Body({
      mass, shape, material,
      allowSleep: mass > 0,
      sleepSpeedLimit: P.sleepSpeedLimit,
      sleepTimeLimit: P.sleepTimeLimit,
      linearDamping: P.linearDamping,
      angularDamping: P.angularDamping,
    });
    body.position.set(rec.position.x, rec.position.y, rec.position.z);
    body.quaternion.set(rec.quaternion.x, rec.quaternion.y, rec.quaternion.z, rec.quaternion.w);
    body.userData = { kind: 'log', id: rec.id, dynamic: mass > 0 };
    if (mass > 0) body.addEventListener('collide', (e) => onCollide(rec, body, e)); // 動く丸太だけが聞く(静的な相手の側は聞かない)
    return body;
  }
  /** v1.69: 接着した丸太の塊を、1つの剛体にする(円柱を、leaderから見た相対姿勢で並べる)。 */
  function makeGroupBody(G) {
    const leader = objects.get(G.leaderId);
    let mass = 0;
    const body = new CANNON.Body({
      mass: 1, material, allowSleep: true,
      sleepSpeedLimit: P.sleepSpeedLimit, sleepTimeLimit: P.sleepTimeLimit,
      linearDamping: P.linearDamping, angularDamping: P.angularDamping,
    });
    for (const id of G.ids) {
      const m = objects.get(id), r = G.rel.get(id);
      mass += massOf(m);
      body.addShape(new CANNON.Cylinder(m.radiusTop, m.radiusBottom, m.length, 8), new CANNON.Vec3(r.p.x, r.p.y, r.p.z), new CANNON.Quaternion(r.q.x, r.q.y, r.q.z, r.q.w));
    }
    body.mass = mass; body.updateMassProperties();
    body.position.set(leader.position.x, leader.position.y, leader.position.z);
    body.quaternion.set(leader.quaternion.x, leader.quaternion.y, leader.quaternion.z, leader.quaternion.w);
    body.userData = { kind: 'log', id: leader.id, dynamic: true, group: true };
    body.addEventListener('collide', (e) => onCollide(leader, body, e));
    return body;
  }
  /** v1.69: leaderの姿勢から、塊の全員の姿勢を決め直す。 */
  function applyLeaderPose(G, lp, lq) {
    const q0 = qnorm(lq);
    for (const id of G.ids) {
      const m = objects.get(id), r = G.rel.get(id);
      const o = qrot(q0, r.p);
      m.position = { x: lp.x + o.x, y: lp.y + o.y, z: lp.z + o.z };
      m.quaternion = qnorm(qmul(q0, r.q));
    }
  }
  /** v1.69: 今の姿勢(全員が整合している時)から、leaderから見た相対姿勢を取り直す。 */
  function rebuildGroup(G) {
    const L = objects.get(G.leaderId), ic = qconj(L.quaternion);
    G.rel = new Map();
    for (const id of G.ids) {
      const m = objects.get(id);
      const d = { x: m.position.x - L.position.x, y: m.position.y - L.position.y, z: m.position.z - L.position.z };
      G.rel.set(id, { p: qrot(ic, d), q: qnorm(qmul(ic, m.quaternion)) });
    }
    let reach = 0;
    for (const id of G.ids) { const m = objects.get(id), r = G.rel.get(id); reach = Math.max(reach, Math.hypot(r.p.x, r.p.y, r.p.z) + m.length / 2 + m.radiusBottom); }
    G.reach = reach;
  }
  /**
   * v1.56-H3: 衝突の通知(効果音用)。衝突方向の速さが小さい接触(転がり・静止中の細かい振動)は通知しない。
   * 動く丸太どうしの衝突は、両方から来るので、idが小さい方だけが通知する(1回だけ)。
   */
  function onCollide(rec, body, e) {
    if (!listeners.impact.length || !e || !e.contact) return;
    const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (!(speed >= P.impactMinSpeed)) return;
    const ud = (e.body && e.body.userData) || { kind: 'ground' };
    if (ud.kind === 'log' && ud.dynamic && String(ud.id) < String(rec.id)) return;
    if (simTime - (rec.lastImpactTime ?? -1) < P.impactMinGap) return; // 同じ丸太の連続した小さな接触を間引く
    rec.lastImpactTime = simTime;
    const c = e.contact;
    const pt = c.bi.position.vadd(c.ri);
    const payload = {
      id: rec.id, speed,
      surface: ud.kind === 'collider' ? 'collider' : (ud.kind === 'log' ? 'log' : 'ground'),
      colliderId: ud.colliderId ?? null, otherId: ud.kind === 'log' ? ud.id : null,
      position: { x: pt.x, y: pt.y, z: pt.z },
    };
    for (const fn of listeners.impact) fn(payload);
  }
  function prismShape(c) {
    // 屋根つきの角柱(テント)。断面=五角形(壁 wallH + 屋根 apexH)、奥行き=2*halfLength。原点=底面の中心。
    const W = c.halfWidth, w = c.wallH, H = c.apexH, Lh = c.halfLength;
    const sec = [[-W, 0], [-W, w], [0, H], [W, w], [W, 0]];
    const verts = [];
    for (const z of [Lh, -Lh]) for (const [x, y] of sec) verts.push(new CANNON.Vec3(x, y, z));
    const faces = [[0, 4, 3, 2, 1], [5, 6, 7, 8, 9], [0, 5, 9, 4], [0, 1, 6, 5], [1, 2, 7, 6], [2, 3, 8, 7], [3, 4, 9, 8]];
    return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
  }
  function makeColliderBody(c) {
    let shape, y = c.y;
    if (c.kind === 'prism') shape = prismShape(c);
    else shape = new CANNON.Cylinder(c.radius, c.radius, c.height, c.segments || 10);
    const body = new CANNON.Body({ mass: 0, shape, material });
    body.userData = { kind: 'collider', colliderId: c.id };
    body.position.set(c.x, y, c.z);
    if (c.yaw) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), c.yaw);
    return body;
  }
  function gridCells(x, z, r, fn) {
    const i0 = Math.floor((x - r) / GRID), i1 = Math.floor((x + r) / GRID);
    const j0 = Math.floor((z - r) / GRID), j1 = Math.floor((z + r) / GRID);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(cellKey(i, j));
  }
  /**
   * 静的コライダーを登録する。
   *  円柱: { id, kind:'cylinder', x, z, y(中心の高さ), radius, height }
   *  角柱(テント): { id, kind:'prism', x, z, y(底面の高さ), halfWidth, wallH, apexH, halfLength, yaw }
   */
  function addStaticCollider(desc) {
    if (!desc || desc.id === undefined || staticColliders.has(desc.id)) return false;
    const c = { ...desc, kind: desc.kind || 'cylinder' };
    c.reach = c.kind === 'prism' ? Math.hypot(c.halfWidth, c.halfLength) : c.radius; // 水平方向の最大の張り出し
    staticColliders.set(c.id, c);
    gridCells(c.x, c.z, c.reach, (k) => { if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(c.id); });
    if (dynamicRecords().length) refreshWorld(); // 動いている物がいる最中に追加された場合
    return true;
  }
  function removeStaticCollider(id) {
    const c = staticColliders.get(id);
    if (!c) return false;
    gridCells(c.x, c.z, c.reach, (k) => { const g = grid.get(k); if (g) { g.delete(id); if (!g.size) grid.delete(k); } });
    staticColliders.delete(id);
    const b = colliderBodies.get(id);
    if (b) { world.removeBody(b); colliderBodies.delete(id); }
    return true;
  }
  /** 位置(x,z)から半径r以内にあるコライダー(重複なし)。 */
  function collidersNear(x, z, r) {
    const out = new Map();
    gridCells(x, z, r, (k) => { const g = grid.get(k); if (g) for (const id of g) out.set(id, staticColliders.get(id)); });
    return [...out.values()].filter((c) => Math.hypot(c.x - x, c.z - z) <= r + c.reach);
  }

  /**
   * 離す前の重なり解消。持ち上げ中の丸太は物理の外でカーソルに追従するので、木・岩・テントの中に
   * 置けてしまう。そのまま動的にすると物理が激しく弾き出すので、幹に沿った点で貫入を調べ、
   * 最小限だけ押し出してから動的にする(「物が同じ空間を占めない」を離した瞬間に保証する)。
   */
  function depenetrate(rec) {
    const q = rec.quaternion;
    const ax = 2 * (q.x * q.y + q.w * q.z), ay = 1 - 2 * (q.x * q.x + q.z * q.z), az = 2 * (q.y * q.z - q.w * q.x);
    const pos = { ...rec.position };
    const n = Math.max(2, Math.ceil(rec.length / 0.4));
    let moved = false;
    for (let iter = 0; iter < 8; iter++) {
      let any = false;
      for (let i = 0; i <= n; i++) {
        const t = (i / n - 0.5) * rec.length;
        const r = rec.radiusBottom + (rec.radiusTop - rec.radiusBottom) * (i / n);
        const px = pos.x + ax * t, py = pos.y + ay * t, pz = pos.z + az * t;
        for (const c of collidersNear(px, pz, r + 0.2)) {
          const push = penetration(c, px, py, pz, r);
          if (push) { pos.x += push.x; pos.y += push.y; pos.z += push.z; any = true; moved = true; }
        }
      }
      if (!any) break;
    }
    if (moved) rec.position = pos;
    return moved;
  }
  /** v1.69: 塊の離す前の重なり解消。全員を同じだけ(剛体のまま)押し出す。 */
  function depenetrateGroup(G) {
    const shift = { x: 0, y: 0, z: 0 };
    let moved = false;
    for (let iter = 0; iter < 8; iter++) {
      let any = false;
      for (const id of G.ids) {
        const m = objects.get(id), q = m.quaternion;
        const ax = 2 * (q.x * q.y + q.w * q.z), ay = 1 - 2 * (q.x * q.x + q.z * q.z), az = 2 * (q.y * q.z - q.w * q.x);
        const n = Math.max(2, Math.ceil(m.length / 0.4));
        for (let i = 0; i <= n; i++) {
          const t = (i / n - 0.5) * m.length;
          const r = m.radiusBottom + (m.radiusTop - m.radiusBottom) * (i / n);
          const px = m.position.x + shift.x + ax * t, py = m.position.y + shift.y + ay * t, pz = m.position.z + shift.z + az * t;
          for (const c of collidersNear(px, pz, r + 0.2)) {
            const push = penetration(c, px, py, pz, r);
            if (push) { shift.x += push.x; shift.y += push.y; shift.z += push.z; any = true; moved = true; }
          }
        }
      }
      if (!any) break;
    }
    if (moved) for (const id of G.ids) { const m = objects.get(id); m.position = { x: m.position.x + shift.x, y: m.position.y + shift.y, z: m.position.z + shift.z }; }
    return moved;
  }
  /** 点(半径rの球)がコライダーに食い込んでいる時の、押し出しベクトル。無ければnull。 */
  function penetration(c, px, py, pz, r) {
    if (c.kind === 'prism') {
      const cs = Math.cos(-(c.yaw || 0)), sn = Math.sin(-(c.yaw || 0));
      const dx = px - c.x, dz = pz - c.z;
      const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs, ly = py - c.y;
      // 断面の屋根の高さ(その位置での表面の高さ)
      const W = c.halfWidth;
      const surf = Math.abs(lx) <= W ? (c.wallH + (c.apexH - c.wallH) * (1 - Math.abs(lx) / W)) : 0;
      const insideX = Math.abs(lx) < W + r, insideZ = Math.abs(lz) < c.halfLength + r;
      if (!insideX || !insideZ || ly > surf + r || ly < -r) return null;
      // 一番浅い方向へ押し出す: 上(屋根の上へ) / 左右 / 前後
      const up = surf + r - ly, sx = W + r - Math.abs(lx), sz = c.halfLength + r - Math.abs(lz);
      let lvx = 0, lvz = 0, vy = 0;
      if (up <= sx && up <= sz) vy = up + 0.01;
      else if (sx <= sz) lvx = Math.sign(lx || 1) * (sx + 0.01);
      else lvz = Math.sign(lz || 1) * (sz + 0.01);
      const c2 = Math.cos(c.yaw || 0), s2 = Math.sin(c.yaw || 0);
      return { x: lvx * c2 + lvz * s2, y: vy, z: -lvx * s2 + lvz * c2 };
    }
    const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz);
    const top = c.y + c.height / 2, bottom = c.y - c.height / 2;
    if (d >= c.radius + r || py > top + r || py < bottom - r) return null;
    const side = c.radius + r - d, up = top + r - py;
    if (up < side && py > top - c.height * 0.25) return { x: 0, y: up + 0.01, z: 0 }; // 頭の高さの上端に近い=上へ(岩の上に載せる)
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    return { x: nx * (side + 0.01), y: 0, z: nz * (side + 0.01) };
  }
  // ---- v1.52 Phase D: 物理プロパティの土台 ----
  // 物理エンジンは「質量・重力の倍率・上向きの力・粘着」という一般的な量だけを知っている。
  // ゲーム側の概念(月・星・火・川)はここに書かない。将来それらは、この量を変える(setPhysicalProperties)か、
  // 力を足す(addForceField / applyImpulse)ことで実現する。エンジン本体は書き換えずに済む。
  //   mass         : kg。省略(null)なら、円柱の体積×P.density から求める(従来どおり)。
  //   gravityScale : 重力の倍率。1=通常 / 0=無重力 / 負=上向き。重いほど(>1)落ちやすい。
  //   liftForce    : 上向きの力(N)。質量m・重力gなら m*|g| で釣り合って宙に浮く。(liftForceForMass で換算)
  //   adhesion     : 粘着(>=0)。他の物体に触れている間だけ、動きを粘り気のように抑える(1/秒の減衰率)。
  //                  将来は拘束(くっつく)に置き換えられるよう、いまは接触中の減衰として近似している。
  // 将来の候補(未実装): friction / restitution / material / temperature / flammability / moisture
  const DEFAULT_PROPS = { mass: null, gravityScale: 1, liftForce: 0, adhesion: 0 };
  function normalizeProps(p, base = DEFAULT_PROPS) {
    const out = { ...base };
    if (!p) return out;
    if ('mass' in p) { if (p.mass === null) out.mass = null; else if (Number.isFinite(p.mass) && p.mass > 0) out.mass = p.mass; }
    if ('gravityScale' in p && Number.isFinite(p.gravityScale)) out.gravityScale = Math.max(-20, Math.min(20, p.gravityScale));
    if ('liftForce' in p && Number.isFinite(p.liftForce)) out.liftForce = Math.max(-1e6, Math.min(1e6, p.liftForce));
    if ('adhesion' in p && Number.isFinite(p.adhesion)) out.adhesion = Math.max(0, Math.min(1000, p.adhesion));
    return out;
  }
  const volumeMass = (rec) => Math.PI * ((rec.radiusTop + rec.radiusBottom) / 2) ** 2 * rec.length * P.density;
  const massOf = (rec) => (rec.props && rec.props.mass !== null && rec.props.mass !== undefined ? rec.props.mass : volumeMass(rec));

  // ---- 外力フィールド ----
  // 将来のゲーム側の仕組み(月の手袋・星の板・川の流れなど)が、動いている物体へ力を加えるための窓口。
  // field = { id, force(rec, body, dt, simTime) -> {x,y,z}|null, sustains?:boolean, appliesTo?(rec)->boolean }
  //   sustains: true なら、この力が働いている間、その物体を静止扱いにしない(宙に浮かせたままにできる)。
  const forceFields = new Map();
  function addForceField(field) {
    if (!field || field.id === undefined || typeof field.force !== 'function' || forceFields.has(field.id)) return false;
    forceFields.set(field.id, field);
    return true;
  }
  function removeForceField(id) { return forceFields.delete(id); }
  const gravityMag = () => Math.abs(P.gravity);
  /** 質量m(kg)の物体を支える上向きの力(N)。ゲーム側が「持ち上げられる重さ(kg)」を力に換算する時に使う。 */
  const liftForceForMass = (kg) => kg * gravityMag();
  /** この時刻にこの物体へ働く力を、プロパティとフィールドから集める(ボディに足す)。 */
  function applyForces(rec, body, dt) {
    let sustained = false;
    const m = body.mass;
    const props = rec.group ? rec.group.props : rec.props; // v1.69: 塊は、塊ぜんたいの性質を使う
    if (props) {
      const gs = props.gravityScale;
      if (gs !== 1) body.force.y += m * P.gravity * (gs - 1); // 重力は m*g(g<0)。倍率ぶんだけ上乗せ/打ち消し
      if (props.liftForce !== 0) body.force.y += props.liftForce;
      // 重力(重さ)とつり合うか、それ以上の上向きの力が働いている間だけ「浮かせている」。
      // 重さの方が大きければ(ゆっくり)落ちて、地面で普通に止まる(静的へ戻る)。
      const netUp = props.liftForce - m * gravityMag() * gs;
      if (netUp >= -P.sustainTolerance * m * gravityMag()) sustained = true;
    }
    for (const f of forceFields.values()) {
      if (f.appliesTo && !f.appliesTo(rec)) continue;
      const v = f.force(rec, body, dt, simTime);
      if (!v) continue;
      body.force.x += v.x || 0; body.force.y += v.y || 0; body.force.z += v.z || 0;
      if (f.sustains && (v.x || v.y || v.z)) sustained = true;
    }
    rec.sustained = sustained;
    body.allowSleep = !sustained; // 浮かせている間は眠らせない
    if (sustained && body.sleepState !== CANNON.Body.AWAKE) body.wakeUp();
    return sustained;
  }
  /** 動いている物体に瞬間的な力積(N·s)を与える(押す・弾く)。静的/持ち上げ中なら何もしない(先に wake する)。 */
  function applyImpulse(id, imp) {
    const b = bodies.get(id);
    if (!b || !imp) return false;
    b.applyImpulse(new CANNON.Vec3(imp.x || 0, imp.y || 0, imp.z || 0));
    b.wakeUp();
    return true;
  }
  function getPhysicalProperties(id) {
    const rec = objects.get(id);
    if (!rec) return null;
    return { ...rec.props, effectiveMass: massOf(rec) };
  }
  /** プロパティを部分的に更新する。動いている最中でも即座に反映する(質量が変われば慣性も更新)。 */
  function setPhysicalProperties(id, patch) {
    const rec = objects.get(id);
    if (!rec) return false;
    if (rec.group) { rec.group.props = normalizeProps(patch, rec.group.props); const gb = bodies.get(rec.group.leaderId); if (gb) gb.wakeUp(); return true; } // v1.69
    rec.props = normalizeProps(patch, rec.props);
    const b = bodies.get(id);
    if (b) {
      b.mass = massOf(rec);
      b.updateMassProperties();
      b.wakeUp();
      rec.dynamicSince = simTime; rec.restTime = 0; // 条件が変わったので、止まるまでの時間を数え直す
    }
    return true;
  }
  /** 接触している間だけ働く粘着(減衰)を、動いている物体へ適用する。 */
  function applyAdhesion(dt) {
    let any = false;
    for (const rec of objects.values()) if (rec.physicsState === 'dynamic' && rec.props && rec.props.adhesion > 0) { any = true; break; }
    if (!any) return;
    const touching = new Set();
    for (const c of world.contacts) { touching.add(c.bi.id); touching.add(c.bj.id); }
    for (const [id, b] of bodies) {
      const rec = objects.get(id);
      if (!rec || !rec.props || rec.props.adhesion <= 0 || !touching.has(b.id)) continue;
      const k = Math.exp(-rec.props.adhesion * dt);
      b.velocity.scale(k, b.velocity);
      b.angularVelocity.scale(k, b.angularVelocity);
    }
  }

  // ---- 登録 ----
  /**
   * 物体を登録する(静的)。position は円柱の「中心」、円柱の軸はローカルY(three.jsのCylinderGeometryと同じ)。
   */
  function register(desc) {
    if (!desc || desc.id === undefined || objects.has(desc.id)) return null;
    const rec = {
      id: desc.id, kind: desc.kind || 'log',
      length: desc.length, radiusTop: desc.radiusTop ?? desc.radius, radiusBottom: desc.radiusBottom ?? desc.radius,
      position: { ...desc.position }, quaternion: { x: 0, y: 0, z: 0, w: 1, ...(desc.quaternion || {}) },
      // 物理の状態(physicsState)と、ゲーム上のできること(affordance)は別に持つ
      physicsState: 'static', dynamic: false, stable: true,
      // つかめるか(grabbable)は、物理の状態とは別。動いている最中でもつかめる(v1.47)。つかめないのは「持ち上げ中」だけ。
      grabbable: true,
      bridgeable: false, climbable: false, walkable: false,
      supportPoints: [], lastPhysicsTime: 0, dynamicSince: 0,
      props: normalizeProps(desc.physicalProperties), // v1.52
      sustained: false,
    };
    objects.set(rec.id, rec);
    return rec;
  }
  function unregister(id) {
    const rec = objects.get(id);
    if (!rec) return false;
    if (rec.group) dissolveGroup(rec.group); // v1.69: 塊の一員が物理から外れる時は、塊をほどく(残りは、今の姿勢のまま1本ずつの物に戻る)
    removeDynamic(id);
    objects.delete(id);
    refreshWorld();
    return true;
  }

  // ---- 状態遷移 ----
  function removeDynamic(id) {
    const b = bodies.get(id);
    if (b) { world.removeBody(b); bodies.delete(id); }
  }

  /**
   * 静的 または 動的(動いている最中) → 持ち上げ中。持ち上げ中は物理ボディを持たない(カーソルに追従する)。
   * 離した直後の丸太(動的)もすぐにつかめる。静止(スリープ)を待つ必要はない。
   */
  function pickUp(id) {
    const rec = objects.get(id);
    if (!rec || rec.physicsState === 'held') return false;
    if (rec.group) { // v1.69: 塊は、全員がいっしょに持ち上がる
      const G = rec.group;
      removeDynamic(G.leaderId);
      for (const mid of G.ids) {
        const m = objects.get(mid);
        m.physicsState = 'held'; m.dynamic = false; m.stable = false; m.grabbable = false;
      }
      refreshWorld();
      for (const mid of G.ids) emit('held', objects.get(mid));
      return true;
    }
    removeDynamic(id);
    rec.physicsState = 'held'; rec.dynamic = false; rec.stable = false; rec.grabbable = false;
    refreshWorld();
    emit('held', rec);
    return true;
  }
  function setHeldPose(id, position, quaternion) {
    const rec = objects.get(id);
    if (!rec || rec.physicsState !== 'held') return false;
    rec.position = { x: position.x, y: position.y, z: position.z };
    if (quaternion) rec.quaternion = { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
    if (rec.group) { // v1.69: 塊の全員を、剛体として動かす(つかんだ丸太の姿勢から、leaderの姿勢を逆算する)
      const G = rec.group, r = G.rel.get(id);
      const lq = qnorm(qmul(rec.quaternion, qconj(r.q)));
      const o = qrot(lq, r.p);
      applyLeaderPose(G, { x: rec.position.x - o.x, y: rec.position.y - o.y, z: rec.position.z - o.z }, lq);
    }
    return true;
  }
  /** 静的または持ち上げ中 → 動的。起こすのはこの物体だけ。 */
  function wake(id, { velocity = null } = {}) {
    const rec = objects.get(id);
    if (!rec) return false;
    if (rec.physicsState === 'dynamic') return true;
    if (rec.group) return wakeGroup(rec.group, { velocity });
    if (depenetrate(rec)) stats.depenetrated++;
    const body = makeBody(rec, massOf(rec));
    if (velocity) body.velocity.set(velocity.x, velocity.y, velocity.z);
    bodies.set(id, body);
    rec.physicsState = 'dynamic'; rec.dynamic = true; rec.stable = false; rec.grabbable = true;
    rec.dynamicSince = simTime; rec.lastPhysicsTime = simTime; rec.restTime = 0;
    rec.wakeX = rec.position.x; rec.wakeZ = rec.position.z;
    refreshWorld(); // 地面パッチと、近くの静的な物体(衝突相手)を用意してから
    world.addBody(body);
    stats.woke++;
    emit('woke', rec);
    return true;
  }
  /** 持ち上げ中の物体を離す(= 動的にする)。 */
  function release(id, opts) {
    const rec = objects.get(id);
    if (!rec || rec.physicsState !== 'held') return false;
    wake(id, opts);
    emit('released', rec);
    return true;
  }

  /** v1.69: 塊を、1つの剛体として動かし始める。 */
  function wakeGroup(G, { velocity = null } = {}) {
    if (depenetrateGroup(G)) stats.depenetrated++;
    const leader = objects.get(G.leaderId);
    // depenetrateで全員がずれた(leaderも)ので、相対姿勢は変えずに、leaderの今の姿勢から取り直さない(相対は不変)
    const body = makeGroupBody(G);
    if (velocity) body.velocity.set(velocity.x, velocity.y, velocity.z);
    bodies.set(G.leaderId, body);
    for (const mid of G.ids) {
      const m = objects.get(mid);
      m.physicsState = 'dynamic'; m.dynamic = true; m.stable = false; m.grabbable = true;
      m.dynamicSince = simTime; m.lastPhysicsTime = simTime; m.restTime = 0;
    }
    leader.reach = G.reach; leader.wakeX = leader.position.x; leader.wakeZ = leader.position.z;
    refreshWorld();
    world.addBody(body);
    stats.woke++;
    emit('woke', leader);
    return true;
  }
  /** v1.69: 塊をほどく(全員が、今の姿勢のまま、1本ずつの物に戻る)。動いている最中なら、その場で止める。 */
  function dissolveGroup(G) {
    const b = bodies.get(G.leaderId);
    if (b) {
      copyPose(objects.get(G.leaderId), b.position, b.quaternion);
      applyLeaderPose(G, objects.get(G.leaderId).position, objects.get(G.leaderId).quaternion);
      world.removeBody(b); bodies.delete(G.leaderId);
    }
    for (const mid of G.ids) {
      const m = objects.get(mid); if (!m) continue;
      delete m.group;
      if (m.physicsState === 'dynamic') { m.physicsState = 'static'; m.dynamic = false; m.stable = true; m.grabbable = true; }
      delete m.reach;
    }
    groups.delete(G.id);
    refreshWorld();
  }
  /**
   * v1.69: 2本の静止した丸太を、剛体として接着する(すでに塊の一員なら、塊どうしを1つにする)。
   * 位置は変えない(いまの姿勢のまま、相対姿勢を覚える)。どちらかが静止していなければ false。
   */
  function weld(idA, idB) {
    const a = objects.get(idA), b = objects.get(idB);
    if (!a || !b || a === b) return false;
    if (a.physicsState !== 'static' || b.physicsState !== 'static') return false;
    if (a.group && a.group === b.group) return true;
    let G = a.group;
    if (!G) {
      G = { id: 'g' + (nextGroupId++), leaderId: a.id, ids: [a.id], rel: new Map(), props: { ...DEFAULT_PROPS }, reach: 0 };
      groups.set(G.id, G); a.group = G;
    }
    const others = b.group ? b.group.ids.slice() : [b.id];
    if (b.group) groups.delete(b.group.id);
    for (const oid of others) { if (!G.ids.includes(oid)) G.ids.push(oid); objects.get(oid).group = G; }
    rebuildGroup(G);
    return true;
  }
  /** v1.71: 塊(または1本)をほどく。全員が今の姿勢のまま、1本ずつの静的な物に戻る(塊でなければ何もしない)。 */
  function dissolve(id) {
    const rec = objects.get(id);
    if (!rec || !rec.group) return false;
    dissolveGroup(rec.group);
    return true;
  }
  /**
   * v1.71: 持ち上げ中の丸太(塊なら全員)を、いまの姿勢のまま、落とさずに静的にする(位置を決めて据える時に使う)。
   * 全員に 'settled' を通知する(メッシュの同期・雪の記録など、止まった時の処理をそのまま使うため)。
   */
  function placeStatic(id) {
    const rec = objects.get(id);
    if (!rec || rec.physicsState !== 'held') return false;
    const ids = rec.group ? rec.group.ids.slice() : [id];
    for (const mid of ids) {
      const m = objects.get(mid);
      m.physicsState = 'static'; m.dynamic = false; m.stable = true; m.grabbable = true;
      m.lastPhysicsTime = simTime; m.settleReason = 'placed';
    }
    if (rec.group) delete objects.get(rec.group.leaderId).reach;
    refreshWorld();
    for (const mid of ids) emit('settled', objects.get(mid));
    return true;
  }
  /** 塊の一員のid一覧(塊でなければ null)。 */
  function groupOf(id) { const r = objects.get(id); return r && r.group ? r.group.ids.slice() : null; }
  /** 塊(または1本)を、いまの姿勢でその場に止めて、静的に戻す(宙に浮かせたまま止める時などに使う)。 */
  function freeze(id) {
    const rec = objects.get(id);
    if (!rec) return false;
    const lid = rec.group ? rec.group.leaderId : id;
    if (!bodies.has(lid)) return false;
    settle(lid, 'freeze');
    return true;
  }
  function settleGroup(G, reason) {
    const body = bodies.get(G.leaderId), leader = objects.get(G.leaderId);
    copyPose(leader, body.position, body.quaternion);
    applyLeaderPose(G, leader.position, leader.quaternion);
    // 地面にめり込んだまま止まらないよう、いちばん深く沈んでいる丸太のぶんだけ、塊ぜんたいを持ち上げる
    if (reason !== 'freeze') {
      let lift = 0;
      for (const mid of G.ids) { const m = objects.get(mid); lift = Math.max(lift, groundHeightAt(m.position.x, m.position.z) + m.radiusBottom * 0.85 - m.position.y); }
      if (lift > 0) { applyLeaderPose(G, { x: leader.position.x, y: leader.position.y + lift, z: leader.position.z }, leader.quaternion); }
    }
    removeDynamic(G.leaderId);
    for (const mid of G.ids) {
      const m = objects.get(mid);
      m.physicsState = 'static'; m.dynamic = false; m.stable = true; m.grabbable = true; m.lastPhysicsTime = simTime; m.settleReason = reason;
    }
    delete leader.reach;
    stats.settled++;
    refreshWorld();
    for (const mid of G.ids) emit('settled', objects.get(mid));
  }
  function settle(id, reason) {
    const rec = objects.get(id);
    const body = bodies.get(id);
    if (!rec || !body) return;
    if (rec.group) { settleGroup(rec.group, reason); return; } // v1.69
    // 地面にめり込んだまま/地面の下で止まらないよう、中心は地面+半径以上に保つ
    const minY = groundHeightAt(body.position.x, body.position.z) + rec.radiusBottom * 0.85;
    if (body.position.y < minY) body.position.y = minY;
    copyPose(rec, body.position, body.quaternion);
    removeDynamic(id);
    rec.physicsState = 'static'; rec.dynamic = false; rec.stable = true; rec.grabbable = true;
    rec.lastPhysicsTime = simTime;
    rec.settleReason = reason;
    stats.settled++;
    refreshWorld();
    emit('settled', rec);
  }

  // ---- 地面パッチと、衝突相手の静的ボディ(動的な物体の周りだけ) ----
  function dynamicRecords() { return [...bodies.keys()].map((id) => objects.get(id)); }

  function buildPatch(x0, x1, z0, z1) {
    removePatch();
    let step = P.patchStep;
    while ((x1 - x0) / step > 200 || (z1 - z0) / step > 200) step *= 2; // 巨大にならないよう格子を粗くする
    const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
    const zTop = z0 + (nz - 1) * step;
    const data = [];
    for (let i = 0; i < nx; i++) {
      const col = new Array(nz);
      for (let j = 0; j < nz; j++) col[j] = groundHeightAt(x0 + i * step, zTop - j * step);
      data.push(col);
    }
    const hf = new CANNON.Heightfield(data, { elementSize: step });
    const body = new CANNON.Body({ mass: 0, shape: hf, material });
    body.userData = { kind: 'ground' };
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); // 局所z(高さ)→世界y、局所y→世界-z
    body.position.set(x0, 0, zTop);
    world.addBody(body);
    patch = { body, x0, x1: x0 + (nx - 1) * step, z0: zTop - (nz - 1) * step, z1: zTop };
    stats.patchBuilds++;
  }
  function removePatch() { if (patch) { world.removeBody(patch.body); patch = null; } }

  function refreshWorld() {
    const dyn = dynamicRecords();
    if (dyn.length === 0) { // 何も動いていない: 物理世界は空にする(コストゼロ)
      removePatch();
      for (const b of neighborBodies.values()) world.removeBody(b);
      neighborBodies.clear();
      for (const b of colliderBodies.values()) world.removeBody(b);
      colliderBodies.clear();
      return;
    }
    // 地面パッチ: 動的な物体すべてを余白つきで覆う
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of dyn) {
      const b = bodies.get(r.id);
      const reach = (r.reach ?? r.length / 2) + 1; // v1.69: 塊は、塊ぜんたいの広がり
      x0 = Math.min(x0, b.position.x - reach); x1 = Math.max(x1, b.position.x + reach);
      z0 = Math.min(z0, b.position.z - reach); z1 = Math.max(z1, b.position.z + reach);
    }
    const covers = patch
      && x0 - P.patchRebuildMargin >= patch.x0 && x1 + P.patchRebuildMargin <= patch.x1
      && z0 - P.patchRebuildMargin >= patch.z0 && z1 + P.patchRebuildMargin <= patch.z1;
    if (!covers) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const half = Math.max(P.minPatchHalf, (x1 - x0) / 2 + P.patchMargin, (z1 - z0) / 2 + P.patchMargin);
      buildPatch(cx - half, cx + half, cz - half, cz + half);
    }
    // 近くの静的な物体だけを衝突相手にする
    const wanted = new Set();
    for (const r of dyn) {
      const b = bodies.get(r.id);
      for (const o of objects.values()) {
        if (o.physicsState !== 'static' || wanted.has(o.id)) continue;
        if (Math.hypot(o.position.x - b.position.x, o.position.z - b.position.z) <= P.neighborRadius + o.length / 2) wanted.add(o.id);
      }
    }
    // 近くの世界コライダー(木・岩・テント…)も、動的な物体の近くにある間だけ入れる
    const wantedColliders = new Set();
    for (const r of dyn) {
      const b = bodies.get(r.id);
      for (const c of collidersNear(b.position.x, b.position.z, P.neighborRadius + (r.reach ?? r.length / 2))) wantedColliders.add(c.id);
    }
    for (const [id, b] of colliderBodies) {
      if (!wantedColliders.has(id)) { world.removeBody(b); colliderBodies.delete(id); }
    }
    for (const id of wantedColliders) {
      if (colliderBodies.has(id)) continue;
      const cb = makeColliderBody(staticColliders.get(id));
      world.addBody(cb);
      colliderBodies.set(id, cb);
    }
    for (const [id, b] of neighborBodies) {
      if (!wanted.has(id)) { world.removeBody(b); neighborBodies.delete(id); }
    }
    for (const id of wanted) {
      if (neighborBodies.has(id)) continue;
      const o = objects.get(id);
      const nb = makeBody(o, 0);
      world.addBody(nb);
      neighborBodies.set(id, nb);
    }
  }

  // ---- 1フレーム進める ----
  /** 動的な物体が無ければ何もしない(ボディ0個・コストゼロ)。戻り値: 動的な物体の数。 */
  function step(dt) {
    if (bodies.size === 0) { accumulator = 0; return 0; }
    accumulator = Math.min(accumulator + Math.max(0, dt), P.fixedStep * P.maxSubSteps);
    let accumulatorSteps = 0;
    while (accumulator >= P.fixedStep) {
      for (const [id, body] of bodies) applyForces(objects.get(id), body, P.fixedStep); // v1.52: 重力倍率・上向きの力・外力フィールド
      world.step(P.fixedStep);
      applyAdhesion(P.fixedStep);
      simTime += P.fixedStep; accumulator -= P.fixedStep; stats.steps++; accumulatorSteps++;
    }
    let needRefresh = false;
    for (const [id, body] of [...bodies]) {
      const rec = objects.get(id);
      copyPose(rec, body.position, body.quaternion);
      if (rec.group) applyLeaderPose(rec.group, rec.position, rec.quaternion); // v1.69: 塊の全員の姿勢を、剛体の姿勢から決め直す
      rec.lastPhysicsTime = simTime;
      const ground = groundHeightAt(body.position.x, body.position.z);
      if (body.position.y < ground - 1.5) { stats.failsafes++; settle(id, 'failsafe'); continue; } // 地面抜けの救済
      if (body.position.y > ground + P.maxAltitude) { stats.ceilings++; rec.props = normalizeProps({ liftForce: 0, gravityScale: 1 }, rec.props); settle(id, 'ceiling'); continue; } // v1.52: 空高く昇りきった
      if (rec.sustained) { // v1.52: 浮かせている(重力を弱める/上向きの力が働いている)間は、静止扱い・タイムアウトにしない
        rec.dynamicSince = simTime; rec.restTime = 0; needRefresh = true; stats.sustainedSteps++;
        continue;
      }
      if (body.sleepState === CANNON.Body.SLEEPING) { settle(id, 'sleep'); continue; }
      // v1.49: 斜面で転がり続ける丸太を、急停止ではなく滑らかに止める「転がり抵抗の漸増」。
      // 動き出して brakeStart 秒を過ぎたら、brakeRamp 秒かけて減衰を強めていく(転がりが自然に減速して止まる)。
      const age = simTime - rec.dynamicSince;
      const travel = Math.hypot(body.position.x - rec.wakeX, body.position.z - rec.wakeZ);
      const kTime = age > P.brakeStart ? Math.min(1, (age - P.brakeStart) / P.brakeRamp) : 0;
      const kDist = travel > P.brakeDistance ? Math.min(1, (travel - P.brakeDistance) / P.brakeDistanceRamp) : 0;
      const k = Math.max(kTime, kDist);
      if (k > 0) {
        body.angularDamping = P.angularDamping + (P.brakeAngular - P.angularDamping) * k;
        body.linearDamping = P.linearDamping + (P.brakeLinear - P.linearDamping) * k;
      }
      // v1.49: 木・岩・テントとの接触では、止まっているのに微小な振動でcannonのスリープが解除され続けることがある。
      // 「ゆっくり(並進 0.08m/s・回転 0.35rad/s 未満)の状態が0.8秒続いた」ら静止とみなして静的へ戻す。
      // ブレーキが最大まで効いた後は、まだゆっくり転がり続けていても(斜面では重力が続く)止まったとみなす
      const braked = k >= 1;
      if (body.velocity.length() < (braked ? P.brakedRestSpeed : P.restSpeed) && body.angularVelocity.length() < (braked ? Math.max(P.brakedRestAngular, P.brakedRestSpeed / Math.max(0.03, rec.radiusBottom)) : P.restAngular)) { // 細い丸太は同じ速さでも回転が速い
        rec.restTime = (rec.restTime || 0) + P.fixedStep * Math.max(1, Math.round(accumulatorSteps));
        if (rec.restTime >= P.restTimeLimit) { settle(id, 'rest'); continue; }
      } else rec.restTime = 0;
      if (simTime - rec.dynamicSince > P.maxDynamicTime) { stats.timeouts++; settle(id, 'timeout'); continue; }
      needRefresh = true;
    }
    if (needRefresh) refreshWorld(); // 動いた分だけ、地面パッチと衝突相手を更新
    return bodies.size;
  }

  return {
    register, unregister, pickUp, setHeldPose, wake, release,
    weld, groupOf, freeze, // v1.69: 接着(塊)
    dissolve, placeStatic, // v1.71: 塊をほどく / 持ち上げ中の物をその場で据える
    addStaticCollider, removeStaticCollider,
    // v1.52: 物理プロパティと外力の窓口(月・星・火・川などのゲーム側の仕組みはこれを使う)
    getPhysicalProperties, setPhysicalProperties,
    addForceField, removeForceField, applyImpulse, liftForceForMass,
    gravity: () => P.gravity,
    /** v1.56-H3: 動いている丸太の今の速度(m/s)。水に落ちた瞬間の検出などに使う。動的でなければnull。 */
    velocityOf(id) { const r0 = objects.get(id); const b = bodies.get(r0 && r0.group ? r0.group.leaderId : id); return b ? { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z } : null; },
    step,
    get: (id) => objects.get(id) || null,
    isGrabbable: (id) => { const r = objects.get(id); return !!r && r.grabbable === true; },
    all: () => [...objects.values()],
    /** 状態の集計。bodies=物理世界の中のボディ数(地面パッチ・衝突相手を含む)。 */
    stats: () => ({
      ...stats,
      objects: objects.size,
      dynamic: bodies.size,
      held: [...objects.values()].filter((o) => o.physicsState === 'held').length,
      neighbors: neighborBodies.size,
      staticColliders: staticColliders.size,
      activeColliders: colliderBodies.size,
      forceFields: forceFields.size,
      sustained: [...objects.values()].filter((o) => o.sustained).length,
      groups: groups.size,
      patch: patch ? { x0: patch.x0, x1: patch.x1, z0: patch.z0, z1: patch.z1 } : null,
      worldBodies: world.bodies.length,
      simTime,
    }),
    isIdle: () => bodies.size === 0,
    on(ev, fn) { if (listeners[ev]) listeners[ev].push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; },
    _world: world, // 検証用
  };
}
