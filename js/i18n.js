// i18n.js (v1.72)
// 日本語/英語の切り替え。辞書は js/i18n/ja.js と js/i18n/en.js(キー → 文字列)。
//   ・HTML: data-i18n="キー"(本文)/ data-i18n-html="キー"(<br>や<strong>を含む本文。辞書の文字列だけを入れる)/
//           data-i18n-title・data-i18n-aria-label・data-i18n-placeholder・data-i18n-alt="キー"(属性)
//   ・JS:   t('キー', { 差し込み })。文字列の中の {name} が差し込みの場所
//   ・初期は英語。選んだ言語は localStorage('snowman.lang.v1')に覚える(ブラウザの言語設定は見ない)。
//   ・切り替えは再読み込みなしで反映。動的に作る画面は、onLangChange に登録して作り直す。
//   ・キーが無い時は、英語 → 日本語 → キーそのもの、の順に使う(翻訳漏れで空白にならない)。
import ja from './i18n/ja.js';
import en from './i18n/en.js';

export const LANGS = ['en', 'ja'];
export const DEFAULT_LANG = 'en';
export const LANG_KEY = 'snowman.lang.v1';
const DICTS = { ja, en };

let lang = DEFAULT_LANG;
try { const v = localStorage.getItem(LANG_KEY); if (LANGS.includes(v)) lang = v; } catch (e) { /* 使えない環境では英語 */ }
const listeners = new Set();

// module ではない古いスクリプト(js/audio/*.js)が、翻訳を使えるように、窓口を1つ置く
if (typeof window !== 'undefined') window.snowmanT = (key, params) => t(key, params);

export const getLang = () => lang;
export const localeTag = () => (lang === 'ja' ? 'ja-JP' : 'en-US');

/** キーから文字列を取り出す。{name} を params で置き換える。 */
export function t(key, params) {
  let s = DICTS[lang][key];
  if (s === undefined) s = DICTS.en[key];
  if (s === undefined) s = DICTS.ja[key];
  if (s === undefined) return key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

const ATTR_SELECTOR = '[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-alt]';
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];

/** root の中の data-i18n* を、いまの言語で埋める。 */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.getAttribute('data-i18n-html')); // 辞書の文字列だけ(利用者の入力は入れない)
  for (const el of root.querySelectorAll(ATTR_SELECTOR)) {
    for (const a of ATTRS) { const k = el.getAttribute('data-i18n-' + a); if (k) el.setAttribute(a, t(k)); }
  }
  if (root === document) {
    document.documentElement.lang = lang;
    document.title = t('app.documentTitle');
    for (const sw of document.querySelectorAll('[data-lang-switch]')) {
      for (const b of sw.querySelectorAll('button[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    }
  }
}

/** 言語を切り替える。画面の静的な文字を埋め直し、登録された作り直しを呼ぶ。 */
export function setLang(next, { persist = true } = {}) {
  if (!LANGS.includes(next)) return false;
  const changed = next !== lang;
  lang = next;
  if (persist) { try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* 保存できなくても、このページの間は切り替わる */ } }
  applyI18n(document);
  if (changed) for (const fn of [...listeners]) { try { fn(lang); } catch (e) { console.warn('[i18n]', e); } }
  return true;
}

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** 起動画面・設定画面の「English | 日本語」ボタン([data-lang-switch] の中の button[data-lang])を働かせる。 */
export function bindLangSwitches(root = document) {
  for (const sw of root.querySelectorAll('[data-lang-switch]')) {
    if (sw.dataset.bound) continue;
    sw.dataset.bound = '1';
    sw.addEventListener('click', (e) => { const b = e.target.closest('button[data-lang]'); if (b) setLang(b.dataset.lang); });
  }
  applyI18n(document);
}

/** 起動時に1回: 画面を、いまの言語で埋めて、ちらつき防止(i18n-pending)を外す。 */
export function initI18n() {
  bindLangSwitches(document);
  document.documentElement.classList.remove('i18n-pending');
}

/** 開発用: 2つの辞書の差(片方にしか無いキー)を返す。 */
export function dictionaryDiff() {
  const a = new Set(Object.keys(ja)), b = new Set(Object.keys(en));
  return { onlyJa: [...a].filter((k) => !b.has(k)), onlyEn: [...b].filter((k) => !a.has(k)) };
}
