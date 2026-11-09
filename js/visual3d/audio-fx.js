// audio-fx.js (v1.105) — 立体音響 第3段階「環境に応じた音響表現」のきまり。画面に依存しない(Nodeで試験できる)。
//   ・遮蔽: 音源と聞き手のあいだに、丘・木の幹・葉の茂みがあると、音を、少し小さく・こもらせる(完全には消さない。やわらかくする)。
//   ・環境: 聞き手のいる所(森・川辺・雪原・開けた所)に合わせて、残響の量と明るさを変える。屋外なので、洞窟やホールのような強い残響にはしない。

/**
 * 聞き手 a と音源 b のあいだの、遮蔽の強さ(0=見通せる 〜 1=すっかり遮られている)。
 *   heightAt(x,z): 地面の高さ / cyls: 木の幹・岩 [{x,z,y0,y1,r}] / spheres: 葉の茂み [{x,z,cy,r}]
 *   丘の向こうは強く(最大0.75)、木の幹は1本ごとに0.28、葉の茂みは1つごとに0.12。足して、最大1。
 */
export function occlusionAmount(a, b, { heightAt, cyls = [], spheres = [], terrainStep = 2 } = {}) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  if (len < 1.2) return 0;
  let occ = 0;
  if (heightAt) { // 丘: 線が、地面の下を通る所があるか
    const n = Math.min(24, Math.max(2, Math.floor(len / terrainStep))); let worst = 0;
    for (let i = 1; i < n; i++) {
      const t = i / n, x = a.x + dx * t, z = a.z + dz * t, y = a.y + dy * t, clear = y - heightAt(x, z);
      if (clear < 0.25) worst = Math.max(worst, Math.min(1, 0.45 + (0.25 - clear) / 1.8));
    }
    occ += 0.75 * worst;
  }
  const d2 = dx * dx + dz * dz;
  for (const c of cyls) { // 幹・岩: 水平に、円を通り抜けるか(通る所の高さが、幹の高さの範囲か)
    let t = d2 > 1e-6 ? ((c.x - a.x) * dx + (c.z - a.z) * dz) / d2 : 0; t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t, pz = a.z + dz * t, py = a.y + dy * t;
    if (Math.hypot(px - c.x, pz - c.z) < c.r && py > c.y0 - 0.2 && py < c.y1 + 0.2) occ += 0.28;
  }
  const L2 = len * len;
  for (const s of spheres) { // 葉の茂み: 球を通り抜けるか
    let t = ((s.x - a.x) * dx + (s.cy - a.y) * dy + (s.z - a.z) * dz) / L2; t = Math.max(0, Math.min(1, t));
    if (Math.hypot(a.x + dx * t - s.x, a.y + dy * t - s.cy, a.z + dz * t - s.z) < s.r) occ += 0.12;
  }
  return Math.min(1, occ);
}
/** 遮蔽の強さ → 音量の倍率(最大で、約 -5dB)と、高音域の残り(最大で、4分の1まで)。完全には消さない。 */
export const occlusionGain = (amt) => 1 - 0.45 * Math.max(0, Math.min(1, amt));
export const occlusionCutoffMul = (amt) => 1 - 0.75 * Math.max(0, Math.min(1, amt));

/**
 * 聞き手のいる環境。{ trees: 近く(14m以内)の木の数, riverClearance: 水際までの距離(m), snowDepth }
 * @returns {{ name:'forest'|'riverside'|'snowfield'|'open', wetMul:number, damp:number }}
 *   wetMul: 残響の量の倍率 / damp: 残響の高音域の上限(Hz。小さいほど、やわらかい)
 */
export function classifyEnvironment({ trees = 0, riverClearance = Infinity, snowDepth = 0 } = {}) {
  if (snowDepth > 0.3 && trees < 8) return { name: 'snowfield', wetMul: 0.45, damp: 3500 };  // 雪原: 雪が音を吸って、ほとんど響かない
  if (trees >= 8) return { name: 'forest', wetMul: 1.25, damp: 5500 };                       // 森: 幹や葉で、やわらかく、拡散した残響
  if (riverClearance < 8) return { name: 'riverside', wetMul: 1.0, damp: 9000 };            // 川辺: 水面に、明るく反射する
  return { name: 'open', wetMul: 0.85, damp: 7000 };                                         // 開けた所: 反射が少ない
}
