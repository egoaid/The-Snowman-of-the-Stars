// wander-nav.js
// 見守りモード(雪だるまの自律歩行)の、障害物まわりの純粋な計算部品。
// 2026-09(v1.25): 「かまくらの前で雪だるまが高速回転して見える」不具合への
// 対応で、scene3d.js内に埋まっていた回避・衝突・向きの処理をここへ切り出した。
// (切り出したのは、実際のシーンと全く同じコードをNode.jsのヘッドレス検証
//  (verify_wander_igloo.mjs)から呼んで再現・検証できるようにするため。)
//
// 【不具合の原因】
// かまくらへ出入りする時の「入口の外の経由点」が、入口から外周+2.0mの位置に
// あった。一方、焚き火は入口の真正面(外周+2.6m)にあり、経由点は焚き火の
// 中心からわずか0.6mだった。焚き火の衝突円(半径0.9m+雪だるまの半径)より
// ずっと内側なので、雪だるまは経由点に永遠に着けず、焚き火の縁で押し戻され
// 続けた。向きは毎フレーム進行方向で即座に決めていたため、押し戻されて
// 進行方向が変わるたびに向きがちらつき、高速回転して見えた。
//
// 【対策】(どれも個別の座標調整ではなく、アルゴリズムで一般化してある)
// 1. 目的地/経由点は、必ず障害物の衝突円の外へ押し出してから使う
//    (pushOutOfObstacles)。焚き火・木・岩など、どの障害物の近くでも有効。
// 2. 向きの変化に上限を設ける(stepHeading)。仮に進行方向がちらついても
//    高速回転には見えない。
// 3. スタック検知に「目的地へ近づけていない」判定を加える
//    (isMakingProgress)。円を描いてすべっているだけで「動いている」と
//    誤判定されていた。

/** 角度を -π〜π に正規化する。 */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * 現在の向きから目標の向きへ、最大回転速度(rad/秒)を超えない範囲で回す。
 * 戻り値は新しい向き(元のcurrentから連続した値。範囲の正規化はしない)。
 */
export function stepHeading(current, desired, maxRate, delta) {
  const diff = wrapAngle(desired - current);
  const maxStep = maxRate * delta;
  return current + Math.max(-maxStep, Math.min(maxStep, diff));
}

/** 歩行中の向きの最大回転速度(rad/秒)。約200°/秒。 */
export const WANDER_MAX_TURN_RATE = 3.5;

/**
 * 円形の障害物(collisionObstacles)との重なりを押し出して解消する。
 * scene3d.jsのresolveCollisionsと同じ処理(隣接する障害物同士の干渉を
 * 軽く緩和するため2回反復)。
 */
export function resolveCircleCollisions(x, z, moverRadius, obstacles) {
  let px = x, pz = z;
  for (let iter = 0; iter < 2; iter++) {
    for (const obs of obstacles) {
      const dx = px - obs.x, dz = pz - obs.z;
      const dist = Math.hypot(dx, dz);
      const minDist = moverRadius + obs.radius;
      if (dist < minDist) {
        if (dist > 1e-6) {
          const push = minDist - dist;
          px += (dx / dist) * push;
          pz += (dz / dist) * push;
        } else {
          px += minDist; // 中心が完全に重なった異常値への保険
        }
      }
    }
  }
  return { x: px, z: pz };
}

/**
 * 進行方向(dirX, dirZ。正規化済み)のすぐ先にある障害物を避ける
 * 「回避ベクトル」を返す簡易ステアリング(scene3d.jsのcomputeAvoidSteerと
 * 同じ処理)。
 */
export function computeAvoidSteer(px, pz, dirX, dirZ, obstacles, lookahead = 3.5, margin = 0.6) {
  let closestT = Infinity;
  let avoidX = 0, avoidZ = 0, wall = null;
  for (const obs of obstacles) {
    const ox = obs.x - px, oz = obs.z - pz;
    const t = ox * dirX + oz * dirZ;
    if (t <= 0 || t >= lookahead) continue;
    const closestX = px + dirX * t, closestZ = pz + dirZ * t;
    const perpX = obs.x - closestX, perpZ = obs.z - closestZ;
    const perpDist = Math.hypot(perpX, perpZ);
    const effectiveRadius = obs.radius + margin;
    if (perpDist < effectiveRadius && t < closestT) {
      closestT = t;
      wall = obs.wall || null; // v1.51: 倒木の円なら、その幹(壁)の情報。迂回の経由点づくりに使う
      const pushDist = effectiveRadius - perpDist;
      if (perpDist > 1e-6) {
        avoidX = -(perpX / perpDist) * pushDist;
        avoidZ = -(perpZ / perpDist) * pushDist;
      } else {
        avoidX = -dirZ * pushDist;
        avoidZ = dirX * pushDist;
      }
    }
  }
  return { x: avoidX, z: avoidZ, blocked: closestT < Infinity, wall };
}

/**
 * 点(x,z)が、どれかの障害物の衝突円(+雪だるまの半径+余白)の内側に
 * あれば、その外側へ押し出した点を返す。目的地・経由点は必ずこれを通す。
 * (到着判定は目的地から0.3m以内なので、余白は0.3mより大きくする)
 * @param {number} clearance - 雪だるまの衝突半径 + 到着判定に足す余白
 */
