// items.js
// v1.43: アイテム定義を1か所に集約する。UI(ホットバー・インベントリ)・手に持つ見た目・
// スタック上限は、すべてここの定義だけを見る。新しい種類を足す時は、ITEM_DEFS に
// 1件追加すれば、インベントリ・ホットバーに出せる(手に持つ見た目は held-items.js に
// ビルダーを足す。無ければ何も持たない)。
//
// hand: そのアイテムを手に持つ時の手。'right' は「ホットバーで選んだ物」の手、
// 'left' は松明専用(左手は常に松明。カメラの視点によって手の割り当ては変えない)。

export const ITEM_DEFS = {
  // 星: 流れ星が落ちたら拾える大きな星。木のてっぺんに飾ると、その木のどこにでもおもちゃを貼り付けられる。
  star:    { id: 'star',    name: '星',     icon: '★',  maxStack: 64, category: 'collectible', hand: 'right', description: '流れ星が落とした、大きな星。木のてっぺんに飾る。' },
  // 星のかけら: 星から作る(星1個 → 10個)。星より小さい。物と物を貼り付ける力があり、
  // おもちゃを木に飾る・木でおもちゃを作る・川に橋をかける時に使う。
  star_shard: { id: 'star_shard', name: '星のかけら', icon: '✦', maxStack: 64, category: 'material', hand: 'right', description: '星から作った小さなかけら。物と物をくっつける力がある。' },
  torch:   { id: 'torch',   name: '松明',   icon: '🔥', maxStack: 64, category: 'utility',     hand: 'left',  description: '夜道をほのかに照らす。' },
  log:     { id: 'log',     name: '丸太',   icon: '🪵', maxStack: 64, category: 'resource',    hand: 'right', description: '倒木から拾った丸太。木材10個に分けられる。' },
  wood:    { id: 'wood',    name: '木材',   icon: '🟫', maxStack: 64, category: 'resource',    hand: 'right', description: '丸太から取れる、使いやすい木材。' },
  stone:   { id: 'stone',   name: '石',     icon: '🪨', maxStack: 64, category: 'resource',    hand: 'right', description: 'ごつごつした、ふつうの石。' },
  coal:    { id: 'coal',    name: '石炭',   icon: '⚫', maxStack: 64, category: 'resource',    hand: 'right', description: '黒く光る、よく燃える石。' },
  iron:    { id: 'iron',    name: '鉄',     icon: '⛓️', maxStack: 64, category: 'resource',    hand: 'right', description: '重くて、少し青みがかった鉄。' },
  diamond: { id: 'diamond', name: 'ダイヤ', icon: '💎', maxStack: 64, category: 'resource',    hand: 'right', description: '岩の奥で眠っていた、透きとおった石。' },
  // 置いて使う道具(まだ置く機能は無い。アイテムとしてだけ先に定義する)
  crafting_table: { id: 'crafting_table', name: '作業台', icon: '🛠️', maxStack: 16, category: 'placeable', hand: 'right', description: '木材から作る作業台。おもちゃなど、手では作れないものを作る。' },
  // v1.56: ハロウィンのジャック・オー・ランタン。手に持てて、置くと光り、頭の装備スロットに入れると雪だるまの頭になる。
  jack_o_lantern:  { id: 'jack_o_lantern',  name: 'ジャック・オー・ランタン', icon: '🎃', maxStack: 16, category: 'wearable', equip: 'head', hand: 'right', description: '中で火が灯っているように光る、かぼちゃ。頭にかぶることも、地面に置くこともできる。' },
  // v1.55 E5: 人の痕跡(説明はしない。拾えるが、何なのかは語らない)
  cassette_tape:   { id: 'cassette_tape',   name: 'カセットテープ', icon: '📼', maxStack: 16, category: 'material', hand: 'right', description: '色あせたテープ。何が録音されているのかは、分からない。' },
  empty_can:       { id: 'empty_can',       name: '空き缶',         icon: '🥫', maxStack: 32, category: 'material', hand: 'right', description: '錆びた空き缶。加工の材料になりそうだ。' },
  colored_pencils: { id: 'colored_pencils', name: '色鉛筆',         icon: '✏️', maxStack: 16, category: 'material', hand: 'right', description: '短くなった色鉛筆の束。' },
  small_toy:       { id: 'small_toy',       name: '小さなおもちゃ', icon: '🧸', maxStack: 16, category: 'material', hand: 'right', description: '誰かの、小さなおもちゃ。' },
  twig:    { id: 'twig',    name: '小枝',   icon: '🌿', maxStack: 64, category: 'material', hand: 'right', description: '森の地面に落ちていた、細い枝。' },
  chest:   { id: 'chest',   name: 'チェスト', icon: '🧰', maxStack: 16, category: 'placeable', hand: 'right', description: '木材から作る箱。拾い集めた物をしまっておける。' },
};

/** 丸太1個から取れる木材の数。レシピの定義は recipes.js(互換のためここからも参照できる)。 */
export { LOG_TO_WOOD } from './recipes.js';

export function getItemDef(id) { return ITEM_DEFS[id] || null; }
export function isKnownItem(id) { return Object.prototype.hasOwnProperty.call(ITEM_DEFS, id); }
export function maxStackOf(id) { const d = ITEM_DEFS[id]; return d ? d.maxStack : 0; }
