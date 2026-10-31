// igloo-rules.js (v1.95)
// 置いた「雪のかまくら」の溶け方のきまり(画面・three.js に依存しない。Nodeで試験できる)。
//   ・雪のない時期(雪が積もっていない・降っていない)は、置いた時から溶けはじめ、約1分で小さくなって消える(夏の晴れた日など)。
//   ・冬に置いたかまくらは、周りの雪が全部溶けてから、同じように約1分で消える。雪が積もっている間は溶けない。
//   ・雪が戻ってきたら、溶けるのは止まる(小さくなった分は、戻らない)。消える前に拾えば、またアイテムになる(消えたら、アイテムごとなくなる)。
export const IGLOO = {
  meltSec: 60,          // 溶けはじめてから消えるまで(秒)
  bareDepth: 0.03,      // これ未満の積雪なら「周りの雪が溶けた」
  minScale: 0.1,        // 消える直前の大きさ
  solidUntil: 0.6,      // これを過ぎたら、歩いて通り抜けられる・丸太が載らない(もう小さいので)
  snowballs: 100,       // 作るのに要る雪玉
};

/** 溶け具合(0=無傷、1=消える)を進める */
export function iglooMeltStep({ melt, delta, depth, snowing }) {
  if (depth >= IGLOO.bareDepth || snowing) return melt;
  return Math.min(1, melt + delta / IGLOO.meltSec);
}
/** 溶け具合から、見た目の大きさ(1→0.1) */
export function iglooScale(melt) { return 1 - (1 - IGLOO.minScale) * Math.min(1, Math.max(0, melt)); }
/** まだ硬い(当たり判定を残す)か */
export function iglooIsSolid(melt) { return melt < IGLOO.solidUntil; }
