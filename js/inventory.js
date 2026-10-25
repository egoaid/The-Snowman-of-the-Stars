// inventory.js
// v1.43: 「ポーチ(種類ごとの個数) + 別物のホットバー」をやめ、Minecraft風の
// 1つのプレイヤーインベントリに統合した(旧 hotbar.js はここへ吸収して削除)。
//
//   player.inventory = { main: Array(27), hotbar: Array(9), selectedHotbarSlot }
//
// 各スロットは { id, count } か null。ホットバーはインベントリの一部であり、
// 「ホットバーへ移す」操作は要らない(スロット同士を直接やり取りする)。
// 手に持つ物は「選択中のホットバースロットの中身」そのもの。
//
// UI(index.html)はこのモジュールが返すsnapshot()を描画し、クリック操作を
// clickSlot()/hotkeySwap()へ渡すだけ。操作のルール(持ち上げ・置く・半分・
// 入れ替え・Shift転送)はすべてここに集約し、Node単体でテストできるようにしてある。

import { isKnownItem, maxStackOf } from './items.js';

export const MAIN_SLOTS = 27;
export const HOTBAR_SLOTS = 9;

const copyStack = (s) => (s ? { id: s.id, count: s.count } : null);

export function createInventory({ mainSlots = MAIN_SLOTS, hotbarSlots = HOTBAR_SLOTS } = {}) {
  const areas = {
    main: new Array(mainSlots).fill(null),
    hotbar: new Array(hotbarSlots).fill(null),
  };
  let selected = 0;
  let cursor = null; // マウスで持ち上げ中のスタック
  const listeners = new Set();

  // v1.56: 外から持ってきたスロットの並び(チェスト・装備スロット)。同じ操作(持ち上げる・置く・入れ替え・Shift転送)で扱える。
  //   arr: { id, count } か null の配列(外側の持ち主が参照を持つ。中身はここから直接書き換える)
  //   accept(id) -> 置いてよい種類か(装備スロットは、その部位の物だけ)
  //   single: 1スロットに1個まで(装備)
  const ext = new Map();
  const getArr = (area) => areas[area] || (ext.get(area) ? ext.get(area).arr : null);
  const accepts = (area, id) => { const e = ext.get(area); return !e || !e.accept || e.accept(id); };
  const isSingle = (area) => { const e = ext.get(area); return !!(e && e.single); };
  function attachArea(name, arr, { accept = null, single = false, quickTarget = false } = {}) { ext.set(name, { arr, accept, single, quickTarget }); emit(); }
  function detachArea(name) { if (ext.delete(name)) emit(); }

  function snapshot() {
    const extSnap = {};
    for (const [k, e] of ext) extSnap[k] = e.arr.map(copyStack);
    return {
      main: areas.main.map(copyStack),
      hotbar: areas.hotbar.map(copyStack),
      ext: extSnap,
      selected,
      cursor: copyStack(cursor),
    };
  }
  function emit() { const s = snapshot(); listeners.forEach((fn) => fn(s)); }
  function validArea(area, i) { const a = getArr(area); return !!a && Number.isInteger(i) && i >= 0 && i < a.length; }

  // ---- 個数の出し入れ(ゲーム側: 拾う・使う) ----

  /** 入る限り入れて、入らなかった個数を返す。hotbar優先で、同じ種類のスタックへ先に足す。 */
  function addItem(id, n = 1, { silent = false } = {}) {
    n = Math.floor(n);
    if (!isKnownItem(id) || !(n > 0)) return n > 0 ? n : 0;
    const max = maxStackOf(id);
    let left = n;
    const order = ['hotbar', 'main'];
    for (const area of order) {           // 1) 既存の同種スタックへ
      for (const s of areas[area]) {
        if (left <= 0) break;
        if (s && s.id === id && s.count < max) { const put = Math.min(max - s.count, left); s.count += put; left -= put; }
      }
    }
    for (const area of order) {           // 2) 空きスロットへ
      const arr = areas[area];
      for (let i = 0; i < arr.length && left > 0; i++) {
        if (!arr[i]) { const put = Math.min(max, left); arr[i] = { id, count: put }; left -= put; }
      }
    }
    if (left !== n && !silent) emit();
    return left;
  }
  /** 全部入るならtrue(入る分だけは入れる)。 */
  function add(id, n = 1) { return addItem(id, n) === 0; }

  /** n個すべて入る余地があるか(実際には入れない)。 */
  function canAdd(id, n = 1) {
    if (!isKnownItem(id)) return false;
    const max = maxStackOf(id);
    let room = 0;
    for (const area of ['hotbar', 'main']) {
      for (const s of areas[area]) {
        if (!s) room += max; else if (s.id === id) room += max - s.count;
      }
    }
    return room >= n;
  }

  function count(id) {
    let c = 0;
    for (const area of ['hotbar', 'main']) for (const s of areas[area]) if (s && s.id === id) c += s.count;
    if (cursor && cursor.id === id) c += cursor.count;
    return c;
  }

  /** n個取り除く。足りなければ何もせずfalse。選択中スロット→他のホットバー→メイン→持ち上げ中、の順。 */
  function remove(id, n = 1, { silent = false } = {}) {
    n = Math.floor(n);
    if (!isKnownItem(id) || !(n > 0) || count(id) < n) return false;
    let left = n;
    const take = (arr, i) => {
      const s = arr[i];
      if (!s || s.id !== id || left <= 0) return;
      const t = Math.min(s.count, left);
      s.count -= t; left -= t;
      if (s.count === 0) arr[i] = null;
    };
    take(areas.hotbar, selected);
    for (let i = 0; i < areas.hotbar.length; i++) take(areas.hotbar, i);
    for (let i = 0; i < areas.main.length; i++) take(areas.main, i);
    if (left > 0 && cursor && cursor.id === id) {
      const t = Math.min(cursor.count, left); cursor.count -= t; left -= t;
      if (cursor.count === 0) cursor = null;
    }
    if (!silent) emit();
    return true;
  }

  function restore(s) {
    areas.main = s.main.map(copyStack);
    areas.hotbar = s.hotbar.map(copyStack);
    selected = s.selected;
    cursor = copyStack(s.cursor);
  }

  /** 「入力n個を、出力m個に変える」を全か無かで行う(例: 丸太1 → 木材10)。 */
  function convert(inId, inCount, outId, outCount) {
    if (count(inId) < inCount) return false;
    const backup = snapshot();
    remove(inId, inCount, { silent: true });
    if (addItem(outId, outCount, { silent: true }) > 0) { restore(backup); return false; }
    emit();
    return true;
  }

  /** v1.74: 材料が複数のレシピ。「inputs すべてを、出力m個に変える」を全か無かで行う。 */
  function convertMany(inputs, outId, outCount) {
    for (const i of inputs) if (count(i.id) < i.count) return false;
    const backup = snapshot();
    for (const i of inputs) remove(i.id, i.count, { silent: true });
    if (addItem(outId, outCount, { silent: true }) > 0) { restore(backup); return false; }
    emit();
    return true;
  }

  // ---- ホットバーの選択 ----

  function select(i) {
    if (!Number.isInteger(i) || i < 0 || i >= areas.hotbar.length || i === selected) return;
    selected = i; emit();
  }
  function next() { select((selected + 1) % areas.hotbar.length); }
  function prev() { select((selected - 1 + areas.hotbar.length) % areas.hotbar.length); }
  /** 選択中のホットバースロットの種類(空ならnull)。右手に持つ物はこれ。 */
  function getSelected() { const s = areas.hotbar[selected]; return s ? s.id : null; }

  // ---- マウス操作(インベントリ画面) ----

  function tryMerge(arr, i, stack) {
    const s = arr[i];
    if (!s || s.id !== stack.id) return false;
    const room = maxStackOf(s.id) - s.count;
    if (room <= 0) return false;
    const put = Math.min(room, stack.count);
    s.count += put; stack.count -= put;
    return true;
  }

  /** 配列 to へ、stack をできるだけ移す(同種へ足し、残りを空きへ。acceptを満たす時だけ)。 */
  function moveInto(to, stack, area = null) {
    if (area && !accepts(area, stack.id)) return;
    for (let k = 0; k < to.length && stack.count > 0; k++) tryMerge(to, k, stack);
    for (let k = 0; k < to.length && stack.count > 0; k++) {
      if (!to[k]) { const put = (area && isSingle(area)) ? 1 : stack.count; to[k] = { id: stack.id, count: put }; stack.count -= put; }
    }
  }
  /**
   * Shift+クリック。
   *  ・チェスト/装備のスロット → 持ち物(ホットバー→メイン)へ
   *  ・持ち物のスロット → チェストが開いていればチェストへ。無ければ、装備できる物は装備スロットへ。それも無ければ hotbar ⇄ main
   */
  function quickTransferInner(area, i) {
    if (!validArea(area, i) || !getArr(area)[i]) return false;
    const from = getArr(area);
    const stack = from[i];
    if (ext.has(area)) {
      moveInto(areas.hotbar, stack); moveInto(areas.main, stack);
    } else {
      const chest = ext.get('chest');
      if (chest) moveInto(chest.arr, stack, 'chest');
      if (stack.count > 0) { // 装備できる物は、合う装備スロットへ
        for (const [name, e] of ext) { if (name === 'chest' || stack.count <= 0) continue; if (e.quickTarget && accepts(name, stack.id)) moveInto(e.arr, stack, name); }
      }
      if (stack.count > 0 && !chest) moveInto(area === 'hotbar' ? areas.main : areas.hotbar, stack);
    }
    if (stack.count === 0) from[i] = null;
    return true;
  }

  /**
   * スロットのクリック。
   * 左: 持ち上げる/置く(同種は足す、違う種類は入れ替え)。
   * 右: 半分持ち上げる/1個置く。
   * Shift+クリック: もう一方のエリアへ転送。
   */
  function clickSlot(area, i, button = 0, { shift = false } = {}) {
    if (!validArea(area, i)) return false;
    const arr = getArr(area);
    if (shift && !cursor) { const r = quickTransferInner(area, i); if (r) emit(); return r; }
    const slot = arr[i];
    // 置けない種類(装備スロットに合わない物)・1個までのスロットの扱い(v1.56)
    if (cursor && !accepts(area, cursor.id)) return false;
    if (cursor && isSingle(area)) {
      if (!slot) { arr[i] = { id: cursor.id, count: 1 }; cursor.count -= 1; if (cursor.count <= 0) cursor = null; emit(); return true; }
      if (cursor.count > 1) return false; // 入れ替えは、1個だけ持っている時
    }
    if (button === 2) {
      if (!cursor) {
        if (!slot) return false;
        const take = Math.ceil(slot.count / 2);
        cursor = { id: slot.id, count: take };
        slot.count -= take;
        if (slot.count === 0) arr[i] = null;
      } else if (!slot) {
        arr[i] = { id: cursor.id, count: 1 }; cursor.count -= 1;
      } else if (slot.id === cursor.id) {
        if (slot.count >= maxStackOf(slot.id)) return false;
        slot.count += 1; cursor.count -= 1;
      } else {
        arr[i] = cursor; cursor = slot;
      }
    } else if (!cursor) {
      if (!slot) return false;
      cursor = slot; arr[i] = null;
    } else if (!slot) {
      arr[i] = cursor; cursor = null;
    } else if (slot.id === cursor.id) {
      tryMerge(arr, i, cursor);
    } else {
      arr[i] = cursor; cursor = slot;
    }
    if (cursor && cursor.count <= 0) cursor = null;
    emit();
    return true;
  }

  /** インベントリ画面で、スロットにカーソルを載せたまま数字キー: そのホットバースロットと中身を入れ替える。 */
  function hotkeySwap(area, i, hotbarIndex) {
    if (!validArea(area, i) || !validArea('hotbar', hotbarIndex) || cursor) return false;
    if (area === 'hotbar' && i === hotbarIndex) return false;
    const a = getArr(area), h = areas.hotbar;
    if (ext.has(area) && a[i] && !accepts(area, areas.hotbar[hotbarIndex] ? areas.hotbar[hotbarIndex].id : null) && areas.hotbar[hotbarIndex]) return false; // 装備スロットに合わない物とは入れ替えない
    const tmp = a[i]; a[i] = h[hotbarIndex]; h[hotbarIndex] = tmp;
    emit();
    return true;
  }

  /** 画面を閉じる時、持ち上げ中のスタックを空きへ戻す。戻せなければ持ち上げたまま残る。 */
  function returnCursor() {
    if (!cursor) return true;
    const left = addItem(cursor.id, cursor.count, { silent: true });
    cursor = left > 0 ? { id: cursor.id, count: left } : null;
    emit();
    return cursor === null;
  }

  // ---- 保存/復元(v1.44でプレイヤーデータとして保存する形) ----

  function serialize() {
    return { main: areas.main.map(copyStack), hotbar: areas.hotbar.map(copyStack), selectedHotbarSlot: selected };
  }
  function load(data) {
    if (!data || typeof data !== 'object') return false;
    const clean = (arr, len) => {
      const out = new Array(len).fill(null);
      if (Array.isArray(arr)) {
        for (let i = 0; i < len; i++) {
          const s = arr[i];
          if (s && isKnownItem(s.id) && s.count > 0) out[i] = { id: s.id, count: Math.min(Math.floor(s.count), maxStackOf(s.id)) };
        }
      }
      return out;
    };
    areas.main = clean(data.main, areas.main.length);
    areas.hotbar = clean(data.hotbar, areas.hotbar.length);
    selected = Number.isInteger(data.selectedHotbarSlot) && data.selectedHotbarSlot >= 0 && data.selectedHotbarSlot < areas.hotbar.length
      ? data.selectedHotbarSlot : 0;
    cursor = null;
    emit();
    return true;
  }

  return {
    mainSlots, hotbarSlots,
    add, addItem, canAdd, count, remove, convert, convertMany,
    select, next, prev, getSelected,
    getSelectedIndex: () => selected,
    getSlot: (area, i) => (validArea(area, i) ? copyStack(getArr(area)[i]) : null),
    attachArea, detachArea, hasArea: (n) => ext.has(n),
    clickSlot, hotkeySwap,
    quickTransfer: (a, i) => { const r = quickTransferInner(a, i); if (r) emit(); return r; },
    returnCursor,
    serialize, load, snapshot,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
