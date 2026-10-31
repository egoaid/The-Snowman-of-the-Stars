// buffer-size.js (v1.93)
// 描画バッファ(ピクセルアートの粗さのもと)の大きさを、ウィンドウの大きさと縦横比に合わせて決める。
//   ・ピクセル1つは、画面上で整数ピクセル(s×s)に拡大する(ピクセルの粗さ・くっきりさを保つ)。
//   ・バッファの幅・高さは、ウィンドウを黒縁なしで埋める大きさにする(縦横比がどんなでも)。端は最大 s ピクセルだけはみ出して切れる(中央寄せ)。
//   ・s は、描画の高さが基準の高さ(270)に近くなる整数を選ぶ(つまり、いつもの 480×270 に近い粗さ)。
export const BASE_HEIGHT = 270;

/**
 * @param {number} cw 表示領域の幅(CSSピクセル)
 * @param {number} ch 表示領域の高さ
 * @returns {{scale:number, bufW:number, bufH:number, cssW:number, cssH:number}}
 */
export function computeBufferSize(cw, ch) {
  const raw = ch / BASE_HEIGHT;
  const lo = Math.max(1, Math.floor(raw)), hi = Math.max(1, Math.ceil(raw));
  const s = Math.abs(Math.log(ch / lo / BASE_HEIGHT)) <= Math.abs(Math.log(ch / hi / BASE_HEIGHT)) ? lo : hi;
  const bufW = Math.max(96, Math.min(1600, Math.ceil(cw / s)));
  const bufH = Math.max(120, Math.ceil(ch / s));
  return { scale: s, bufW, bufH, cssW: bufW * s, cssH: bufH * s };
}
