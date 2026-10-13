// save-store.js (v1.57 / E7)
// ユーザーとワールドの管理、およびワールドごとの保存データ(版番号・チェックサム付き)。
// ブラウザやDOMに依存しない。保存先(localStorage相当)は引数で受け取るので、Nodeで決定的に試験できる。
//
// 【データの置き方】(すべてこの端末のブラウザの中だけ。サーバーへは送らない)
//   snowman.v1.index          … ユーザーの一覧と、各ユーザーのワールドの一覧(名前・シード・状態・日時)。小さい。
//   snowman.v1.world.<id>     … そのワールドの保存データ(置いた物・持ち物など)。ワールドごとに別のキー。
//   snowman.v1.current        … いま遊んでいる {userId, worldId}
//
// 【ワールドの状態】
//   'preview' … 作ったばかりで、プレイヤーが「このワールドで始める」を選ぶ前。気に入らなければ作り直し(古いものは捨てる)。
//   'ready'   … 遊んでいるワールド。自動保存の対象。
//
// 【保存データの形式】{ format:'snowman-save', v:1, worldId, savedAt, checksum, state:{...} }
//   checksum は、state の文字列からFNV-1aで作った8桁の16進数。壊れたデータ(途中で切れた/手で書き換えた)を見つけるためで、
//   セキュリティ目的ではない。版が新しすぎるデータは読み込まない(上書きして壊さない)。古いデータは MIGRATIONS で変換する。

export const SAVE_FORMAT = 'snowman-save';
export const SAVE_VERSION = 1;
export const LIMITS = { users: 10, worldsPerUser: 20, nameMax: 20, stateBytes: 2_000_000 };
const KEY = { index: 'snowman.v1.index', current: 'snowman.v1.current', world: (id) => `snowman.v1.world.${id}` };

/** 古い版 → 新しい版への変換。MIGRATIONS[n] は、v=n のstateを v=n+1 にする。今は版1のみなので空。 */
export const MIGRATIONS = {};

/** 文字列のFNV-1aハッシュ(32bit)を、8桁の16進数で返す。 */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** 名前の正規化: 全角/半角の揺れ(NFKC)をそろえ、空白をつめ、前後を削る。 */
export function normalizeName(s) { return String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim(); }
const nameKey = (s) => normalizeName(s).toLowerCase();

/** 名前の検査。{ok:true,name} または {ok:false,error}。制御文字・長すぎる・空は不可。 */
export function validateName(raw, max = LIMITS.nameMax) {
  const name = normalizeName(raw);
  if (!name) return { ok: false, error: '名前を入力してください。' };
  if ([...name].length > max) return { ok: false, error: `名前は${max}文字までです。` };
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return { ok: false, error: '使えない文字が含まれています。' };
  return { ok: true, name };
}

const fail = (code, error) => ({ ok: false, code, error });

