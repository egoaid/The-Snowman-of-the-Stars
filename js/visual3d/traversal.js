// traversal.js (v1.53 Phase E2)
// 通行(Traversal)の層。physics.js(物がどう動くか)とは別に、「雪だるまが、いまの足元から、
// その面へ 歩いて上がれる/ジャンプで乗れる/手で引き上げて登れる/届かない」を、面の実際の高さ・
// 位置・向きから答える。物の種類(ステップ用/橋用…)の属性は持たない。
//
//  ・「橋」という分類は無い。丸太がたまたま川をまたいでいて、その表面に乗って歩けるなら、渡れる。
//    川の判定は「足元を支える面があるか」だけで決まる(支えがあれば下が水でも歩ける。支えが無ければ入れない)。
//  ・高さは全て絶対高さ(足元のy)で考える。川の上の丸太は、川底ではなく丸太の表面が足場になる。
//  ・歩行モードも見守りモードも、同じ関数(supportAt/findClimb/evaluateAction)を使う。
//  ・面の提供元(surface provider)は今は倒木と小さな岩。将来、プレイヤー製の足場なども同じ口で足せる。
import * as THREE from 'three';

// ---- 限界値(一箇所に集約。実機で調整する) ----
export const JUMP_SPEED = 5.0;   // m/s(ジャンプの強さは変えない)
export const GRAVITY = 14.0;     // m/s²
export const JUMP_APEX = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY); // ≒ 0.89m
export const NORMAL_STEP_HEIGHT = 0.30;      // 歩いて上がれる段差
export const MAX_JUMP_LANDING_HEIGHT = 0.65; // ジャンプで着地できる高さ
export const HAND_REACH_HEIGHT = 1.25;       // 手で縁をつかんで引き上げられる高さ(足元から。v1.54で1.10→1.25: 登りやすく)
export const HAND_REACH_DISTANCE = 0.55;     // 手が届く水平距離(体の半径の外側)
export const AIRBORNE_CLEARANCE_TOLERANCE = 0.12; // 空中で幹の頂点とこれ以内なら、縁をかすめても引っかからない
export const LATERAL_FORGIVENESS = 0.14;     // 丸太の中心線に正確に乗らなくても、この幅までは面として扱う(肩の部分)
export const WATER_FOOT_RADIUS_RATIO = 0.55; // 足元の円(体の半径のこの倍率)が水に触れる位置へは行かせない
export const SUPPORT_RISE_RATE = 3.5;        // 面の上へ上がる最大速度(m/s)
export const SUPPORT_DROP_RATE = 9.0;        // 小さな下り段差を降りる速度(m/s)
export const SURFACE_DROP_SNAP = 0.12;       // 面から降りる時、これ以下の落差は滑らかに降りる(これを超えれば落ちる)
export const TERRAIN_DROP_SNAP = 0.35;       // 地面を下る時の同様の値(なだらかな下り坂を歩けるように)
export const STEEP_LOG_HORIZONTAL_SQ = 0.33; // 軸の水平成分²がこれ未満(傾き55°超)の丸太は、面ではなく立った障害物として扱う
export const LANDING_CATCH_DISTANCE = 0.32;  // ジャンプの着地で、幹の縁からこの距離以内なら、幹の上へそっと引き寄せる(正確に中心線へ降りなくても乗れる)
export const AUTO_ASSIST = { enabled: true, jumpLookAhead: 0.8, climbLookAhead: 1.0, climbPressSec: 0.3, hopCooldownSec: 0.6 }; // v1.54: 丸太へ向かって歩くだけで、跳ぶ/よじ登る補助(操作を簡単に)
export const CLIMB_DURATION = 0.62;          // 引き上げの所要時間(秒)
export const SAFE_DROP_HEIGHT = 1.4;         // 見守りが降りてよい落差
// v1.56-H5: 見守りの雪だるまの「よいしょ」と乗り越える(スクランブル)。手が届く高さ(1.25m)を超える丸太でも、
// 体を持ち上げてよじ登る(デフォルメしたゆっくりした動き)。見守りだけの動きで、歩行モードの操作(手の届く高さ)は変えない。
export const SCRAMBLE_MAX_HEIGHT = 2.5;      // 乗り越えられる高さ(丸太2段積みくらい)
export const SCRAMBLE_MAX_DROP = 3.0;        // 乗り越えた先へ、よじ降りてよい落差
/** 引き上げの所要時間: 手の届く高さまでは従来どおり、それより高いほど少しゆっくり(2.5mで約1.2秒)。 */
export function climbDurationFor(rise) { return CLIMB_DURATION + 0.45 * Math.max(0, rise - HAND_REACH_HEIGHT); }

/**
 * 雪だるまの衝突設定とジャンプ定数から、通行の限界値を導く。
 */
