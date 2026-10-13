// save-ui.js (v1.57 / E7)
// ユーザーとワールドの管理画面。ユーザーを作る/選ぶ/削除、ワールドを作る/はじめる/名前を変える/書き出す/読み込む/削除。
// 利用者が入力した名前を表示するので、画面への書き込みは必ず textContent で行う(innerHTML は使わない)。
// 画面の流れ:
//   users  … ユーザーの一覧と、新しいユーザーを作る
//   worlds … 選んだユーザーのワールドの一覧と、新しいワールドを作る・読み込む
//   create … ワールドの名前を入れる → 「生成して見る」(地形が自動で作られ、ページが読み込み直される。気に入らなければ作り直せる)
// 実際の遷移(ワールドを開く/プレビューを始める)は、呼び出し側(index.html)が onEnterWorld / onCreatePreview で行う。

export function createWorldUi({ store, doc = document, onEnterWorld, onCreatePreview, onClose = () => {}, hasCurrentWorld = () => false }) {
  const state = { screen: 'users', userId: null, message: '', messageKind: 'info' };
  let root = null, card = null, open = false;

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
  const btn = (text, onclick, cls = '', extra = {}) => el('button', { type: 'button', class: `world-btn ${cls}`.trim(), text, onclick, ...extra });
  const fmt = (t) => { try { return new Date(t).toLocaleDateString('ja-JP'); } catch (e) { return ''; } };
  const say = (text, kind = 'info') => { state.message = text; state.messageKind = kind; };
  const msgNode = () => (state.message ? el('div', { class: `world-msg ${state.messageKind}`, role: 'status', text: state.message }) : null);
  const go = (screen, extra = {}) => { Object.assign(state, { screen }, extra); render(); };

  function ensureRoot() {
    if (root) return;
    card = el('div', { class: 'world-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'worldTitle' });
    root = el('div', { id: 'worldOverlay', class: 'world-overlay' }, [card]);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && hasCurrentWorld()) close(); });
    doc.body.appendChild(root);
  }

  // ---- ユーザーの画面 ----
  function renderUsers() {
    const users = store.listUsers();
    const input = el('input', { type: 'text', maxlength: '20', placeholder: 'ユーザー名(20文字まで)', 'aria-label': 'ユーザー名', autocomplete: 'off' });
    const make = () => {
      const r = store.createUser(input.value);
      if (!r.ok) { say(r.error, 'error'); render(); return; }
      say('', 'info'); go('worlds', { userId: r.user.id });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') make(); });
    card.append(
      el('h2', { id: 'worldTitle', text: users.length ? 'ユーザーを選んでください' : 'はじめに、ユーザーを作ります' }),
      el('p', { class: 'world-note', text: 'ユーザーごとに、ワールドを保存できます。ユーザーは何人でも(10人まで)登録できます。' }),
    );
    if (users.length) {
      card.appendChild(el('ul', { class: 'world-list' }, users.map((u) => el('li', {}, [
        btn(`${u.name}`, () => go('worlds', { userId: u.id }), 'primary', { 'aria-label': `${u.name}を選ぶ` }),
        el('span', { class: 'world-meta', text: `ワールド ${u.worldCount} 個` }),
        btn('削除', () => {
          if (!confirm(`ユーザー「${u.name}」と、そのワールドをすべて削除します。元に戻せません。よろしいですか?`)) return;
          const r = store.deleteUser(u.id); say(r.ok ? `「${u.name}」を削除しました。` : r.error, r.ok ? 'info' : 'error'); render();
        }, 'danger small', { 'aria-label': `${u.name}を削除` }),
      ]))));
    }
    card.append(el('div', { class: 'world-row' }, [input, btn('ユーザーを作る', make, 'primary')]));
    if (hasCurrentWorld()) card.appendChild(btn('閉じる', close, 'plain'));
  }

  // ---- ワールドの画面 ----
  function renderWorlds() {
    const user = store.listUsers().find((u) => u.id === state.userId);
    if (!user) { go('users'); return; }
    const worlds = store.listWorlds(user.id);
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    importInput.addEventListener('change', async () => {
      const f = importInput.files && importInput.files[0]; if (!f) return;
      const r = store.importWorld(user.id, await f.text());
      say(r.ok ? `「${r.world.name}」を読み込みました。` : r.error, r.ok ? 'info' : 'error'); render();
    });
    card.append(
      el('h2', { id: 'worldTitle', text: `${user.name} さんのワールド` }),
      el('p', { class: 'world-note', text: worlds.length ? 'ワールドを選んで、続きから始められます。' : 'まだワールドがありません。新しく作りましょう。' }),
    );
    if (worlds.length) {
      card.appendChild(el('ul', { class: 'world-list' }, worlds.map((w) => el('li', {}, [
        el('div', { class: 'world-name' }, [el('strong', { text: w.name }), el('span', { class: 'world-meta', text: `作成 ${fmt(w.createdAt)} ・ 最終 ${fmt(w.lastPlayedAt)}` })]),
        el('div', { class: 'world-actions' }, [
          btn('はじめる', () => onEnterWorld(user.id, w.id), 'primary small', { 'aria-label': `${w.name}をはじめる` }),
          btn('名前', () => {
            const n = prompt('新しい名前', w.name); if (n == null) return;
            const r = store.renameWorld(user.id, w.id, n); say(r.ok ? '名前を変えました。' : r.error, r.ok ? 'info' : 'error'); render();
          }, 'small', { 'aria-label': `${w.name}の名前を変える` }),
          btn('書き出し', () => {
            const r = store.exportWorld(user.id, w.id); if (!r.ok) { say(r.error, 'error'); render(); return; }
            const a = el('a', { href: URL.createObjectURL(new Blob([r.text], { type: 'application/json' })), download: r.filename });
            doc.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          }, 'small', { 'aria-label': `${w.name}をファイルに書き出す` }),
          btn('削除', () => {
            if (!confirm(`ワールド「${w.name}」を削除します。元に戻せません。よろしいですか?`)) return;
            const r = store.deleteWorld(user.id, w.id); say(r.ok ? `「${w.name}」を削除しました。` : r.error, r.ok ? 'info' : 'error'); render();
          }, 'danger small', { 'aria-label': `${w.name}を削除` }),
        ]),
      ]))));
    }
    card.append(
      el('div', { class: 'world-row' }, [
        btn('＋ 新しいワールドを作る', () => { say('', 'info'); go('create'); }, 'primary'),
        btn('📂 ファイルから読み込む', () => importInput.click(), ''), importInput,
      ]),
      el('div', { class: 'world-row' }, [
        btn('ユーザーを変える', () => go('users', { userId: null }), 'plain'),
        btn('このユーザーを削除', () => {
          if (!confirm(`ユーザー「${user.name}」と、そのワールドをすべて削除します。元に戻せません。よろしいですか?`)) return;
          const r = store.deleteUser(user.id); say(r.ok ? `「${user.name}」を削除しました。` : r.error, r.ok ? 'info' : 'error'); go('users', { userId: null });
        }, 'danger plain'),
        hasCurrentWorld() ? btn('閉じる', close, 'plain') : null,
      ]),
    );
  }

  // ---- ワールドを作る画面 ----
  function renderCreate() {
    const user = store.listUsers().find((u) => u.id === state.userId); if (!user) { go('users'); return; }
    const input = el('input', { type: 'text', maxlength: '20', placeholder: '例: 大きな丘の草原', 'aria-label': 'ワールド名', autocomplete: 'off' });
    const make = () => {
      const r = store.createWorld(user.id, input.value);
      if (!r.ok) { say(r.error, 'error'); render(); return; }
      onCreatePreview(user.id, r.world);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') make(); });
    card.append(
      el('h2', { id: 'worldTitle', text: '新しいワールド' }),
      el('p', { class: 'world-note', text: 'ワールドの名前を入れて「生成して見る」を押すと、地形(起伏と川)が自動で作られます。気に入らなければ、何度でも作り直せます(作り直した古い地形は残りません)。' }),
      el('div', { class: 'world-row' }, [input, btn('生成して見る', make, 'primary')]),
      btn('戻る', () => { say('', 'info'); go('worlds'); }, 'plain'),
    );
    setTimeout(() => input.focus(), 0);
  }

  function render() {
    ensureRoot();
    card.textContent = '';
    const m = msgNode();
    if (state.screen === 'users') renderUsers();
    else if (state.screen === 'worlds') renderWorlds();
    else renderCreate();
    if (m) card.insertBefore(m, card.children[1] || null);
    const first = card.querySelector('input[type=text]:not([hidden]), button.primary');
    if (first && state.screen !== 'create') setTimeout(() => first.focus && first.focus(), 0);
  }

  function openUi({ screen, userId } = {}) {
    ensureRoot(); open = true; root.classList.add('open');
    const users = store.listUsers();
    const cur = store.getCurrent();
    state.userId = userId ?? (cur.ok ? cur.userId : (users.length === 1 ? users[0].id : null));
    state.screen = screen || (state.userId ? 'worlds' : 'users');
    render();
  }
  function close() { if (!root) return; open = false; root.classList.remove('open'); onClose(); }
  return { open: openUi, close, isOpen: () => open, _state: state };
}
