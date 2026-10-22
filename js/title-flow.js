// title-flow.js (v1.59)
// 起動画面の流れ。ポップアップは使わない(タイトル画面のカードの中身が、静かに入れ替わるだけ)。
//   start  … 「はじめる」だけ(ユーザーがいる時は、そのとなりに「設定」)
//   form   … ユーザー名とワールド名を入れる / ワールドを選ぶ / ユーザーを選ぶ(同じ場所に表示)
//   modes  … ワールドが決まったあと。歩行モード・見守りモード・編集モード・設定
// プレイヤーが自分で押すまで、何も自動では開かない。利用者が入れた名前は、必ず textContent で表示する(innerHTML は使わない)。

import { t, localeTag, onLangChange } from './i18n.js';


export function createTitleFlow({ store, doc = document, startEl, formEl, modesEl, onEnterWorld, onCreatePreview, onManage = () => {}, onStageChange = () => {} }) {
  const stages = { start: startEl, form: formEl, modes: modesEl };
  let stage = 'start';
  let message = { text: '', kind: 'info' };
  let lastRender = null;   // v1.72: 形(フォーム)の画面を、言語を切り替えた時に作り直すため

  const el = (tag, props = {}, children = []) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children)) if (c) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
    return n;
  };
  const btn = (text, onclick, cls = '') => el('button', { type: 'button', class: cls, text, onclick });
  const fmt = (ms) => { try { return new Date(ms).toLocaleDateString(localeTag()); } catch (e) { return ''; } };
  const say = (text, kind = 'info') => { message = { text, kind }; };
  // 空(null)の子は入れない。append(null) は、文字の「null」を画面に出してしまう
  const put = (...nodes) => formEl.append(...nodes.filter(Boolean));
  const msgNode = () => (message.text ? el('div', { class: `tf-msg ${message.kind}`, role: 'status', text: message.text }) : null);

  function show(name) {
    stage = name;
    for (const [k, node] of Object.entries(stages)) if (node) node.hidden = k !== name;
    if (name === 'start') refreshStart();
    onStageChange(name);
  }
  /** 「設定」は、ユーザーを作ったあとから見える。最初は「はじめる」だけ。 */
  function refreshStart() {
    const has = store.listUsers().length > 0;
    for (const b of startEl.querySelectorAll('.js-title-settings')) b.hidden = !has;
  }

  function showForm(render) {
    lastRender = render;
    formEl.textContent = '';
    render();
    show('form');
  }
  /** 言語を切り替えた時: 表示中のフォームを、入力した文字を残したまま作り直す(メッセージは、そのまま) */
  function relocalize() {
    if (stage !== 'form' || !lastRender) { refreshStart(); return; }
    const vals = [...formEl.querySelectorAll('input')].map((i) => i.value);
    formEl.textContent = '';
    lastRender();
    [...formEl.querySelectorAll('input')].forEach((i, k) => { if (vals[k] !== undefined && vals[k] !== '') i.value = vals[k]; });
  }
  onLangChange(relocalize);

  // ---- 作る(ユーザー名+ワールド名。ユーザーがすでにいる時は、ワールド名だけ) ----
  function renderCreate({ userId = null } = {}) {
    const user = userId ? store.listUsers().find((u) => u.id === userId) : null;
    const defaultWorld = () => {
      const names = new Set(store.listWorlds(user ? user.id : '__none__').map((w) => w.name));
      for (let n = 1; n < 100; n++) { const c = t('tf.defaultWorld', { n }); if (!names.has(c)) return c; }
      return t('tf.defaultWorldBase');
    };
    const userInput = user ? null : el('input', { type: 'text', maxlength: '20', placeholder: t('tf.defaultUser'), 'aria-label': t('tf.userName'), autocomplete: 'off', enterkeyhint: 'next' });
    const worldInput = el('input', { type: 'text', maxlength: '20', placeholder: defaultWorld(), 'aria-label': t('tf.worldName'), autocomplete: 'off', enterkeyhint: 'done' });
    const make = () => {
      let uid = user ? user.id : null;
      if (!uid) {
        const r = store.createUser(userInput.value.trim() || userInput.placeholder);
        if (!r.ok) { say(r.error, 'error'); showForm(() => renderCreate({ userId })); return; }
        uid = r.user.id;
      }
      const w = store.createWorld(uid, worldInput.value.trim() || worldInput.placeholder);
      if (!w.ok) { say(w.error, 'error'); showForm(() => renderCreate({ userId: uid })); return; }
      say('', 'info');
      onCreatePreview(uid, w.world);
    };
    const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); make(); } };
    if (userInput) userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); worldInput.focus(); } });
    worldInput.addEventListener('keydown', onEnter);
    const backTo = () => { say('', 'info'); if (user) renderWorlds(user.id); else show('start'); };
    put(
      el('h2', { class: 'tf-h', text: user ? t('tf.newWorldOf', { name: user.name }) : t('tf.hello') }),
      msgNode(),
      userInput && el('label', { class: 'tf-field' }, [el('span', { text: t('tf.userName') }), userInput]),
      el('label', { class: 'tf-field' }, [el('span', { text: t('tf.worldName') }), worldInput]),
      el('p', { class: 'tf-note', text: t('tf.note.create') }),
      el('div', { class: 'title-buttons' }, [btn(t('tf.create'), make, 'tf-primary'), btn(t('tf.back'), backTo, 'tf-plain')]),
    );
  }

  // ---- ワールドを選ぶ ----
  function renderWorlds(userId) {
    const user = store.listUsers().find((u) => u.id === userId);
    if (!user) { renderUsers(); return; }
    const worlds = store.listWorlds(userId).slice().sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
    if (!worlds.length) { renderCreate({ userId }); return; }
    const users = store.listUsers();
    put(
      el('h2', { class: 'tf-h', text: t('tf.worldsOf', { name: user.name }) }),
      msgNode(),
      el('div', { class: 'tf-list' }, worlds.map((w) => el('button', { type: 'button', class: 'tf-item', onclick: () => { say('', 'info'); onEnterWorld(userId, w.id); } }, [
        el('span', { class: 'tf-item-name', text: w.name }),
        el('span', { class: 'tf-item-meta', text: w.lastPlayedAt ? t('tf.lastPlayed', { date: fmt(w.lastPlayedAt) }) : '' }),
      ]))),
      el('div', { class: 'title-buttons' }, [
        btn(t('tf.newWorld'), () => { say('', 'info'); showForm(() => renderCreate({ userId })); }, 'tf-plain'),
        btn(users.length > 1 ? t('tf.switchUser') : t('tf.addSwitchUser'), () => { say('', 'info'); showForm(() => renderUsers()); }, 'tf-plain'),
        btn(t('tf.manage'), () => onManage(userId), 'tf-link'),
        btn(t('tf.back'), () => { say('', 'info'); show('start'); }, 'tf-plain'),
      ]),
    );
  }

  // ---- ユーザーを選ぶ ----
  function renderUsers() {
    const users = store.listUsers();
    put(
      el('h2', { class: 'tf-h', text: t('tf.pickUser') }),
      msgNode(),
      el('div', { class: 'tf-list' }, users.map((u) => el('button', { type: 'button', class: 'tf-item', onclick: () => { say('', 'info'); showForm(() => renderWorlds(u.id)); } }, [
        el('span', { class: 'tf-item-name', text: u.name }),
        el('span', { class: 'tf-item-meta', text: t('tf.worldCount', { n: u.worldCount }) }),
      ]))),
      el('div', { class: 'title-buttons' }, [
        btn(t('tf.newUser'), () => { say('', 'info'); showForm(() => renderCreate({})); }, 'tf-plain'),
        btn(t('tf.back'), () => { say('', 'info'); show('start'); }, 'tf-plain'),
      ]),
    );
  }

  /** 「はじめる」: ユーザーがいなければ作る画面、いれば自分のワールドを選ぶ画面へ。 */
  function begin({ currentUserId = null } = {}) {
    const users = store.listUsers();
    say('', 'info');
    if (!users.length) return showForm(() => renderCreate({}));
    const uid = currentUserId && users.some((u) => u.id === currentUserId) ? currentUserId : (users.length === 1 ? users[0].id : null);
    if (uid) return showForm(() => renderWorlds(uid));
    return showForm(() => renderUsers());
  }
  /** モード選択の画面へ(ワールドが決まっている時)。 */
  function showModes() { say('', 'info'); show('modes'); }
  /** ワールドを選びなおす(モード選択の画面から)。 */
  function reselect({ currentUserId = null } = {}) { begin({ currentUserId }); }

  return { show, begin, showModes, reselect, getStage: () => stage, refreshStart, _renderCreate: (o) => showForm(() => renderCreate(o || {})) };
}
