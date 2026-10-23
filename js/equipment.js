// equipment.js (v1.56)
// 雪だるまの装備スロット(頭・胴・手・足の4つ)。マイクラの防具スロットのようなもの。
// 各スロットは { id, count } か null の配列(1個まで)。インベントリへ attachArea で渡すと、
// 持ち物と同じクリック・ドラッグ・Shift転送で出し入れできる。どの物がどの部位か、は items.js の `equip` で決まる
// (今は、頭: ジャック・オー・ランタンだけ。胴・手・足は空きスロット)。
import { getItemDef } from './items.js';
import { t } from './i18n.js';

export const EQUIP_SLOTS = ['head', 'body', 'hands', 'feet'];
export const EQUIP_AREA = (slot) => `equip_${slot}`;
// v1.72: 部位の名前は、言語に合わせて辞書(equip.<slot>)から引く
export const EQUIP_LABEL = {};
for (const slot of EQUIP_SLOTS) Object.defineProperty(EQUIP_LABEL, slot, { get: () => t(`equip.${slot}`), enumerable: true });

export function createEquipment() {
  const arrs = {};
  for (const s of EQUIP_SLOTS) arrs[s] = [null];
  return {
    slots: EQUIP_SLOTS,
    arr: (slot) => arrs[slot],
    get: (slot) => (arrs[slot][0] ? arrs[slot][0].id : null),
    /** そのスロットに入れてよい種類か */
    accepts: (slot, id) => { const d = getItemDef(id); return !!d && d.equip === slot; },
    /** インベントリのスロット並びとして渡す */
    attachTo(inventory) {
      for (const s of EQUIP_SLOTS) inventory.attachArea(EQUIP_AREA(s), arrs[s], { accept: (id) => { const d = getItemDef(id); return !!d && d.equip === s; }, single: true, quickTarget: true });
    },
    detachFrom(inventory) { for (const s of EQUIP_SLOTS) inventory.detachArea(EQUIP_AREA(s)); },
    /** 直接つける(見守りの雪だるまなど)。入れ替えて、前の物を返す。 */
    set(slot, id) { const prev = arrs[slot][0] ? arrs[slot][0].id : null; arrs[slot][0] = id ? { id, count: 1 } : null; return prev; },
    serialize() { const o = {}; for (const s of EQUIP_SLOTS) o[s] = arrs[s][0] ? { ...arrs[s][0] } : null; return o; },
    restore(d) { for (const s of EQUIP_SLOTS) arrs[s][0] = d && d[s] ? { id: d[s].id, count: 1 } : null; },
  };
}