export function createSaveStore(storage, { now = () => Date.now(), rng = Math.random } = {}) {
  const uid = (p) => `${p}_${now().toString(36)}${Math.floor(rng() * 36 ** 4).toString(36).padStart(4, '0')}`;
  const newSeed = () => Math.floor(rng() * 1e9);

  function readJson(key) {
    let raw = null;
    try { raw = storage.getItem(key); } catch (e) { return { ok: false, code: 'unavailable' }; }
    if (raw == null) return { ok: false, code: 'missing' };
    try { return { ok: true, value: JSON.parse(raw), raw }; } catch (e) { return { ok: false, code: 'corrupt' }; }
  }
  function writeRaw(key, text) {
    try { storage.setItem(key, text); return { ok: true }; }
    catch (e) { return fail('quota', 'この端末の保存領域がいっぱいか、保存が許可されていません。'); }
  }
  function removeKey(key) { try { storage.removeItem(key); } catch (e) { /* 消せなくても続行 */ } }

  // ---- 索引(ユーザーとワールドの一覧) ----
  function loadIndex() {
    const r = readJson(KEY.index);
    if (r.ok && r.value && Array.isArray(r.value.users)) return r.value;
    return { format: SAVE_FORMAT, v: SAVE_VERSION, users: [] };
  }
  function saveIndex(idx) { return writeRaw(KEY.index, JSON.stringify(idx)); }
  const findUser = (idx, userId) => idx.users.find((u) => u.id === userId) || null;

  // ---- ユーザー ----
  function listUsers() { return loadIndex().users.map((u) => ({ id: u.id, name: u.name, createdAt: u.createdAt, worldCount: u.worlds.filter((w) => w.status === 'ready').length })); }
  function createUser(rawName) {
    const v = validateName(rawName); if (!v.ok) return fail('name', v.error);
    const idx = loadIndex();
    if (idx.users.length >= LIMITS.users) return fail('limit', `ユーザーは${LIMITS.users}人までです。`);
    if (idx.users.some((u) => nameKey(u.name) === nameKey(v.name))) return fail('duplicate', 'その名前のユーザーはすでにいます。');
    const user = { id: uid('u'), name: v.name, createdAt: now(), worlds: [] };
    idx.users.push(user);
    const w = saveIndex(idx); if (!w.ok) return w;
    return { ok: true, user: { id: user.id, name: user.name } };
  }
  function deleteUser(userId) {
    const idx = loadIndex(); const u = findUser(idx, userId); if (!u) return fail('missing', 'ユーザーが見つかりません。');
    for (const w of u.worlds) removeKey(KEY.world(w.id));
    idx.users = idx.users.filter((x) => x.id !== userId);
    const w = saveIndex(idx); if (!w.ok) return w;
    const cur = getCurrent(); if (cur.ok && cur.userId === userId) clearCurrent();
    return { ok: true };
  }

  // ---- ワールド ----
  const pub = (w) => ({ id: w.id, name: w.name, seed: w.seed, status: w.status, createdAt: w.createdAt, updatedAt: w.updatedAt, lastPlayedAt: w.lastPlayedAt });
  function listWorlds(userId, { includePreview = false } = {}) {
    const u = findUser(loadIndex(), userId); if (!u) return [];
    return u.worlds.filter((w) => includePreview || w.status === 'ready').map(pub);
  }
  function getWorld(userId, worldId) { const u = findUser(loadIndex(), userId); const w = u && u.worlds.find((x) => x.id === worldId); return w ? pub(w) : null; }
  /** 新しいワールド(プレビュー状態)を作る。地形のシードはここで決まる。同じユーザーに同じ名前は作れない。 */
  function createWorld(userId, rawName, seed = null) {
    const v = validateName(rawName); if (!v.ok) return fail('name', v.error);
    const idx = loadIndex(); const u = findUser(idx, userId); if (!u) return fail('missing', 'ユーザーが見つかりません。');
    if (u.worlds.filter((w) => w.status === 'ready').length >= LIMITS.worldsPerUser) return fail('limit', `ワールドは1人${LIMITS.worldsPerUser}個までです。`);
    if (u.worlds.some((w) => nameKey(w.name) === nameKey(v.name) && w.status === 'ready')) return fail('duplicate', 'その名前のワールドはすでにあります。');
    // 名前が同じ未確定(プレビュー)が残っていれば、それは古い作り直しの残りなので捨てる
    for (const w of u.worlds.filter((x) => x.status === 'preview' && nameKey(x.name) === nameKey(v.name))) removeKey(KEY.world(w.id));
    u.worlds = u.worlds.filter((x) => !(x.status === 'preview' && nameKey(x.name) === nameKey(v.name)));
    const t = now();
    const world = { id: uid('w'), name: v.name, seed: Number.isFinite(seed) ? Math.floor(seed) : newSeed(), status: 'preview', createdAt: t, updatedAt: t, lastPlayedAt: t };
    u.worlds.push(world);
    const w = saveIndex(idx); if (!w.ok) return w;
    return { ok: true, world: pub(world) };
  }
  /** 気に入らない時の作り直し: 新しいシードにして、古い保存データは捨てる(プレビューの間だけ可能)。 */
  function rerollWorld(userId, worldId) {
    const idx = loadIndex(); const u = findUser(idx, userId); const w = u && u.worlds.find((x) => x.id === worldId);
    if (!w) return fail('missing', 'ワールドが見つかりません。');
    if (w.status !== 'preview') return fail('state', '始めたワールドは作り直せません(削除してから作ってください)。');
    let s = newSeed(); if (s === w.seed) s = (s + 1) % 1e9;
    w.seed = s; w.updatedAt = now(); removeKey(KEY.world(w.id));
    const r = saveIndex(idx); if (!r.ok) return r;
    return { ok: true, world: pub(w) };
  }
  /** 「このワールドで始める」: プレビュー → 本番。以後、自動保存の対象になる。 */
  function confirmWorld(userId, worldId) {
    const idx = loadIndex(); const u = findUser(idx, userId); const w = u && u.worlds.find((x) => x.id === worldId);
    if (!w) return fail('missing', 'ワールドが見つかりません。');
    if (w.status === 'preview' && u.worlds.some((x) => x.id !== w.id && x.status === 'ready' && nameKey(x.name) === nameKey(w.name))) return fail('duplicate', 'その名前のワールドはすでにあります。');
    w.status = 'ready'; w.updatedAt = now(); w.lastPlayedAt = now();
    const r = saveIndex(idx); if (!r.ok) return r;
    return { ok: true, world: pub(w) };
  }
  function deleteWorld(userId, worldId) {
    const idx = loadIndex(); const u = findUser(idx, userId); if (!u) return fail('missing', 'ユーザーが見つかりません。');
    if (!u.worlds.some((x) => x.id === worldId)) return fail('missing', 'ワールドが見つかりません。');
    u.worlds = u.worlds.filter((x) => x.id !== worldId); removeKey(KEY.world(worldId));
    const r = saveIndex(idx); if (!r.ok) return r;
    const cur = getCurrent(); if (cur.ok && cur.worldId === worldId) clearCurrent();
    return { ok: true };
  }
  function renameWorld(userId, worldId, rawName) {
    const v = validateName(rawName); if (!v.ok) return fail('name', v.error);
    const idx = loadIndex(); const u = findUser(idx, userId); const w = u && u.worlds.find((x) => x.id === worldId);
    if (!w) return fail('missing', 'ワールドが見つかりません。');
    if (u.worlds.some((x) => x.id !== worldId && x.status === 'ready' && nameKey(x.name) === nameKey(v.name))) return fail('duplicate', 'その名前のワールドはすでにあります。');
    w.name = v.name; w.updatedAt = now();
    const r = saveIndex(idx); if (!r.ok) return r;
    return { ok: true, world: pub(w) };
  }
  /** 作りかけのまま放置されたプレビューを片づける(ブラウザを閉じた等)。現在選択中のものは残す。 */
  function purgeStalePreviews(maxAgeMs = 24 * 3600 * 1000) {
    const idx = loadIndex(); const cur = getCurrent(); let n = 0;
    for (const u of idx.users) {
      const keep = [];
      for (const w of u.worlds) {
        if (w.status === 'preview' && now() - w.updatedAt > maxAgeMs && !(cur.ok && cur.worldId === w.id)) { removeKey(KEY.world(w.id)); n++; } else keep.push(w);
      }
      u.worlds = keep;
    }
    if (n) saveIndex(idx);
    return n;
  }

  // ---- 現在の選択 ----
  function setCurrent(userId, worldId) {
    const w = getWorld(userId, worldId); if (!w) return fail('missing', 'ワールドが見つかりません。');
    return writeRaw(KEY.current, JSON.stringify({ userId, worldId }));
  }
  function getCurrent() {
    const r = readJson(KEY.current); if (!r.ok || !r.value) return { ok: false };
    const { userId, worldId } = r.value; const w = getWorld(userId, worldId);
    if (!w) return { ok: false };
    const u = findUser(loadIndex(), userId);
    return { ok: true, userId, worldId, userName: u.name, world: w };
  }
  function clearCurrent() { removeKey(KEY.current); }

  // ---- ワールドの保存データ ----
  function makeEnvelope(worldId, state) {
    const body = JSON.stringify(state);
    // rev: 保存のたびに変わる目印。別のタブが保存したかを調べるのに使う(古い内容で、新しい保存を黙って上書きしないため)
    return { format: SAVE_FORMAT, v: SAVE_VERSION, worldId, savedAt: now(), rev: uid('r'), checksum: fnv1a(body), state };
  }
  /**
   * 保存。{ok:true,bytes,rev} または {ok:false,code}。大きすぎる場合は保存しない(以前のデータは残る)。
   * expectRev を渡すと(undefined以外)、いま保存されている物の rev と一致する時だけ保存する。
   * 一致しなければ(=別のタブが、このタブの読み込み後に保存した) code:'conflict' で保存しない。
   * まだ何も保存されていないワールドの expectRev は null。
   */
  function saveWorldState(userId, worldId, state, { expectRev } = {}) {
    const w = getWorld(userId, worldId); if (!w) return fail('missing', 'ワールドが見つかりません。');
    if (w.status !== 'ready') return fail('state', '始める前のワールドは保存しません。');
    if (expectRev !== undefined) {
      const cur = readJson(KEY.world(worldId));
      const curRev = cur.ok && cur.value && typeof cur.value === 'object' ? (cur.value.rev ?? null) : null;
      if (curRev !== expectRev) return { ...fail('conflict', '別のタブで、このワールドが保存されました。'), rev: curRev };
    }
    const env = makeEnvelope(worldId, state);
    const text = JSON.stringify(env);
    if (text.length > LIMITS.stateBytes) return fail('too-large', '保存データが大きすぎます。');
    const r = writeRaw(KEY.world(worldId), text); if (!r.ok) return r;
    const idx = loadIndex(); const u = findUser(idx, userId); const x = u.worlds.find((y) => y.id === worldId); x.updatedAt = now(); x.lastPlayedAt = now(); saveIndex(idx);
    return { ok: true, bytes: text.length, rev: env.rev };
  }
  /** 版・形式・チェックサムを確かめて、必要なら古い版から変換する。 */
  function verifyEnvelope(env) {
    if (!env || typeof env !== 'object' || env.format !== SAVE_FORMAT || !env.state || typeof env.state !== 'object') return fail('corrupt', '保存データの形式が違います。');
    if (!Number.isInteger(env.v) || env.v < 1) return fail('corrupt', '保存データの版が読めません。');
    if (env.v > SAVE_VERSION) return fail('newer', 'このアプリより新しい版で作られた保存データです。アプリを更新してください。');
    if (fnv1a(JSON.stringify(env.state)) !== env.checksum) return fail('corrupt', '保存データが壊れています(チェックサムが合いません)。');
    let state = env.state, v = env.v;
    while (v < SAVE_VERSION) { const m = MIGRATIONS[v]; if (!m) return fail('corrupt', `版${v}の保存データを変換できません。`); state = m(state); v++; }
    return { ok: true, state, migrated: env.v !== SAVE_VERSION };
  }
  function loadWorldState(userId, worldId) {
    const w = getWorld(userId, worldId); if (!w) return fail('missing', 'ワールドが見つかりません。');
    const r = readJson(KEY.world(worldId));
    if (!r.ok) return r.code === 'missing' ? { ok: true, state: null, fresh: true, rev: null } : fail(r.code, '保存データを読めませんでした。');
    const v = verifyEnvelope(r.value); if (!v.ok) return v;
    return { ok: true, state: v.state, migrated: v.migrated, savedAt: r.value.savedAt, rev: r.value.rev ?? null };
  }

  /** いま保存されている物の rev(保存データが壊れていても、読める範囲で)。無ければ null。 */
  function peekRev(worldId) {
    const r = readJson(KEY.world(worldId));
    return r.ok && r.value && typeof r.value === 'object' ? (r.value.rev ?? null) : null;
  }

  // ---- 書き出し・読み込み(JSONファイル) ----
  function exportWorld(userId, worldId) {
    const w = getWorld(userId, worldId); if (!w) return fail('missing', 'ワールドが見つかりません。');
    const loaded = loadWorldState(userId, worldId); if (!loaded.ok) return loaded;
    const env = makeEnvelope(worldId, loaded.state || {});
    return { ok: true, filename: `snowman-${w.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.json`, text: JSON.stringify({ ...env, world: { name: w.name, seed: w.seed } }, null, 1) };
  }
  function importWorld(userId, text) {
    let data; try { data = JSON.parse(text); } catch (e) { return fail('corrupt', 'JSONとして読めませんでした。'); }
    const v = verifyEnvelope(data); if (!v.ok) return v;
    const meta = data.world || {};
    if (!Number.isFinite(meta.seed)) return fail('corrupt', 'ワールドのシードが見つかりません。');
    const u = findUser(loadIndex(), userId); if (!u) return fail('missing', 'ユーザーが見つかりません。');
    const base = validateName(meta.name || 'ワールド'); let name = base.ok ? base.name : 'ワールド';
    for (let n = 2; u.worlds.some((w) => w.status === 'ready' && nameKey(w.name) === nameKey(name)) && n < 100; n++) name = `${[...base.name].slice(0, LIMITS.nameMax - 4).join('')} (${n})`;
    const c = createWorld(userId, name, meta.seed); if (!c.ok) return c;
    const k = confirmWorld(userId, c.world.id); if (!k.ok) return k;
    const s = saveWorldState(userId, c.world.id, v.state); if (!s.ok) { deleteWorld(userId, c.world.id); return s; }
    return { ok: true, world: getWorld(userId, c.world.id) };
  }

  return {
    listUsers, createUser, deleteUser,
    listWorlds, getWorld, createWorld, rerollWorld, confirmWorld, deleteWorld, renameWorld, purgeStalePreviews,
    setCurrent, getCurrent, clearCurrent,
    saveWorldState, loadWorldState, peekRev, exportWorld, importWorld,
  };
}
