// season.js
// 実時刻(または手動指定)から「日本の暦に沿った季節」を判定し、
// それに応じた天候の出現傾向・葉/地面の色味を提供する。
//
// 設計方針:
// - 天候(weather.js)の自動切り替えロジックとは責務を分離する。
//   このファイルは「今どの季節か」「その季節ならどんな天候になりやすいか」
//   「その季節の見た目の色は何色か」だけを扱い、実際に天候を切り替える
//   タイマー処理・パーティクル描画はweather.js側が担当する。
// - 季節は6区分(spring/tsuyu/summer/typhoon/autumn/winter)で内部管理する。
//   「梅雨」「台風シーズン」は気象学的な独立した季節ではないが、
//   このアプリでは「天候の出現傾向が明確に変わる期間」として重要なため、
//   独立区分として扱う(ユーザー要望: 梅雨=雨が多い、台風=雷雨が多い)。
// - 見た目(葉・地面の色)は4区分(spring/summer/autumn/winter)に丸めて使う。
//   梅雨は見た目としては夏(深緑)、台風シーズンは見た目としては秋(色づき始め)
//   の値を流用する。

import { t as tr } from '../i18n.js'; // (このファイルでは t を補間の変数に使うので、別名にする)

export const SEASONS = ['spring', 'tsuyu', 'summer', 'typhoon', 'autumn', 'winter'];


/**
 * 季節ごとの天候の「出やすさ」の重み(合計が1である必要はない。
 * weather.js側で正規化して確率的に選ぶ)。
 * - 梅雨: 雨が圧倒的に多い
 * - 台風シーズン: 雷雨(嵐)が多い
 * - 冬: 雪が中心。雷雨はほぼ無し
 */
const WEATHER_WEIGHTS = {
  spring: { clear: 0.55, rain: 0.35, storm: 0.10, snow: 0 },
  tsuyu: { clear: 0.15, rain: 0.62, storm: 0.23, snow: 0 },
  summer: { clear: 0.55, rain: 0.18, storm: 0.27, snow: 0 },
  typhoon: { clear: 0.28, rain: 0.24, storm: 0.48, snow: 0 },
  autumn: { clear: 0.58, rain: 0.34, storm: 0.08, snow: 0 },
  winter: { clear: 0.42, rain: 0.05, storm: 0.0, snow: 0.53 },
};

// 見た目(葉・地面)は4区分で管理。tsuyu→summer、typhoon→autumnへ丸める。
const VISUAL_CATEGORY = {
  spring: 'spring',
  tsuyu: 'summer',
  summer: 'summer',
  typhoon: 'autumn',
  autumn: 'autumn',
  winter: 'winter',
};

// 針葉樹の葉色(0x000000形式)。針葉樹は広葉樹ほど劇的には色が変わらないため、
// 控えめな色相シフトに留める(新緑=明るい黄緑、深緑=既存の基準色、
// 秋=わずかに黄味がかったオリーブ、冬=わずかに彩度を落として青みを足す)。
const LEAF_COLOR = {
  spring: 0x6ea84a,
  summer: 0x3d6a34,
  autumn: 0x6a6a34,
  winter: 0x46614a,
};

// 地形(草地)の基準色。草シェーダーのグラデーション両端(根元/先端)。
const GRASS_COLOR_LOW = {
  spring: [0.16, 0.32, 0.14],
  summer: [0.20, 0.33, 0.15],
  autumn: [0.30, 0.27, 0.12],
  winter: [0.22, 0.26, 0.20],
};
const GRASS_COLOR_HIGH = {
  spring: [0.45, 0.68, 0.32],
  summer: [0.42, 0.58, 0.28],
  autumn: [0.58, 0.48, 0.18],
  winter: [0.38, 0.44, 0.34],
};

// 地形メッシュ(トゥーンシェーディング)の基準色
const TERRAIN_COLOR = {
  spring: 0x5c8340,
  summer: 0x4d6b3c,
  autumn: 0x7a6a35,
  winter: 0x5a6152,
};

