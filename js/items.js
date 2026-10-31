// items.js
// v1.43: アイテム定義を1か所に集約する。UI(ホットバー・インベントリ)・手に持つ見た目・
// スタック上限は、すべてここの定義だけを見る。新しい種類を足す時は、ITEM_DEFS に
// 1件追加すれば、インベントリ・ホットバーに出せる(手に持つ見た目は held-items.js に
// ビルダーを足す。無ければ何も持たない)。
//
// hand: そのアイテムを手に持つ時の手。'right' は「ホットバーで選んだ物」の手、
// 'left' は松明専用(左手は常に松明。カメラの視点によって手の割り当ては変えない)。

import { t } from './i18n.js';

// v1.89: 木炭の絵(絵文字に石炭に合うものがないので、黒い角ばった塊を描く)。表示側は、iconSvg があればそれを使う。
export const COAL_ICON_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" style="vertical-align:-0.14em" aria-hidden="true"><polygon points="3,16 7,9 13,8 15,14 11,19 5,19" fill="#2a2623"/><polygon points="7,9 13,8 12,12 8,13" fill="#4b443d"/><polygon points="12,13 17,7 22,11 21,18 15,20 13,17" fill="#34302b"/><polygon points="17,7 22,11 19,11" fill="#5e564d"/><polygon points="9,13 12,13 13,17 11,19 5,19 5,16 8,14" fill="#1d1a18"/><polygon points="14,14 21,18 15,20" fill="#1d1a18"/><polyline points="7,9 13,8" stroke="#8a8075" stroke-width="0.7" fill="none"/></svg>';

export const ITEM_DEFS = {
  // 星: 流れ星が落ちたら拾える大きな星。木のてっぺんに飾ると、その木のどこにでもおもちゃを貼り付けられる。
  star:    { id: 'star',    icon: '★',  maxStack: 64, category: 'collectible', hand: 'right' },
  // 星のかけら: 星から作る(星1個 → 10個)。星より小さい。物と物を貼り付ける力があり、
  // おもちゃを木に飾る・木でおもちゃを作る・川に橋をかける時に使う。
  star_shard: { id: 'star_shard', icon: '✦', maxStack: 64, category: 'material', hand: 'right' },
  // v1.69: 月の石 / 月のかけら。月の石は、星のように時々空から降ってくる三日月の形の光る石で、地面に埋まっていることもある。
  //   (月面のクレーターができる時に生まれ、隕石として地球に落ちた物。今も降ってくるのは、この世界の謎の1つ。)
  //   星が「重力を与える」のに対し、月の石は「反重力」を持つ。月のかけらを丸太の組んだ物に貼ると、その物が少し宙に浮く。
  moon_stone: { id: 'moon_stone', icon: '🌙', maxStack: 64, category: 'collectible', hand: 'right' },
  moon_shard: { id: 'moon_shard', icon: '☾', maxStack: 64, category: 'material', hand: 'right' },
  torch:   { id: 'torch',   icon: '🔥', maxStack: 64, category: 'utility',     hand: 'left' },
  // v1.74: 星の松明。細い棒の先に星のかけらがついた松明(枝1+星のかけら1で作る)。Qキーで地面に立てて置ける。焚き火と同じくらい周りを照らす。
  star_torch: { id: 'star_torch', icon: '🌟', maxStack: 16, category: 'utility', hand: 'right' },
  log:     { id: 'log',     icon: '🪵', maxStack: 64, category: 'resource',    hand: 'right' },
  wood:    { id: 'wood',    icon: '🟫', maxStack: 64, category: 'resource',    hand: 'right' },
  stone:   { id: 'stone',   icon: '🪨', maxStack: 64, category: 'resource',    hand: 'right' },
  coal:    { id: 'coal',    icon: '⚫', iconSvg: COAL_ICON_SVG, maxStack: 64, category: 'resource',    hand: 'right' },
  iron:    { id: 'iron',    icon: '⛓️', maxStack: 64, category: 'resource',    hand: 'right' },
  diamond: { id: 'diamond', icon: '💎', maxStack: 64, category: 'resource',    hand: 'right' },
  // 置いて使う道具(まだ置く機能は無い。アイテムとしてだけ先に定義する)
  crafting_table: { id: 'crafting_table', icon: '🛠️', maxStack: 16, category: 'placeable', hand: 'right' },
  campfire: { id: 'campfire', icon: '🔥', maxStack: 8, category: 'placeable', hand: 'right' }, // v1.87: 作業台で、丸太・小石・木炭から作る
  // v1.56: ハロウィンのジャック・オー・ランタン。手に持てて、置くと光り、頭の装備スロットに入れると雪だるまの頭になる。
  jack_o_lantern:  { id: 'jack_o_lantern',  icon: '🎃', maxStack: 16, category: 'wearable', equip: 'head', hand: 'right' },
  // v1.55 E5: 人の痕跡(説明はしない。拾えるが、何なのかは語らない)
  cassette_tape:   { id: 'cassette_tape',   icon: '📼', maxStack: 16, category: 'material', hand: 'right' },
  empty_can:       { id: 'empty_can',       icon: '🥫', maxStack: 32, category: 'material', hand: 'right' },
  colored_pencils: { id: 'colored_pencils', icon: '✏️', maxStack: 16, category: 'material', hand: 'right' },
  small_toy:       { id: 'small_toy',       icon: '🧸', maxStack: 16, category: 'material', hand: 'right' },
  twig:    { id: 'twig',    icon: '🌿', maxStack: 64, category: 'material', hand: 'right' },
  chest:   { id: 'chest',   icon: '🧰', maxStack: 16, category: 'placeable', hand: 'right' },
};

// v1.72: 名前と説明は、言語に合わせて、読むたびに辞書(i18n/ja.js・en.js の item.<id>.name / .desc)から引く。
for (const id of Object.keys(ITEM_DEFS)) {
  Object.defineProperty(ITEM_DEFS[id], 'name', { get: () => t(`item.${id}.name`), enumerable: true, configurable: true });
  Object.defineProperty(ITEM_DEFS[id], 'description', { get: () => t(`item.${id}.desc`), enumerable: true, configurable: true });
}

/** 丸太1個から取れる木材の数。レシピの定義は recipes.js(互換のためここからも参照できる)。 */
export { LOG_TO_WOOD } from './recipes.js';

export function getItemDef(id) { return ITEM_DEFS[id] || null; }
export function isKnownItem(id) { return Object.prototype.hasOwnProperty.call(ITEM_DEFS, id); }
export function maxStackOf(id) { const d = ITEM_DEFS[id]; return d ? d.maxStack : 0; }
