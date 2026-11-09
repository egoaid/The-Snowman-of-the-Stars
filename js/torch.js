// torch.js (v1.104) — 「炎の松明」のきまり。画面に依存しない(Nodeで試験できる)。
//   ・松明の木(小枝・丸太から作る)を手に持って、焚き火を叩くと着火して、炎の松明になる。
//   ・炎の松明は、手に持つことも、地面に置くこともできる。消耗品で、少しずつ短くなり、最後は炎が消えて、アイテムも消える。
//   ・短くなる様子は、4つの段階(torch → torch_2 → torch_3 → torch_4)の、アイテムで表す(1つ1つの燃え方を、持ち物に持たせなくてよい)。
//   ・手に持っている間と、置いてある間だけ、燃える。
export const TORCH_STAGES = ['torch', 'torch_2', 'torch_3', 'torch_4']; // 長い → 短い
export const STAGE_SEC = 300;               // 1段階が燃える時間(現実の秒)。全部で20分
export const TORCH_TOTAL_SEC = STAGE_SEC * TORCH_STAGES.length;
const SCALE = [1, 0.86, 0.72, 0.58];        // 手に持った時の、見た目の長さ

export const torchStageIndex = (id) => TORCH_STAGES.indexOf(id);
export const isFireTorch = (id) => torchStageIndex(id) >= 0;
/** 次の段階のアイテム。最後の段階なら null(燃え尽きる)。 */
export function nextStage(id) { const i = torchStageIndex(id); return i < 0 || i + 1 >= TORCH_STAGES.length ? null : TORCH_STAGES[i + 1]; }
export const stageScale = (id) => SCALE[Math.max(0, torchStageIndex(id))] ?? 1;
/** その段階の松明が、あと燃えていられる秒数(段階のはじめ。置く時に、使う)。 */
export const lifeOfStage = (id) => { const i = torchStageIndex(id); return i < 0 ? 0 : (TORCH_STAGES.length - i) * STAGE_SEC; };
/** 残りの秒数から、拾った時に戻る、段階のアイテム(燃え尽きていたら null)。 */
export function stageFromLife(life) {
  if (!(life > 0)) return null;
  const used = TORCH_TOTAL_SEC - Math.min(TORCH_TOTAL_SEC, life), i = Math.min(TORCH_STAGES.length - 1, Math.floor(used / STAGE_SEC));
  return TORCH_STAGES[i];
}
/** 手に持っている間の、燃え方。tick(dt) が true を返したら、1段階、短くなる。 */
export function createTorchBurn() {
  let t = 0;
  return { tick(dt) { t += dt; if (t >= STAGE_SEC) { t -= STAGE_SEC; return true; } return false; }, reset() { t = 0; }, elapsed: () => t };
}
/** 夜か。見守りの雪だるまが、ホームの木で炎の松明を作って、夜の散歩をする。 */
export const NIGHT_TORCH = { needs: { twig: 3, log: 1 } }; // 松明の木1本ぶん: 小枝3本、または丸太1本(丸太1本で4本)