export function deriveTraversalLimits(collision = null) {
  const step = collision && Number.isFinite(collision.stepHeight)
    ? Math.min(NORMAL_STEP_HEIGHT, collision.stepHeight)
    : NORMAL_STEP_HEIGHT;
  return {
    stepHeight: step,
    maxLandingHeight: Math.min(MAX_JUMP_LANDING_HEIGHT, JUMP_APEX - AIRBORNE_CLEARANCE_TOLERANCE),
    handReachHeight: HAND_REACH_HEIGHT,
    handReachDistance: HAND_REACH_DISTANCE,
    jumpApex: JUMP_APEX,
    airborneTolerance: AIRBORNE_CLEARANCE_TOLERANCE,
    moverRadius: collision && Number.isFinite(collision.collisionRadius) ? collision.collisionRadius : 0.525,
  };
}

// ---- 通行の動作 ----
export const ACTION = { WALK: 'walk', JUMP: 'jump', CLIMB: 'climb', UNREACHABLE: 'unreachable' };

/**
 * 足元から面の上端までの高さ(rise。足元より低ければ負)から、必要な動作を答える。
 *   rise ≤ 歩ける段差        → walk(そのまま歩いて上がる)
 *   rise ≤ ジャンプ着地の高さ → jump(ジャンプで乗る)
 *   rise ≤ 手の届く高さ       → climb(縁をつかんで引き上げる)
 *   それより高い             → unreachable(届かない)
 */
export function evaluateAction(rise, limits) {
  if (rise <= limits.stepHeight) return ACTION.WALK;
  if (rise <= limits.maxLandingHeight) return ACTION.JUMP;
  if (rise <= limits.handReachHeight) return ACTION.CLIMB;
  return ACTION.UNREACHABLE;
}

// ---- 倒木の幾何(幹=根元から先端へ伸びる円錐台。メッシュの原点=根元、軸=ローカルY) ----
const _up = new THREE.Vector3(0, 1, 0);
const _ax = new THREE.Vector3();
function buildGeom(log) {
  const dims = log.dims || { length: log.length, radius: log.radius };
  const m = log.mesh;
  m.updateMatrixWorld(true);
  _ax.copy(_up).applyQuaternion(m.quaternion);
  const L = dims.length;
  const r0 = dims.radius, r1 = dims.radiusTop ?? r0 * 0.7;
  return {
    key: [m.position.x, m.position.y, m.position.z, m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w],
    L, r0, r1,
    bx: m.position.x, by: m.position.y, bz: m.position.z,
    ax: _ax.x, ay: _ax.y, az: _ax.z,
    ahSq: _ax.x * _ax.x + _ax.z * _ax.z,
    rMax: Math.max(r0, r1),
  };
}
/** 傾きが急すぎる(ほぼ立っている)丸太。面ではなく、立った障害物として扱う。 */
export function isSteepLog(g) { return g.ahSq < STEEP_LOG_HORIZONTAL_SQ; }

/**
 * 点(x,z)から幹の軸(水平に投影した線分)までの最近点。
 * 戻り値: { u:軸に沿った長さ(0..L), d:水平距離, r:その位置の半径, axisY:その位置の軸の高さ, cx,cz:軸上の最近点 }
 */
export function nearestOnLog(g, x, z) {
  if (g.ahSq < 1e-6) return null;
  let u = ((x - g.bx) * g.ax + (z - g.bz) * g.az) / g.ahSq;
  if (u < 0) u = 0; else if (u > g.L) u = g.L;
  const cx = g.bx + g.ax * u, cz = g.bz + g.az * u;
  const d = Math.hypot(x - cx, z - cz);
  const t = g.L > 0 ? u / g.L : 0;
  return { u, d, r: g.r0 + (g.r1 - g.r0) * t, axisY: g.by + g.ay * u, cx, cz };
}

/**
 * 倒木の「円柱の表面の高さ」(絶対y)。幹の真上(水平距離 < 半径)なら丸い断面の頂点の高さ。
 * forgive > 0 なら、半径の外側 forgive までは「肩」として滑らかに下がる面を返す
 * (中心線に正確に乗らなくても、近くの上面として扱える)。無ければ -Infinity。
 */
export function logSurfaceTop(g, x, z, forgive = 0) {
  const n = nearestOnLog(g, x, z);
  if (!n) return -Infinity;
  if (n.d < n.r) return n.axisY + Math.sqrt(n.r * n.r - n.d * n.d);
  if (forgive > 0 && n.d < n.r + forgive) return n.axisY - (n.d - n.r); // 肩: 軸の高さから外へ向かって下がる
  return -Infinity;
}

