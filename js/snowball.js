// snowball.js (v1.94)
// 雪玉のきまり(画面・three.js に依存しない。Nodeで試験できる)。
//   ・集める: 雪が積もっていれば、あらゆる場所の雪面から、何も持たずに長押しで集められる。続けて押していれば、続けて集まる。
//   ・集めた所の雪面は、少しへこんで、約5秒で元に戻る。
//   ・持ち物の中の雪玉は、雪のない暖かい時期(雪が積もっていない・降っていない)に、少しずつ溶ける。チェストの中は、溶けない。
//   ・投げる: 雪玉を手に持ってクリック。物・木・水面・雪面に当たると、飛び散って消える。
export const SNOWBALL = {
  gatherSec: 0.45,      // 1個集めるのにかかる時間(長押し)
  minDepth: 0.08,       // これ以上積もっていれば、集められる(m)
  reach: 3.2,           // 雪だるまから、これ以内の雪面だけ集められる(m)
  dentRadius: 0.7, dentDepth: 0.16, dentSec: 5, // 集めたあとのへこみ: 半径・深さ(m)・埋まるまで(秒)
  meltSec: 90,          // 暖かい時期に、持ち物の雪玉が1個溶けるまで(秒)
  meltMaxDepth: 0.05,   // 雪がこれ未満の積雪なら「雪のない時期」
  speed: 13, lift: 2.2, gravity: 9.8, radius: 0.09, maxLife: 4, maxActive: 12, // 投げる: 初速(m/s)・上向きの足し(m/s)・重力・玉の半径・最長の飛ぶ時間(秒)・同時に飛ぶ数
};

/** 雪面から集められるか(手が空で、雪が積もっている) */
export function canGather({ depth, selected }) { return depth >= SNOWBALL.minDepth && !selected; }

/** 持ち物の雪玉が溶ける時間を進める。溶けて1個減る時だけ melted=true。 */
export function nextMelt({ timer, delta, depth, snowing, count }) {
  if (count <= 0 || depth >= SNOWBALL.meltMaxDepth || snowing) return { timer: 0, melted: false };
  const t = timer + delta;
  return t >= SNOWBALL.meltSec ? { timer: 0, melted: true } : { timer: t, melted: false };
}

/** 投げる向き(単位ベクトル dir)から、初速を作る。少し上向きに足して、ゆるい放物線にする。 */
export function throwVelocity(dir) { return { vx: dir.x * SNOWBALL.speed, vy: dir.y * SNOWBALL.speed + SNOWBALL.lift, vz: dir.z * SNOWBALL.speed }; }

/**
 * 雪玉を dt 秒だけ進める。当たったら、当たった物の種類を返す(null=まだ飛んでいる)。
 * @param {{x,y,z,vx,vy,vz,age}} b 雪玉の状態(その場で更新する)
 * @param {{groundAt:(x,z)=>number, obstacleAt:(x,y,z)=>boolean, waterAt:(x,z)=>number}} env
 *   groundAt: 雪面の高さ / obstacleAt: 木・岩・置いた物などにぶつかるか / waterAt: 水面の高さ(水がなければ NaN)
 * @returns {null|'ground'|'obstacle'|'water'|'timeout'}
 */
export function stepSnowball(b, dt, env) {
  const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy, b.vz) * dt) / 0.2)); // 速くても、すり抜けない細かさ
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    b.vy -= SNOWBALL.gravity * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    if (env.obstacleAt(b.x, b.y, b.z)) return 'obstacle';
    const w = env.waterAt(b.x, b.z);
    if (Number.isFinite(w) && b.y <= w) return 'water';
    if (b.y <= env.groundAt(b.x, b.z) + SNOWBALL.radius * 0.5) return 'ground';
  }
  b.age += dt;
  return b.age >= SNOWBALL.maxLife ? 'timeout' : null;
}
