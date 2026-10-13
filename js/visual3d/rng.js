// rng.js
// シード値から再現性のある疑似乱数を生成する(mulberry32アルゴリズム)。

export function makeRng(seed) {
  let s = seed >>> 0;
  return function random() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/**
 * 1つのワールドシードから、用途ごとに異なる独立した副シードを作る。
 * 2026-09(v1.29): 地形自動生成で「木・岩の配置もシードに連動させたいが、
 * 川の生成やキャンプ地選びと同じ乱数列を使い回すと、互いに影響し合って
 * 予測しづらくなる(例えば木の本数を変えたら川の形も変わってしまう)」
 * ことを避けるため、用途名(label)ごとに独立した乱数列の起点を作る。
 * 同じ(seed, label)なら常に同じ値になる(再現性)。
 * @param {number} seed ワールドシード
 * @param {string} label 用途名('trees', 'rocks' など)。他の用途と重複しなければ何でもよい
 * @returns {number} makeRng()にそのまま渡せる32bit整数のシード
 */
export function deriveSeed(seed, label) {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV風の混合(用途名が違えば大きく異なる値になる)
  }
  // 仕上げにmulberry32の混合を1段かけて、seedとlabelの小さな違いが
  // 出力全体に広がるようにする(似た値が近い乱数列にならないように)。
  h = (h + 0x6d2b79f5) | 0;
  let t = Math.imul(h ^ (h >>> 15), 1 | h);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