// ---- 縦方向の状態(絶対の足元の高さ y) ----
/**
 * y = 足元の絶対の高さ。支え(support={y,terrain,onSurface})は呼び出し側が毎フレーム渡す。
 *  ・着地中: 地面ならそのまま追従。面(丸太・岩)の上へは上がる速さに上限をつけて滑らかに。
 *            下りは小さければ滑らかに、大きければ落ちる(縁から落ちる)。
 *  ・空中: 放物運動。足元が支えの高さまで降りたら着地。
 *  ・引き上げ中: climb.update が y を直接動かす(forceY)。
 */
export function createVerticalState({ jumpSpeed = JUMP_SPEED, gravity = GRAVITY } = {}) {
  const s = { y: 0, vy: 0, grounded: true, supportY: 0, terrainY: 0, inited: false, climbing: false };
  s.jump = function jump() {
    if (!s.grounded || s.climbing) return false;
    s.vy = jumpSpeed; s.grounded = false; return true;
  };
  s.snap = function snap() { s.inited = false; s.vy = 0; s.grounded = true; s.climbing = false; };
  s.forceY = function forceY(y) { s.y = y; s.vy = 0; s.grounded = true; s.inited = true; };
  s.update = function update(delta, support) {
    const sup = support && Number.isFinite(support.y) ? support : { y: 0, terrain: 0, onSurface: false };
    s.supportY = sup.y; s.terrainY = Number.isFinite(sup.terrain) ? sup.terrain : sup.y;
    if (!s.inited) { s.y = sup.y; s.inited = true; if (s.grounded) s.vy = 0; } // 初回は足元を支えに合わせる(初回より前に出たジャンプの要求は消さない)
    if (s.climbing) return s.y;
    if (s.grounded) {
      if (sup.y >= s.y) {
        // 面の上へ: 上がる速さに上限(地面そのものは、足元が地面にある限りそのまま追従)
        s.y = sup.onSurface ? Math.min(sup.y, s.y + SUPPORT_RISE_RATE * delta) : sup.y;
      } else {
        const drop = s.y - sup.y;
        const snap = sup.onSurface ? SURFACE_DROP_SNAP : TERRAIN_DROP_SNAP;
        if (drop <= snap) s.y = Math.max(sup.y, s.y - SUPPORT_DROP_RATE * delta);
        else { s.grounded = false; s.vy = 0; } // 縁から落ちる
      }
    }
    if (!s.grounded) {
      s.vy -= gravity * delta;
      s.y += s.vy * delta;
      if (s.y <= sup.y && s.vy <= 0) { s.y = sup.y; s.vy = 0; s.grounded = true; }
    }
    return s.y;
  };
  /** 今の支えから見た、空中の高さ(伸び縮みのアニメーション用)。着地中は0。 */
  s.airHeight = () => (s.grounded ? 0 : Math.max(0, s.y - s.supportY));
  s.reset = () => { s.y = 0; s.vy = 0; s.grounded = true; s.supportY = 0; s.inited = false; s.climbing = false; };
  return s;
}

/**
 * 引き上げ(hand-assisted climb)の動き。厳密な物理ではなく、デフォルメしたアニメーション:
 * 前半=その場でぐっと伸び上がる(縁より少し上まで)、後半=体を縁の上へ寄せて、ぽんと座る。
 * 位置(x,z)と足元の高さ(y)を直接動かす。歩行モードと見守りモードで共通。
 */
export function createClimbController(duration = CLIMB_DURATION) {
  const c = { active: false, t: 0, from: null, to: null, pose: 0 };
  c.start = function start(fromX, fromZ, fromY, toX, toZ, toY, durationOverride = null) {
    c.active = true; c.t = 0; c.pose = 0; c.duration = durationOverride > 0 ? durationOverride : duration; // v1.56-H5: 高さに応じてゆっくり
    c.from = { x: fromX, z: fromZ, y: fromY }; c.to = { x: toX, z: toZ, y: toY };
  };
  c.cancel = function cancel() { c.active = false; c.pose = 0; };
  /** @returns {{x,z,y,done}} */
  c.update = function update(delta) {
    if (!c.active) return null;
    c.t = Math.min(1, c.t + delta / (c.duration || duration));
    const t = c.t, f = c.from, to = c.to;
    const rise = Math.min(1, t / 0.55);                 // 前半: 縦に伸び上がる
    const slide = t <= 0.45 ? 0 : (t - 0.45) / 0.55;    // 後半: 縁の上へ寄る
    const eased = slide * slide * (3 - 2 * slide);
    const overshoot = Math.sin(Math.min(1, t / 0.7) * Math.PI) * 0.10; // 縁より少し上まで伸びる
    const y = f.y + (to.y - f.y) * (rise * rise * (3 - 2 * rise)) + (t < 1 ? overshoot : 0);
    const out = { x: f.x + (to.x - f.x) * eased, z: f.z + (to.z - f.z) * eased, y, done: t >= 1 };
    c.pose = Math.sin(t * Math.PI) * 0.22 + 0.04; // 伸び縮みのアニメーション用(setJumpHeightに渡す想定)
    if (out.done) { out.y = to.y; out.x = to.x; out.z = to.z; c.active = false; c.pose = 0; }
    return out;
  };
  return c;
}

