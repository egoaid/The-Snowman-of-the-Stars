// session-mode.js (v1.50 Phase C)
// 起動画面で選ぶ「歩行 / 見守り / 編集」の3モードの既定値と、切り替えの手順。
// 実体(シーン)には依存せず、操作口(ops)を受け取るだけの純粋なモジュール。ヘッドレスで検証できる。
//
// 既定値(仕様書 v1.47 Next Phase の 6〜8節):
//   歩行 : 音ON / プレイヤー操作 / 自動カメラなし
//   見守り: 音ON / 雪だるまが自律で動く / 自動カメラON
//   編集 : 音ON / 雪だるまが自律で動く(世界は止めない) / 自動カメラOFF / 自由に物を動かせる

import { t } from './i18n.js';

// label / hint は、言語に合わせて、読むたびに引く(切り替えがすぐ反映される)
export const SESSION_MODES = {
  walk:  { id: 'walk',  get label() { return t('mode.walk.label'); },   get hint() { return t('mode.walk.hint'); }, sound: true, player: true,  wander: false, autoCamera: false, edit: false },
  watch: { id: 'watch', get label() { return t('mode.watch.label'); }, get hint() { return t('mode.watch.hint'); }, sound: true, player: false, wander: true,  autoCamera: true,  edit: false },
  edit:  { id: 'edit',  get label() { return t('mode.edit.label'); },   get hint() { return t('mode.edit.hint'); }, sound: true, player: false, wander: true,  autoCamera: false, edit: true },
};
export const SESSION_MODE_IDS = Object.keys(SESSION_MODES);

/**
 * モードを適用する。どのモードからどのモードへでも、同じ手順で同じ状態になる。
 * @param {string} id 'walk' | 'watch' | 'edit'
 * @param {object} ops
 *   isWalking(): 歩行中か / exitWalk() / enterWalk()
 *   setWander(bool) / setAutoCamera(bool) / editEnable() / editDisable() / isEditing()
 * @returns {object|null} 適用したモード定義(未知のidならnull)
 */
export function applySessionMode(id, ops) {
  const m = SESSION_MODES[id];
  if (!m) return null;
  if (m.player) {
    // 歩行: 編集は両立しない。自律移動は切って、プレイヤーが雪だるまを動かす。
    if (ops.isEditing()) ops.editDisable();
    ops.setAutoCamera(false);
    ops.setWander(false);
    ops.enterWalk();
    return m;
  }
  // 見守り・編集: まず歩行を抜ける(ポインターロック解除)。
  if (ops.isWalking()) ops.exitWalk();
  ops.setWander(m.wander);
  if (m.edit) {
    ops.setAutoCamera(false);
    if (!ops.isEditing()) ops.editEnable();
  } else {
    if (ops.isEditing()) ops.editDisable();
    ops.setAutoCamera(m.autoCamera);
  }
  return m;
}

/** 現在の状態から、いまのモードを求める(どれにも当てはまらなければ'free'=自由カメラ)。 */
export function currentSessionMode({ walking, editing, wandering }) {
  if (walking) return 'walk';
  if (editing) return 'edit';
  if (wandering) return 'watch';
  return 'free';
}