// 2026-09(v1.30): 「紅葉」対応で追加した広葉樹の葉色。LEAF_COLORは針葉樹用の
// 控えめな色(針葉樹は秋でも大きくは色づかない)なので、広葉樹はこちらの
// 鮮やかな色を使う。春夏は季節ごとに固定色、秋はgetAutumnProgress()の
// 進み具合(0〜1)に応じて「まだ夏の名残の緑」→「黄」→「橙」→「深い赤茶」と
// 連続的に変化させる(単純な season 4区分の切り替えでは、実際の紅葉のような
// 徐々に色づく過程を表現できないため)。冬は落葉済みなので、わずかに残る
// 枯れ葉用の地味な色にしておく(見た目にはほぼ影響しない)。
const BROADLEAF_LEAF_COLOR_SPRING = 0x8fd15c;
const BROADLEAF_LEAF_COLOR_SUMMER = 0x2f6b2a;
const BROADLEAF_LEAF_COLOR_WINTER = 0x6b5a3a;
// 秋の色の変化を表す制御点(t=0〜1, 色)。tの間は線形補間する。
const BROADLEAF_AUTUMN_STOPS = [
  { t: 0.0, color: 0x6a8f3a }, // 夏の名残の緑
  { t: 0.35, color: 0xd4b93a }, // 黄
  { t: 0.65, color: 0xdc7a1e }, // 橙
  { t: 1.0, color: 0x8a2f18 }, // 深い赤茶(落葉直前)
];

/**
 * 秋(見た目上の秋=台風シーズン〜秋、実際の暦の9/1〜12/1)の進み具合を
 * 0(始まったばかり)〜1(冬入り直前)の連続値で返す。台風シーズン・秋以外の
 * 季節では、冬なら1(=落葉済みのまま)、それ以外(春・梅雨・夏)なら0
 * (=まだ色づいていない)を返す。
 * @param {string} season SEASONSのいずれか(内部の6区分)
 * @param {Date} [date]
 */
export function getAutumnProgress(season, date = new Date()) {
  if (season === 'winter') return 1;
  if (season !== 'typhoon' && season !== 'autumn') return 0;
  const doy = dayOfYear(date);
  const bounds = seasonBoundaries(date.getFullYear());
  const typhoonStart = bounds.find((b) => b.season === 'typhoon').from;
  const winterStart = bounds.find((b) => b.season === 'winter').from;
  if (winterStart <= typhoonStart) return 0; // 安全弁(通常は起こらない)
  return Math.min(1, Math.max(0, (doy - typhoonStart) / (winterStart - typhoonStart)));
}

function lerpColor(a, b, t) {
  const ca = (a >> 16) & 0xff, ga = (a >> 8) & 0xff, ba = a & 0xff;
  const cb = (b >> 16) & 0xff, gb = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ca + (cb - ca) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * 広葉樹の葉色(0x000000形式)。visualCategoryは4区分('spring'|'summer'|
 * 'autumn'|'winter')、progressは getAutumnProgress() の戻り値
 * (visualCategoryが'autumn'の時のみ使う。それ以外では無視してよい)。
 */
export function getBroadleafLeafColor(visualCategory, progress) {
  if (visualCategory === 'spring') return BROADLEAF_LEAF_COLOR_SPRING;
  if (visualCategory === 'summer') return BROADLEAF_LEAF_COLOR_SUMMER;
  if (visualCategory === 'winter') return BROADLEAF_LEAF_COLOR_WINTER;
  const stops = BROADLEAF_AUTUMN_STOPS;
  const t = Math.min(1, Math.max(0, progress));
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1].t) {
      const span = stops[i + 1].t - stops[i].t;
      const localT = span > 1e-9 ? (t - stops[i].t) / span : 0;
      return lerpColor(stops[i].color, stops[i + 1].color, localT);
    }
  }
  return stops[stops.length - 1].color;
}

/**
 * 広葉樹の「落葉の進み具合」(0=満開の葉、1=完全に落葉)。
 * 実際の紅葉は、色づき始めてすぐには落ちず、しばらく色づいたまま
 * 枝についているため、progressの前半(15%)は色だけ変わり落葉は始まらない
 * ようにしている。
 * @param {number} progress getAutumnProgress()の戻り値
 */