export function pushOutOfObstacles(x, z, obstacles, clearance) {
  const isFree = (qx, qz) => obstacles.every((o) => Math.hypot(qx - o.x, qz - o.z) >= o.radius + clearance - 1e-9);
  let px = x, pz = z;
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const obs of obstacles) {
      const dx = px - obs.x, dz = pz - obs.z;
      const dist = Math.hypot(dx, dz);
      const minDist = obs.radius + clearance;
      if (dist < minDist) {
        if (dist > 1e-6) {
          px = obs.x + (dx / dist) * minDist;
          pz = obs.z + (dz / dist) * minDist;
        } else {
          px = obs.x + minDist; pz = obs.z;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (isFree(px, pz)) return { x: px, z: pz };
  // 隣り合う障害物(かまくらの柱の輪など)の間では、1つから押し出すともう1つの
  // 円に入ってしまい、押し出しだけでは解消しないことがある。その場合は、
  // 元の位置から近い順に同心円状に探して、最初に見つかった空き位置を返す。
  for (let r = 0.5; r <= 12; r += 0.5) {
    const n = Math.max(8, Math.ceil((Math.PI * 2 * r) / 0.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
      if (isFree(qx, qz)) return { x: qx, z: qz };
    }
  }
  return { x: px, z: pz }; // 12m以内に空きが無い異常な配置(実際には起こらない)
}

/**
 * かまくらの外壁に沿って並べる柱状の衝突判定(入口の隙間はあけておく)。
 * scene3d.jsのsetCampCollisionMode()と同じ計算。
 */
export function buildIglooPostObstacles(campX, campZ, outerRadius, doorwayWorldDir, doorwayHalfAngle) {
  const posts = [];
  const gapHalfAngle = doorwayHalfAngle + 0.12; // 見た目の開口部より少し広めに(擦れ防止)
  const doorwayAngle = Math.atan2(doorwayWorldDir.x, doorwayWorldDir.z);
  const postCount = 20;
  const postRadius = outerRadius * Math.sin(Math.PI / postCount) * 1.35;
  for (let i = 0; i < postCount; i++) {
    const angle = doorwayAngle + (i / postCount) * Math.PI * 2;
    const diff = wrapAngle(angle - doorwayAngle);
    if (Math.abs(diff) < gapHalfAngle) continue;
    posts.push({
      x: campX + Math.sin(angle) * outerRadius * 0.97,
      z: campZ + Math.cos(angle) * outerRadius * 0.97,
      radius: postRadius,
    });
  }
  return posts;
}

/**
 * 「進めているか」の判定。一定時間(スタック確認間隔)で、
 * (a) ほとんど移動していない、または
 * (b) 目的地までの距離が縮んでいない(円を描いてすべっているだけ)
 * ならfalse。(b)は、障害物を大回りする正常な迂回でも一時的に起こりうる
 * ため、呼び出し側で2回連続した時だけスタックとみなす。
 */
export function isMakingProgress(movedDistance, distToTargetBefore, distToTargetNow, minMove = 0.35, minApproach = 0.25) {
  if (movedDistance < minMove) return { moved: false, approaching: false };
  return { moved: true, approaching: distToTargetNow <= distToTargetBefore - minApproach };
}

/**
 * v1.51: 長い倒木(壁)に塞がれた時の、端を回り込む経由点を2つ作る。
 * 円ごとの回避ステアリングは、壁の中央に真正面から向かうと左右が決まらず、凹凸で立ち往生し、
 * 端を回れても目的地へ戻る斜めの線がまた壁にかかって行ったり来たりする。そこで
 * 「近い方の端の、少し先で、いま居る側」→「その端の少し先で、反対側」の2点を先に通ってから目的地へ向かう。
 * @param wall { x1, z1, x2, z2, r } 幹の両端と太い方の半径(x-z平面)
 * @returns {{x:number,z:number}[]} [W1(いま居る側), W2(反対側)]
 */
export function planWallDetour(px, pz, wall, moverRadius, margin = 0.45) {
  const vx = wall.x2 - wall.x1, vz = wall.z2 - wall.z1;
  const len = Math.hypot(vx, vz) || 1;
  const tx = vx / len, tz = vz / len; // 壁の向き(端1→端2)
  const nx = -tz, nz = tx; // 壁の法線
  const t = (px - wall.x1) * tx + (pz - wall.z1) * tz; // 壁に沿った、自分の位置
  const useEnd2 = t > len / 2; // 近い方の端
  const ex = useEnd2 ? wall.x2 : wall.x1, ez = useEnd2 ? wall.z2 : wall.z1;
  const out = useEnd2 ? 1 : -1; // 端から外へ向かう向き
  const side = ((px - wall.x1) * nx + (pz - wall.z1) * nz) >= 0 ? 1 : -1; // いま居る側
  const reach = moverRadius + wall.r + margin;
  const along = reach, lateral = reach;
  const bx = ex + tx * out * along, bz = ez + tz * out * along;
  return [
    { x: bx + nx * side * lateral, z: bz + nz * side * lateral },
    { x: bx - nx * side * lateral, z: bz - nz * side * lateral },
  ];
}
