// snow-melt.js (v1.96)
// 季節ごとの「雪が全部消えるまで」のきまり。画面や three.js に依存しない(Nodeで試験できる)。
//   ・ゲーム内の1日 = 昼夜サイクル1周 = 現実の1200秒(現実50秒 ≒ ゲーム内1時間)。
//   ・冬に積もった雪は、季節を冬以外にすると、次の時間で消える(最大の積雪量からでも、この時間で消える)。
//       春 = 1日、夏(梅雨・台風の時期も含む) = 半日、秋 = 2日
//   ・冬の間は、これまでどおりのゆっくりした融け方のまま(null を返す)。
export const GAME_DAY_REAL_SEC = 1200;
export const SNOW_MELT_DAYS = { spring: 1, tsuyu: 0.5, summer: 0.5, typhoon: 0.5, autumn: 2 };

/** その季節に、雪が全部消えるまでの現実の秒数。冬(など未定義の季節)は null。 */
export function snowMeltSeconds(season) {
  const d = SNOW_MELT_DAYS[season];
  return d ? d * GAME_DAY_REAL_SEC : null;
}
