// config.js
// アプリ全体の設定を1か所に集約する(v1.38〜)。
// バージョン・タイトル・著作権表記、および「落ちてくる星」の調整値は、
// ここだけを書き換えれば済むようにしてある(他のファイルへ文字列や
// 数値を直接書き散らさないこと)。

export const APP = {
  titleJa: '星の雪だるま',
  titleEn: 'The Snowman of the Stars',
  version: '1.73',
  // 表記上の統一形式。実際の権利は All rights reserved。
  copyright: '© 2026 egoaid',
  // v1.57: 公開(GitHub Pages)。絶対URLが必要な所(canonical・sitemap・OGP・manifest)の基準。
  publicUrl: 'https://egoaid.github.io/The-Snowman-of-the-Stars/',
  // 管理者モード: ?admin=1 で開いてパスフレーズを入れると、この端末だけでデバッグ表示が使える(js/admin.js)。
  // コードに入れるのはパスフレーズ本人ではなくSHA-256のハッシュだけ。ただし静的サイトなので、ソースを読めば回避できる
  // 「見えなくする」ための仕組みで、強い秘匿ではない(守る秘密も、サーバーも無い)。
  adminHash: 'd316a84c5e47aeb5ba688f28fd9ef6be6fbd2f9c4ecd5f5f2eed031fd6395391',
};

// --- 落ちてくる星(falling-star.js / scene3d.js) ---
export const FALLING_STAR = {
  // 落ちてくる間隔(秒)。約2分に1回(ゆらぎで1.5〜2.5分)。夜(nightOnly)のあいだだけ数える。v1.54で10分→4分→2分。実時間ではなく「アプリが動いていた
  // 時間」の積算で数えるので、ページの再読み込みには依存しない。
  intervalSec: 120,
  // 間隔のゆらぎ(±の割合)。0.25なら 450〜750秒 のあいだでばらつく。
  intervalJitter: 0.25,
  // 起動後、最初の1回までの待ち時間の倍率(intervalSecに掛ける)。
  firstDelayFactor: [0.4, 0.9],
  // 落下にかける時間(秒)
  fallDurationSec: 3.6,
  // 地上に残る時間(秒)。この範囲でランダム。v1.54で、数十秒から15〜25分に(世界に残る物になった)。
  lifetimeSec: [900, 1500],
  // v1.54: 地上の星は、拾われるまで長く残る(世界に残る物)。同時に地上にある数の上限。
  maxStars: 5,
  // 夜のあいだだけ新しい星が落ちる(昼は数えが止まる)。
  nightOnly: true,
  // 消える直前にゆっくり薄くなる時間(秒)
  fadeOutSec: 8,
  // 地上の星の大きさ(半径, m)。帽子の星(約0.079m)より大きい。
  groundRadius: 0.22,
  // 木に飾った星の大きさ(半径, m)。帽子の星と同じ。
  // (snowman.jsのheadRadius(0.36) * 0.22 と一致させる)
  hatRadius: 0.36 * 0.22,
  // 近づくだけで回収できる距離(m)
  collectRadius: 1.5,
  // 着地点の条件(m)
  landing: {
    minFromPlayer: 14,
    maxFromPlayer: 75,
    obstacleMargin: 2.5,
    waterMargin: 3.0,
    edgeMargin: 8,
  },
  // 地上の星が周りを照らす明るさ(PointLight)
  lightIntensity: 1.6,
  lightDistance: 11,
  // 地上で余韻の鈴を鳴らす間隔(秒)
  ringIntervalSec: [6, 11],
  // 開発・確認用: URLに ?starTest を付けると、短い間隔で星が落ちる。
  // ?starTest=15 のように秒数も指定できる(省略時は下の既定値)。
  test: {
    intervalSec: 20,
    firstDelaySec: 4,
    lifetimeSec: [60, 60],
  },
};

// v1.69: 月の石。星(FALLING_STAR)と同じ仕組みで空から降ってくるが、ずっと珍しい。三日月の形で、淡い青白く光る。
//   地面に埋まっているもの(buriedCount個。ワールドのシードで場所が決まる)もある。拾われるまで、ずっと残る。
//   星の設定をそのまま使い、この3つ(珍しさ・数・光の色)だけ変える。
export const MOON_STONE = {
  ...FALLING_STAR,
  intervalSec: 540,            // 約9分に1回(星は2分)。夜のあいだだけ数える
  firstDelayFactor: [0.5, 1.2],
  lifetimeSec: [1800, 3000],   // 降ってきた月の石が残る時間(星より長い)
  maxStars: 2,                 // 同時に地上にある数の上限(降ってきたもの)
  groundRadius: 0.2,
  buriedCount: 3,              // 地形に埋まっている月の石の数
  buriedSink: 0.1,             // 埋まっている月の石の、地面からの高さ(m)。小さいほど深く埋まっている
  lightIntensity: 1.1,
  lightDistance: 9,
  colors: { stone: 0xdcecff, glow: 0xffffff, trail: 0xffffff, light: 0xb8d4ff },
  glowStops: [[236, 244, 255], [190, 215, 255], [150, 190, 255]], // 光の色(中心・まわり・外側)。青白い
};

