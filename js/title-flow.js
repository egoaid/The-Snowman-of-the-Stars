// title-flow.js (v1.59)
// 起動画面の流れ。ポップアップは使わない(タイトル画面のカードの中身が、静かに入れ替わるだけ)。
//   start  … 「はじめる」だけ(ユーザーがいる時は、そのとなりに「設定」)
//   form   … ユーザー名とワールド名を入れる / ワールドを選ぶ / ユーザーを選ぶ(同じ場所に表示)
//   modes  … ワールドが決まったあと。歩行モード・見守りモード・編集モード・設定
// プレイヤーが自分で押すまで、何も自動では開かない。利用者が入れた名前は、必ず textContent で表示する(innerHTML は使わない)。

const DEFAULT_USER_NAME = 'ゆきだるま';

export function createTitleFlow({ store, doc = document, startEl, formEl, modesEl, onEnterWorld, onCreatePreview, onManage = () => {}, onStageChange = () => {} }) {
  const stages = { start: startEl, form: formEl, modes: modesEl };
  let stage = 'start';
  let message = { text: '', kind: 'info' };

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
  const fmt = (t) => { try { return new Date(t).toLocaleDateString('ja-JP'); } catch (e) { return ''; } };
  const say = (text, kind = 'info') => { message = { text, kind }; };
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
    formEl.textContent = '';
    render();
    show('form');
  }

  // ---- 作る(ユーザー名+ワールド名。ユーザーがすでにいる時は、ワールド名だけ) ----
  function renderCreate({ userId = null } = {}) {
    const user = userId ? store.listUsers().find((u) => u.id === userId) : null;
    const defaultWorld = () => {
      const names = new Set(store.listWorlds(user ? user.id : '__none__').map((w) => w.name));
      for (let n = 1; n < 100; n++) { const c = `ワールド ${n}`; if (!names.has(c)) return c; }
      return 'ワールド';
    };
    const userInput = user ? null : el('input', { type: 'text', maxlength: '20', placeholder: DEFAULT_USER_NAME, 'aria-label': 'ユーザー名', autocomplete: 'off', enterkeyhint: 'next' });
    const worldInput = el('input', { type: 'text', maxlength: '20', placeholder: defaultWorld(), 'aria-label': 'ワールド名', autocomplete: 'off', enterkeyhint: 'done' });
    const make = () => {
      let uid = user ? user.id : null;
      if (!uid) {
        const r = store.createUser(userInput.value.trim() || DEFAULT_USER_NAME);
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
    formEl.append(
      el('h2', { class: 'tf-h', text: user ? `${user.name} さんの あたらしいワールド` : 'はじめまして' }),
      msgNode(),
      userInput && el('label', { class: 'tf-field' }, [el('span', { text: 'ユーザー名' }), userInput]),
      el('label', { class: 'tf-field' }, [el('span', { text: 'ワールド名' }), worldInput]),
      el('p', { class: 'tf-note', text: '空のままでも大丈夫です。名前は、あとから変えられます。つくると地形(起伏と川)が自動で作られ、気に入らなければ何度でも作り直せます。' }),
      el('div', { class: 'title-buttons' }, [btn('つくる', make, 'tf-primary'), btn('もどる', backTo, 'tf-plain')]),
    );
  }

  // ---- ワールドを選ぶ ----
  function renderWorlds(userId) {
    const user = store.listUsers().find((u) => u.id === userId);
    if (!user) { renderUsers(); return; }
    const worlds = store.listWorlds(userId).slice().sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
    if (!worlds.length) { renderCreate({ userId }); return; }
    const users = store.listUsers();
    formEl.append(
      el('h2', { class: 'tf-h', text: `${user.name} さんの ワールド` }),
      msgNode(),
      el('div', { class: 'tf-list' }, worlds.map((w) => el('button', { type: 'button', class: 'tf-item', onclick: () => { say('', 'info'); onEnterWorld(userId, w.id); } }, [
        el('span', { class: 'tf-item-name', text: w.name }),
        el('span', { class: 'tf-item-meta', text: w.lastPlayedAt ? `最後に遊んだ日 ${fmt(w.lastPlayedAt)}` : '' }),
      ]))),
      el('div', { class: 'title-buttons' }, [
        btn('あたらしいワールド', () => { say('', 'info'); showForm(() => renderCreate({ userId })); }, 'tf-plain'),
        btn(users.length > 1 ? 'ユーザーをかえる' : 'ユーザーをふやす・かえる', () => { say('', 'info'); showForm(() => renderUsers()); }, 'tf-plain'),
        btn('ワールドの管理(名前・削除・書き出し)', () => onManage(userId), 'tf-link'),
        btn('もどる', () => { say('', 'info'); show('start'); }, 'tf-plain'),
      ]),
    );
  }

  // ---- ユーザーを選ぶ ----
  function renderUsers() {
    const users = store.listUsers();
    formEl.append(
      el('h2', { class: 'tf-h', text: 'ユーザーをえらんでください' }),
      msgNode(),
      el('div', { class: 'tf-list' }, users.map((u) => el('button', { type: 'button', class: 'tf-item', onclick: () => { say('', 'info'); showForm(() => renderWorlds(u.id)); } }, [
        el('span', { class: 'tf-item-name', text: u.name }),
        el('span', { class: 'tf-item-meta', text: `ワールド ${u.worldCount} 個` }),
      ]))),
      el('div', { class: 'title-buttons' }, [
        btn('あたらしいユーザー', () => { say('', 'info'); showForm(() => renderCreate({})); }, 'tf-plain'),
        btn('もどる', () => { say('', 'info'); show('start'); }, 'tf-plain'),
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