// ---- 失敗した試みの記憶(同じ不可能な試みを延々と繰り返さない) ----
export function createTraversalFailureMemory(now = () => performance.now() / 1000) {
  const m = new Map();
  return {
    mark(key, seconds = 90) { m.set(key, now() + seconds); },
    isFailed(key) { const e = m.get(key); if (e === undefined) return false; if (e <= now()) { m.delete(key); return false; } return true; },
    clear() { m.clear(); },
    size() { for (const [k, e] of m) if (e <= now()) m.delete(k); return m.size; },
  };
}

/**
 * 通行システムを作る。
 * @param {object} p
 * @param {(x:number,z:number)=>number} p.baseGroundAt 地面の高さ(地形+積雪)
 * @param {()=>Array} p.getLogs 静止している倒木({mesh,dims,type,...})
 * @param {Array<{x,z,radius,height}>} p.bumps 小さな岩のなだらかな盛り上がり
 * @param {(x:number,z:number)=>number} p.waterSurfaceAt 水面の高さ(水が無ければ -Infinity)
 * @param {(type:string)=>boolean} [p.walkOverFn] 小枝など、そもそも段差にならない種類
 * @param {object} p.collision 雪だるまの衝突設定
 */
export function createTraversal({ baseGroundAt, getLogs, bumps = [], waterSurfaceAt, walkOverFn = null, collision = null }) {
  const limits = deriveTraversalLimits(collision);
  const geoms = new Map();

  function geomOf(log) {
    const g = geoms.get(log);
    const m = log.mesh;
    if (g) {
      const k = g.key;
      if (Math.abs(k[0] - m.position.x) < 1e-6 && Math.abs(k[1] - m.position.y) < 1e-6 && Math.abs(k[2] - m.position.z) < 1e-6
        && Math.abs(k[3] - m.quaternion.x) < 1e-6 && Math.abs(k[4] - m.quaternion.y) < 1e-6
        && Math.abs(k[5] - m.quaternion.z) < 1e-6 && Math.abs(k[6] - m.quaternion.w) < 1e-6) return g;
    }
    const ng = buildGeom(log);
    geoms.set(log, ng);
    return ng;
  }
  /** 面として扱う倒木(小枝・ほぼ立っている丸太は除く)。種類・置き場所による区別は無い。 */
  function surfaceLogs() {
    const out = [];
    for (const log of getLogs()) {
      if (walkOverFn && walkOverFn(log.type)) continue;
      const g = geomOf(log);
      if (isSteepLog(g)) continue;
      out.push({ log, g });
    }
    return out;
  }

  // ---- 面の問い合わせ(提供元: 倒木・小さな岩) ----
  function bumpTopAt(x, z) {
    let maxBump = 0, anchor = null;
    for (const rock of bumps) {
      const dist = Math.hypot(x - rock.x, z - rock.z);
      if (dist < rock.radius) {
        const t = 1 - dist / rock.radius;
        const b = rock.height * (t * t * (3 - 2 * t));
        if (b > maxBump) { maxBump = b; anchor = rock; }
      }
    }
    return { lift: maxBump, anchor };
  }
  /**
   * (x,z)の真上/すぐ近くにある面の一覧: [{topAbs, ax, az, kind, log?}]。
   * forgive: 倒木の肩として含める水平の余裕。
   */
  function surfaceHits(x, z, forgive = LATERAL_FORGIVENESS) {
    const hits = [];
    for (const { log, g } of surfaceLogs()) {
      const top = logSurfaceTop(g, x, z, forgive);
      if (top === -Infinity) continue;
      const n = nearestOnLog(g, x, z);
      hits.push({ topAbs: top, crest: n.axisY + n.r, ax: n.cx, az: n.cz, kind: 'log', log, d: n.d, r: n.r }); // crest=軸の真上の頂点(引き上げの着地点)
    }
    const b = bumpTopAt(x, z);
    if (b.lift > 0.005) hits.push({ topAbs: baseGroundAt(x, z) + b.lift, ax: b.anchor.x, az: b.anchor.z, kind: 'rock' });
    return hits;
  }
  /**
   * 足元を支える面。地面は常にある。面(丸太・岩)は、足元から見て上端が
   *   着地中: 歩ける段差以内 / 空中: ごく小さな余裕以内
   * なら足場として使える(それより高い面は、乗れない障害物)。
   * @returns {{y:number, terrain:number, onSurface:boolean, hit:object|null}}
   */
  function supportAt(x, z, feetY, airborne = false) {
    const terrain = baseGroundAt(x, z);
    let y = terrain, onSurface = false, best = null;
    const tol = airborne ? limits.airborneTolerance : limits.stepHeight;
    for (const h of surfaceHits(x, z)) {
      if (h.topAbs > feetY + tol) continue;
      if (h.topAbs > y) { y = h.topAbs; onSurface = true; best = h; }
    }
    return { y, terrain, onSurface, hit: best };
  }

  /**
   * 足元の円(x,z,radius)が倒木にめり込んでいたら水平に押し出す。ただし幹の頂点が
   * 「足元+許容(着地中は歩ける段差、空中はごく小さな値)」以下なら乗り越えられるので押し出さない。
   * 丸い足元(体の半径×WATER_FOOT_RADIUS_RATIO)で判定する(体全体の半径だと、細い幹の上へ降りる前に押し戻される)。
   */
  function resolveLogCollisions(x, z, radius, feetY, grounded) {
    radius *= WATER_FOOT_RADIUS_RATIO;
    const tol = grounded ? limits.stepHeight : limits.airborneTolerance;
    let px = x, pz = z;
    for (let iter = 0; iter < 2; iter++) {
      for (const { g } of surfaceLogs()) {
        const n = nearestOnLog(g, px, pz);
        if (!n) continue;
        const minDist = radius + n.r;
        if (n.d >= minDist) continue;
        const crest = n.axisY + n.r;
        if (crest <= feetY + tol) continue; // 乗り越えられる高さ
        const dx = px - n.cx, dz = pz - n.cz;
        if (n.d > 1e-6) { const push = minDist - n.d; px += (dx / n.d) * push; pz += (dz / n.d) * push; }
        else { const hl = Math.sqrt(g.ahSq); px += minDist * -g.az / hl; pz += minDist * g.ax / hl; }
      }
    }
    return { x: px, z: pz };
  }

  // ---- 着地の補助(forgiving mounting) ----
  /**
   * 空中で、幹の頂点より少し上を下降している時、幹の縁のすぐ外(LANDING_CATCH_DISTANCE以内)なら、
   * 水平に幹の上へそっと寄せる。中心線へ正確に降りなくても乗れて、縁で弾かれて落ちることもない。
   * 足元が頂点より低い(=下から来た)場合や、ずっと外側の場合は何もしない(届かない面を吸い付けない)。
   * @returns {{x:number,z:number,assisted:boolean}}
   */
  function assistLanding(x, z, feetY, vy, delta = 1 / 60) {
    if (vy >= 0) return { x, z, assisted: false };
    let best = null;
    for (const { g } of surfaceLogs()) {
      const n = nearestOnLog(g, x, z);
      if (!n) continue;
      const crest = n.axisY + n.r;
      const above = feetY - crest;
      if (above < -(limits.airborneTolerance - 0.01) || above > 0.5) continue; // 幹の頂点のすぐ上(押し出しが始まる手前まで)を降りてくる時だけ
      if (n.d >= n.r + LANDING_CATCH_DISTANCE || n.d <= n.r * 0.5) continue; // 縁のすぐ外だけ(すでに真上なら不要)
      if (!best || crest > best.crest) best = { n, crest };
    }
    if (!best) return { x, z, assisted: false };
    const { n } = best;
    const want = n.d - n.r * 0.45;                                // 幹の頂上の近く(縁から十分内側)まで寄せたい量
    const move = Math.min(want, Math.max(0.6 * want, 8.0 * delta)); // 一気にではなく、数フレームで滑らかに
    const k = move / n.d;
    return { x: x + (n.cx - x) * k, z: z + (n.cz - z) * k, assisted: true };
  }

  // ---- 手で引き上げる(findClimb) ----
  /**
   * 進行方向(dirX,dirZ)の手の届く範囲に、ジャンプでは乗れないが手で縁をつかんで登れる面があれば、
   * その上の着地点を返す。無ければ null。物の種類は見ない(面の高さと位置だけ)。
   * @returns {{x,z,y,rise,hit}|null}
   */
  function findClimb(x, z, feetY, dirX, dirZ) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return null;
    dirX /= len; dirZ /= len;
    const baseR = limits.moverRadius;
    const reach = baseR + limits.handReachDistance;
    let best = null;
    for (const ang of [0, -0.35, 0.35, -0.7, 0.7]) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dx = dirX * ca - dirZ * sa, dz = dirX * sa + dirZ * ca;
      for (let s = 0.3; s <= reach + 1e-6; s += 0.2) {
        const px = x + dx * s, pz = z + dz * s;
        for (const h of surfaceHits(px, pz)) {
          // 縁の高さではなく、乗った先(軸の真上の頂点)の高さで判断する(丸太の脇腹に「低い足場」があるわけではない)
          const top = h.crest ?? h.topAbs;
          const rise = top - feetY;
          if (rise <= limits.maxLandingHeight || rise > limits.handReachHeight) continue;
          const score = s + Math.abs(ang) * 0.6;
          if (!best || score < best.score) best = { score, x: h.ax, z: h.az, y: top, rise, hit: h };
        }
      }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, y: best.y, rise: best.rise, hit: best.hit };
  }

  /** 進行方向の面に対して、どの動作が必要か(診断・見守りの判断用)。面が無ければ null。 */
  function describeAhead(x, z, feetY, dirX, dirZ, maxDist = 1.2) {
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len; dirZ /= len;
    let best = null;
    for (let s = 0.2; s <= maxDist + 1e-6; s += 0.2) {
      for (const h of surfaceHits(x + dirX * s, z + dirZ * s)) {
        const rise = h.topAbs - feetY;
        if (!best || s < best.dist) best = { dist: s, rise, action: evaluateAction(rise, limits), hit: h };
      }
      if (best) break;
    }
    return best;
  }

  // ---- 川: 足元を支える面があれば水の上でも歩ける。無ければ入れない ----
  const FOOT_RING = 6;
  function isWaterAt(x, z) { return Number.isFinite(waterSurfaceAt(x, z)); }
  /**
   * (x,z)で足元が支えられているか(丸太などの面の上、または真上の空中)。
   * 面の上端が、足元の少し下〜歩ける段差の上、にあれば支えられている。
   */
  function isSupportedBySurface(x, z, feetY) {
    for (const h of surfaceHits(x, z)) {
      if (h.topAbs <= feetY + limits.stepHeight && h.topAbs >= feetY - 1.0) return true;
    }
    return false;
  }
  /**
   * 足元の円(中心+周囲の6点)のどこかが水に入る位置か。ただし中心が面に支えられていれば、下が水でも歩ける。
   * feetY=null なら支えなしとして判定する。
   */
  function isWaterBlocked(x, z, feetY = null) {
    if (feetY !== null && isSupportedBySurface(x, z, feetY)) return false;
    if (isWaterAt(x, z)) return true;
    const rr = limits.moverRadius * WATER_FOOT_RADIUS_RATIO;
    for (let i = 0; i < FOOT_RING; i++) {
      const a = (i / FOOT_RING) * Math.PI * 2;
      if (isWaterAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr)) return true;
    }
    return false;
  }
  /** 線分上で、最初に水へ入る手前の割合(0〜1)。水に入らなければ1。細かく調べるので1歩が大きくてもすり抜けない。 */
  function freeFraction(x0, z0, x1, z1, feetY) {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.min(60, Math.max(1, Math.ceil(dist / 0.2)));
    let last = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (isWaterBlocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, feetY)) return last;
      last = t;
    }
    return 1;
  }
  /**
   * 移動 (prevX,prevZ)→(x,z) を、水に入らない範囲へ直す。足元の高さ feetY で支えが取れる位置は通す。
   * ジャンプでも、支えが無い水の上には着地しない(水平位置を常に守る)。
   */
  function guardWater(prevX, prevZ, x, z, feetY = null) {
    if (isWaterBlocked(prevX, prevZ, feetY)) return { x, z, blocked: false }; // すでに水の中(異常): 出ようとする移動は止めない
    if (freeFraction(prevX, prevZ, x, z, feetY) >= 1) return { x, z, blocked: false };
    if (freeFraction(prevX, prevZ, x, prevZ, feetY) >= 1) return { x, z: prevZ, blocked: true };
    if (freeFraction(prevX, prevZ, prevX, z, feetY) >= 1) return { x: prevX, z, blocked: true };
    const f = freeFraction(prevX, prevZ, x, z, feetY);
    return { x: prevX + (x - prevX) * f, z: prevZ + (z - prevZ) * f, blocked: true };
  }

  // ---- 見守りの経路: 丸太の面を伝って向こう側へ渡れるか(物理的な到達可能性から調べる) ----
  /**
   * 現在地(fromX,fromZ。地面にいる)から、丸太の表面を伝って「水を挟んだ向こう側の地面」へ渡る経路を探す。
   * 丸太に「橋」の印は要らない。次を、面の実際の高さ・位置から確かめる:
   *   1. 入口(丸太の端の手前)まで、水を横切らずに歩いて行ける
   *   2. 入口で、丸太へ 歩いて/ジャンプで/手で引き上げて 乗れる(届かない高さなら使わない)
   *   3. 丸太の上を端から端まで、段差(急な傾き・途切れ)無しに歩ける
   *   4. 反対の端の先に、水ではない地面があり、降りる落差が安全な範囲
   *   5. 丸太の下に実際に水がある(=渡る意味がある)
   * @param {{isFailed?:(key:string)=>boolean, maxEntryDistance?:number, preferFar?:boolean}} [opts]
   * @returns {{key:string, approach:{x,z}, mount:{x,z,action,rise}, along:Array<{x,z}>, exit:{x,z}, log:object, span:number}|null}
   */
  function planLogCrossing(fromX, fromZ, opts = {}) {
    const isFailed = opts.isFailed || (() => false);
    const maxEntry = opts.maxEntryDistance ?? 30;
    const fromY = baseGroundAt(fromX, fromZ);
    let best = null;
    const logs = surfaceLogs();
    for (let li = 0; li < logs.length; li++) {
      const { log, g } = logs[li];
      const horiz = g.L * Math.sqrt(g.ahSq);
      if (horiz < 3) continue;
      const hx = g.ax / Math.sqrt(g.ahSq), hz = g.az / Math.sqrt(g.ahSq); // 水平な向き(根元→先端)
      for (const entryEnd of [0, 1]) {
        const key = `log:${log.physicsId ?? li}:${entryEnd}`;
        if (isFailed(key)) continue;
        // 入口側の端(u0)から出口側の端(u1)へ向かう向き(dir)
        const dir = entryEnd === 0 ? 1 : -1;
        const uIn = entryEnd === 0 ? 0 : g.L, uOut = entryEnd === 0 ? g.L : 0;
        const inP = { x: g.bx + g.ax * uIn, z: g.bz + g.az * uIn };
        const outP = { x: g.bx + g.ax * uOut, z: g.bz + g.az * uOut };
        const dx = dir * hx, dz = dir * hz; // 入口から出口への水平な単位ベクトル
        const approach = { x: inP.x - dx * 1.7, z: inP.z - dz * 1.7 };
        const distTo = Math.hypot(approach.x - fromX, approach.z - fromZ);
        if (distTo > maxEntry) continue;
        // 1. 入口まで水を横切らずに行ける(足元は地面)
        if (isWaterBlocked(approach.x, approach.z, null)) continue;
        if (freeFraction(fromX, fromZ, approach.x, approach.z, null) < 1) continue;
        // 2. 入口で乗れるか
        const uMount = Math.min(g.L * 0.5, 0.9) * (dir === 1 ? 1 : -1) + uIn; // 端から少し内側
        const mx = g.bx + g.ax * uMount, mz = g.bz + g.az * uMount;
        const mTop = logSurfaceTop(g, mx, mz, 0);
        if (mTop === -Infinity) continue;
        const approachGround = baseGroundAt(approach.x, approach.z);
        const rise = mTop - approachGround;
        let action = evaluateAction(rise + 0.05, limits); // 余裕を見る(歩ける高さぎりぎりの時は、跳ぶ・登る側へ倒して、押し戻されて詰まらないように)
        // v1.56-H5: 手が届かない高さでも、スクランブル(よじ登り)の上限までは「登る」で乗れる
        if (action === ACTION.UNREACHABLE && rise + 0.05 <= SCRAMBLE_MAX_HEIGHT) action = ACTION.CLIMB;
        if (action === ACTION.UNREACHABLE) continue;
        // 3. 丸太の上を歩ける(0.5mごとに、段差・途切れが無い)
        let ok = true, prevTop = mTop, overWater = false;
        const along = [];
        const total = Math.abs(uOut - uMount);
        const steps = Math.max(1, Math.ceil(total / 0.5));
        for (let i = 1; i <= steps && ok; i++) {
          const u = uMount + (uOut - uMount) * (i / steps);
          const px = g.bx + g.ax * u, pz = g.bz + g.az * u;
          const top = logSurfaceTop(g, px, pz, 0);
          if (top === -Infinity || Math.abs(top - prevTop) > limits.stepHeight * 0.9) { ok = false; break; }
          prevTop = top;
          if (isWaterAt(px, pz)) overWater = true;
          if (i % 4 === 0 || i === steps) along.push({ x: px, z: pz });
        }
        if (!ok || !overWater) continue; // 5. 水の上を渡らない丸太は、渡る経路として使わない
        // 4. 出口: 反対の端の先に地面がある
        const exit = { x: outP.x + dx * 1.8, z: outP.z + dz * 1.8 };
        if (isWaterBlocked(exit.x, exit.z, null)) continue;
        const drop = prevTop - baseGroundAt(exit.x, exit.z);
        if (drop > SAFE_DROP_HEIGHT || drop < -limits.stepHeight) continue;
        const span = total;
        const score = distTo - (opts.preferFar ? span * 0.1 : 0);
        if (!best || score < best.score) best = { score, key, approach, mount: { x: mx, z: mz, action, rise }, along, exit, log, span };
      }
    }
    if (!best) return null;
    const { score, ...route } = best;
    return route;
  }

  /**
   * v1.56-H5: from→to の進路をふさぐ丸太を、よじ登って乗り越える計画。
   * 進路(線分)が丸太の軸と交わる所の、手前(approach)・てっぺん(crest)・向こう側の地面(exit)を返す。無ければ null。
   * 高さ(approachの地面からてっぺんまで)が maxHeight 以下、降りる落差が maxDrop 以下、手前と向こうが isBlocked でない丸太だけ。
   * 水の上を渡る丸太(planLogCrossing)とは別: 水に関係なく、地面の上の丸太を乗り越える。
   */
  function planHurdle(fromX, fromZ, toX, toZ, opts = {}) {
    const maxHeight = opts.maxHeight ?? SCRAMBLE_MAX_HEIGHT, maxDrop = opts.maxDrop ?? SCRAMBLE_MAX_DROP;
    const isBlocked = opts.isBlocked || (() => false);
    const isFailed = opts.isFailed || (() => false);
    const dx = toX - fromX, dz = toZ - fromZ;
    let best = null;
    const logs = surfaceLogs();
    for (let li = 0; li < logs.length; li++) {
      const { log, g } = logs[li];
      const key = `hurdle:${log.physicsId ?? li}`;
      if (isFailed(key)) continue;
      const ex = g.ax * g.L, ez = g.az * g.L; // 軸の水平ベクトル(根元→先端、全長)
      const denom = dx * ez - dz * ex;
      if (Math.abs(denom) < 1e-6) continue; // 進路と軸が平行: 横切らない
      const t = ((g.bx - fromX) * ez - (g.bz - fromZ) * ex) / denom; // 進路上の位置(0=出発, 1=目的地)
      const sAxis = ((g.bx - fromX) * dz - (g.bz - fromZ) * dx) / denom; // 軸上の位置(0=根元, 1=先端)
      if (t <= 0 || t >= 1 || sAxis < 0.04 || sAxis > 0.96) continue; // 出発と目的地の間で、丸太の途中を横切る時だけ
      const u = sAxis * g.L;
      const px = g.bx + g.ax * u, pz = g.bz + g.az * u;
      const ah = Math.sqrt(g.ahSq) || 1e-6;
      let nx = -g.az / ah, nz = g.ax / ah; // 軸に垂直な水平の向き
      if ((fromX - px) * nx + (fromZ - pz) * nz > 0) { nx = -nx; nz = -nz; } // 出発側から目的地側へ向く
      const r = g.r0 + (g.r1 - g.r0) * (u / g.L);
      const ax = px - nx * (r + 0.8), az = pz - nz * (r + 0.8);   // よじ登る手前
      const exx = px + nx * (r + 0.9), ezz = pz + nz * (r + 0.9); // 向こう側の地面
      if (isBlocked(ax, az) || isBlocked(exx, ezz) || isWaterBlocked(ax, az, null) || isWaterBlocked(exx, ezz, null)) continue;
      const top = logSurfaceTop(g, px, pz, 0);
      if (top === -Infinity) continue;
      const rise = top - baseGroundAt(ax, az), exitY = baseGroundAt(exx, ezz), drop = top - exitY;
      if (rise > maxHeight || drop > maxDrop || rise < -0.2) continue;
      const score = Math.hypot(ax - fromX, az - fromZ);
      if (!best || score < best.score) best = { score, key, log, approach: { x: ax, z: az }, crest: { x: px, z: pz, y: top }, exit: { x: exx, z: ezz, y: exitY }, rise, drop };
    }
    if (!best) return null;
    const { score, ...plan } = best;
    return plan;
  }

  return {
    limits, evaluateAction: (rise) => evaluateAction(rise, limits), planHurdle,
    surfaceHits, supportAt, resolveLogCollisions, assistLanding, findClimb, describeAhead,
    isWaterBlocked, guardWater, isWaterAt, isSupportedBySurface, planLogCrossing,
    surfaceLogs,
    /** 立っている/急な丸太は、面ではなく従来の円の障害物として扱う。 */
    isSteepLog: (log) => isSteepLog(geomOf(log)),
    /** 見守りが避けるべき丸太か: 歩いて上がれない(両端とも段差が歩ける高さを超える)、または急な丸太。 */
    needsAction: (log) => {
      const g = geomOf(log);
      if (isSteepLog(g)) return true;
      const lift = (u) => (g.by + g.ay * u + (g.r0 + (g.r1 - g.r0) * (u / g.L))) - baseGroundAt(g.bx + g.ax * u, g.bz + g.az * u);
      return Math.min(lift(0), lift(g.L)) > limits.stepHeight;
    },
  };
}