// v1.69: 星のかけら・月のかけらで、倒木をくっつける/浮かせる。
export const SHARDS = {
  contactTolerance: 0.1,   // 2本の丸太の「触れている」とみなす隙間(m)。静止した丸太の軸どうしの距離 ≤ 半径の和 + この値
  hoverClearance: 0.7,     // 月のかけらを貼った物が、地面から浮く高さ(m。いちばん低い所の隙間)
  hoverSteadySec: 1.0,     // 浮く高さで落ち着いてから、静止(静的)に戻すまでの時間
  // v1.70: 浮いている建造物は、塊ぜんたいが同じ動きでふわふわする(見た目だけ。あたり判定は元の高さのまま)
  bobAmplitude: 0.08,      // 上下のゆれ幅(m、±)
  bobPeriodSec: 6,         // 上下1往復の秒数
  // v1.71: 接着は「接着モード」で、位置と角度を決めて行う。以前の『落ちて止まった所で触れていたら自動で接着』は、既定ではしない。
  autoWeld: false,
  glueRotateSnap: 15,      // 接着モードの「きざみ」ONの角度(度)
  glueGroundSlack: 0.03,   // 接着の位置が地面に沈んでいてよい深さ(m)。これより深いと確定できない
  bobTiltDeg: 0.5,         // 傾きのゆれ(度、±)。塊の中心まわりに、ごくわずかに揺れる
};


// --- 見守りモード中の雪だるまが星へ示す反応 ---
export const SNOWMAN_STAR = {
  // 星が落ちたのに気づく確率(気づかなければ無視する)
  noticeProbability: 0.6,
  // 気づいたうえで、実際に歩いて向かう確率
  approachProbability: 0.45,
  // 落ちてから気づくまでの時間(秒)
  noticeDelaySec: [2, 8],
};

// --- 木への飾り付け ---
export const DECORATION = {
  // 星を飾れる針葉樹の最大サイズ(createPineTreeのscale。高さ ≈ scale*3.7m)
  maxTreeScale: 4.5,
  // v1.40 フェーズ3: 「隠れたアンカー」方式。1本の木にこの数まで飾れる
  // (v1.38の「1本に1つ」制限を撤廃)。木の輪郭に沿った見えない取り付け点を
  // 順番に使っていくので、同じ場所に重ならず、少しずつ位置をずらして飾られる。
  maxPerTree: 6,
  // 幹の中心からこの距離(2.2 + scale*1.2 m)以内にいると飾れる
  reachBase: 2.2,
  reachPerScale: 1.2,
};

/** URLの ?starTest から、星の開発用テストモードの設定を読む。無ければnull。 */
export function readStarTestMode(search = (typeof location !== 'undefined' ? location.search : '')) {
  const params = new URLSearchParams(search);
  if (!params.has('starTest')) return null;
  const v = Number(params.get('starTest'));
  return {
    intervalSec: Number.isFinite(v) && v > 0 ? v : FALLING_STAR.test.intervalSec,
    firstDelaySec: FALLING_STAR.test.firstDelaySec,
    lifetimeSec: FALLING_STAR.test.lifetimeSec,
  };
}

// --- v1.39: 視線中心のレイキャスト(常時表示のクロスヘアは出さない) ---
export const INTERACTION = {
  // 狙える距離(m)。値そのものは「見た目の大きさ」で対象ごとに少し広がる。
  reach: 3.4,
};

// --- v1.43: プレイヤーインベントリ(メイン27 + ホットバー9。ホットバーもインベントリの一部) ---
export const HOTBAR = {
  slots: 9,
};
// --- v1.54 E3/E4: 見守りの雪だるまの収集とチェスト ---
export const SNOWMAN_COLLECT = {
  // ポーチが満杯になる拾った数(インベントリの枠ではなく、見守りが拾った個数。ゲームのバランスより「たまに帰る」見た目のため)
  pouchCapacity: 8,
  // 行き先を選ぶ時に、気づいた物へ向かう確率(星は強く、小さな物はたまに)
  attemptProbability: 0.7,
  attemptProbabilityStar: 1.0, // 気づいた星へは、必ず向かう
  // 拾ったあと、周りを見回す時間(秒)
  lookAroundSec: [1.2, 2.4],
  // 眺めて拾わなかった物を、気にしない時間(秒)
  ignoreAfterDeclineSec: 240,
  // チェストの開け閉め・1個ずつしまう間隔(秒)
  chestOpenSec: 0.9, chestStoreEachSec: 0.55, chestCloseSec: 0.8, chestPauseSec: [1.6, 2.8],
  // チェストの位置: キャンプの中心から、入口の向きに対してこの角度(rad)・この距離(m)
  chestAngleFromDoor: 1.15, chestDistance: 3.4,
};

export const INVENTORY = {
  mainSlots: 27,
  hotbarSlots: 9,
};