export function getBroadleafDefoliation(progress) {
  const START = 0.15;
  if (progress <= START) return 0;
  return Math.min(1, (progress - START) / (1 - START));
}

function dayOfYear(date) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const cur = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((cur - start) / 86400000);
}

// 各季節の「開始日(年間通算日)」。日本の一般的な体感季節区分に基づく簡易モデル。
// 3/1始まり(春)〜翌年2月末(冬)で1周する。
function seasonBoundaries(year) {
  const d = (m, day) => dayOfYear(new Date(year, m - 1, day));
  return [
    { season: 'spring', from: d(3, 1) },
    { season: 'tsuyu', from: d(6, 1) },
    { season: 'summer', from: d(7, 16) },
    { season: 'typhoon', from: d(9, 1) },
    { season: 'autumn', from: d(10, 11) },
    { season: 'winter', from: d(12, 1) },
  ];
}

/**
 * 実際の日付から季節を自動判定する。
 * @param {Date} [date]
 * @returns {string} SEASONSのいずれか
 */
export function getAutoSeason(date = new Date()) {
  const doy = dayOfYear(date);
  const bounds = seasonBoundaries(date.getFullYear());
  let result = 'winter'; // 1月・2月は前年12月始まりの冬が継続している扱い
  for (const b of bounds) {
    if (doy >= b.from) result = b.season;
  }
  return result;
}

/** 季節の表示名。言語に合わせて、設定画面と同じ辞書(set.season.<id>)から引く。 */
export function getSeasonLabel(season) {
  return SEASONS.includes(season) ? tr(`set.season.${season}`) : season;
}

/**
 * 季節システムを作る。
 * @param {{manualSeason?: string|null}} [options]
 */
export function createSeasonSystem(options = {}) {
  let manualSeason = options.manualSeason ?? null;
  let current = manualSeason || getAutoSeason();

  function update() {
    current = manualSeason || getAutoSeason();
    return current;
  }

  function setManualSeason(name) {
    if (name !== null && !SEASONS.includes(name)) return;
    manualSeason = name;
    current = manualSeason || getAutoSeason();
  }

  function getSeason() {
    return current;
  }

  function isManual() {
    return manualSeason !== null;
  }

  function getVisualCategory() {
    return VISUAL_CATEGORY[current] || 'summer';
  }

  function getWeatherWeights() {
    return WEATHER_WEIGHTS[current] || WEATHER_WEIGHTS.summer;
  }

  function getLeafColor() {
    return LEAF_COLOR[getVisualCategory()];
  }

  function getTerrainColor() {
    return TERRAIN_COLOR[getVisualCategory()];
  }

  function getGrassColors() {
    const cat = getVisualCategory();
    return { low: GRASS_COLOR_LOW[cat], high: GRASS_COLOR_HIGH[cat] };
  }

  function isWinter() {
    return current === 'winter';
  }

  function isAutumnLike() {
    return current === 'autumn' || current === 'typhoon';
  }

  // 2026-09(v1.31): 「いつまで待っても枯れ葉が散らない」というフィードバックへの
  // 対応で、実際の日付を待たずに秋の進み具合を強制できるデバッグ用の上書き値。
  // nullなら通常通り(実際の季節・日付から計算)。
  let debugAutumnProgressOverride = null;
  function setDebugAutumnProgress(value) {
    debugAutumnProgressOverride = value === null || value === undefined ? null : Math.min(1, Math.max(0, value));
  }
  function getAutumnProgressNow() {
    if (debugAutumnProgressOverride !== null) return debugAutumnProgressOverride;
    return getAutumnProgress(current);
  }

  function getBroadleafLeafColorNow() {
    return getBroadleafLeafColor(getVisualCategory(), getAutumnProgressNow());
  }

  return {
    update,
    setManualSeason,
    getSeason,
    isManual,
    getVisualCategory,
    getWeatherWeights,
    getLeafColor,
    getTerrainColor,
    getGrassColors,
    isWinter,
    isAutumnLike,
    getAutumnProgress: getAutumnProgressNow,
    getBroadleafLeafColor: getBroadleafLeafColorNow,
    getBroadleafDefoliation: () => getBroadleafDefoliation(getAutumnProgressNow()),
    setDebugAutumnProgress,
  };
}
