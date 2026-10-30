// fire-rules.js (v1.88)
// 置いた焚き火の、着火・消火・雨のきまり。画面や three.js に依存しない(Nodeで試験できる)。
//   ・着火: 星の松明を持って、消えている焚き火をクリック。雨の中ではつかない。
//   ・消火: 手に何も持たずに、ついている焚き火をクリック。
//   ・雨: 雨・雷雨・台風(降り方が FIRE_RAIN_MIN 以上)が続くと、湿っていって、ひとりでに消える。止めば乾く。
//   ・燃料: 減らない(「何も起こらない時間」を邪魔しないため)。
export const FIRE_RAIN_MIN = 0.4;
export const FIRE_TORCH_ITEM = 'star_torch';
export const FIRE_WET_LIMIT = [25, 60]; // 強い雨で消えるまでの秒数(1本ずつ違う)
const DRY_RATE = 0.6;                   // 降っていない間に乾く速さ(秒あたり)

/** クリックされた時の結果。 */
export function fireAction({ lit, selected, rain }) {
  if (lit) return selected ? 'need-empty-hand' : 'extinguish';
  if (selected !== FIRE_TORCH_ITEM) return 'need-torch';
  if (rain >= FIRE_RAIN_MIN) return 'rain';
  return 'ignite';
}
/** 湿り具合を進める(降っている間は増え、止むと乾く)。 */
export function nextWet(wet, delta, rain) { return Math.max(0, wet + delta * (rain >= FIRE_RAIN_MIN ? rain : -DRY_RATE)); }
export function pickWetLimit(rng = Math.random) { return FIRE_WET_LIMIT[0] + rng() * (FIRE_WET_LIMIT[1] - FIRE_WET_LIMIT[0]); }
