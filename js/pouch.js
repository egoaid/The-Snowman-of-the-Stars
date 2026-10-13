// pouch.js (v1.54 E3)
// 見守りの雪だるまが「自分で拾った物」を数える、ポーチの帳簿。
// 持ち物の入れ物は既存のインベントリ(inventory.js)を使い、ここは新しい入れ物を作らない。
// 満杯の判定: 拾った数が capacity に達した、または、インベントリにこれ以上入らない。
// チェストへ移す時は、数えた分だけをインベントリから取り出す(自動で空にはしない)。

/**
 * @param {object} o
 * @param {object} o.inventory createInventory() の戻り値(add/remove/canAdd/count)
 * @param {number} o.capacity この数を拾ったら「満杯」(設定値)
 */
export function createPouch({ inventory, capacity }) {
  let cap = capacity;
  const carried = new Map(); // itemId -> 見守りが拾って、まだチェストへ運んでいない数
  const total = () => { let n = 0; for (const v of carried.values()) n += v; return n; };
  return {
    get capacity() { return cap; },
    setCapacity(n) { cap = Math.max(1, Math.floor(n)); }, // 設定の変更・検証用
    total,
    carried: () => new Map(carried),
    canTake: (itemId) => total() < cap && inventory.canAdd(itemId, 1),
    /** 拾う。入らなければfalse(世界の物は取り除かない側で扱う)。 */
    take(itemId) {
      if (total() >= cap || !inventory.canAdd(itemId, 1)) return false;
      if (!inventory.add(itemId, 1)) return false;
      carried.set(itemId, (carried.get(itemId) || 0) + 1);
      return true;
    },
    isFull: () => total() >= cap || [...carried.keys()].some((id) => !inventory.canAdd(id, 1)),
    isEmpty: () => total() === 0,
    /** チェストへ1個渡す(インベントリからも1個減る)。渡せたら itemId、無ければnull。 */
    giveOne() {
      for (const [id, n] of carried) {
        if (n <= 0) continue;
        if (inventory.count(id) < 1) { carried.delete(id); continue; } // 手元から先に無くなっていた(飾り付けなど)
        inventory.remove(id, 1);
        if (n - 1 <= 0) carried.delete(id); else carried.set(id, n - 1);
        return id;
      }
      return null;
    },
    serialize: () => ({ capacity: cap, carried: Object.fromEntries(carried) }),
    restore(s) { carried.clear(); for (const [k, v] of Object.entries((s && s.carried) || {})) carried.set(k, v); },
  };
}
