// piano-panel.js (v1.97) — 演奏パネル。画面の鍵盤・PCキーボード・外部MIDIキーボードの、どれで弾いても同じ。
//   ・開く: Pキー / スマホは🎹。歩行モードの間だけ開ける。開いている間は、歩かない(scene3d.js が止める)。
//   ・音は、近くの自然物(自動)か、パネルで選んだ自然物。
//   ・開いている間、鍵盤のキーは、ほかの操作(Eのインベントリ・Bのエモートなど)より先に、演奏として受け取る。
import { SOURCES, SOURCE_ICON, keyToMidi, isNoteKey, isBlackKey, noteName, OCTAVE_MIN, OCTAVE_MAX } from './notes.js';
import { createMidiInput } from './midi-input.js';
import { t } from '../i18n.js';

export function createMusicPanel({ root, instrument, getAutoSource = () => 'insect', getPower = () => ({ state: 'ok', fraction: 1 }), onOpenChange = () => {}, canOpen = () => true, onPress = () => {}, onRelease = () => {}, onBaseChange = () => {}, onSource = () => {} }) {
  const $ = (sel) => root.querySelector(sel);
  const keysEl = $('#musicKeys'), srcEl = $('#musicSources'), statusEl = $('#musicStatus'), midiBtn = $('#musicMidiBtn'), midiStatus = $('#musicMidiStatus');
  const octLabel = $('#musicOctave'), kbEl = $('#musicKb'), batEl = $('#musicBattery');
  let open = false, selected = 'auto', octave = 0, timer = null, lastSource = null;
  const down = new Map(); // 押している鍵盤: 入力元(key:コード / ptr:id / midi)→ノート

  const currentSource = () => (selected === 'auto' ? getAutoSource() : selected);

  // ---- 音を鳴らす/止める(どの入力からでも、ここを通る) ----
  function press(midi, vel = 0.8) { instrument.noteOn(currentSource(), midi, vel); onPress(midi); const el = keysEl.querySelector(`[data-midi="${midi}"]`); if (el) el.classList.add('down'); }
  function release(midi) { instrument.noteOff(midi); onRelease(midi); const el = keysEl.querySelector(`[data-midi="${midi}"]`); if (el && ![...down.values()].includes(midi)) el.classList.remove('down'); }

  // ---- 鍵盤(画面): C〜C の2オクターブ+1音。PCキーの文字を鍵盤に表示する ----
  function buildKeys() {
    keysEl.textContent = '';
    const base = 48 + octave * 12, labels = {};
    for (const code of ['KeyZ','KeyS','KeyX','KeyD','KeyC','KeyV','KeyG','KeyB','KeyH','KeyN','KeyJ','KeyM','Comma','KeyQ','Digit2','KeyW','Digit3','KeyE','KeyR','Digit5','KeyT','Digit6','KeyY','Digit7','KeyU','KeyI']) {
      const m = keyToMidi(code, octave); if (m !== null && !(m in labels)) labels[m] = code.replace('Key', '').replace('Digit', '').replace('Comma', ',');
    }
    let whiteIndex = 0;
    const whites = [];
    for (let m = base; m <= base + 36; m++) if (!isBlackKey(m)) whites.push(m); // 37鍵(C〜C 3オクターブ)。世界に置かれているキーボードと同じ
    const W = 100 / whites.length;
    for (let m = base; m <= base + 36; m++) {
      const el = document.createElement('div');
      el.className = 'mkey ' + (isBlackKey(m) ? 'black' : 'white'); el.dataset.midi = m; el.title = noteName(m);
      if (isBlackKey(m)) el.style.left = `${(whiteIndex - 0.3) * W}%`; else { el.style.left = `${whiteIndex * W}%`; el.style.width = `${W}%`; whiteIndex++; }
      if (isBlackKey(m)) el.style.width = `${W * 0.62}%`;
      if (labels[m]) { const s = document.createElement('span'); s.className = 'mlbl'; s.textContent = labels[m]; el.appendChild(s); }
      keysEl.appendChild(el);
    }
    octLabel.textContent = `${noteName(base)}–${noteName(base + 36)}`;
    onBaseChange(base);
  }
  // 画面の鍵盤を、指・マウスで弾く(複数の指でも弾ける)
  keysEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.mkey'); if (!el) return; e.preventDefault();
    const m = Number(el.dataset.midi); down.set('ptr' + e.pointerId, m); press(m, 0.45 + 0.4 * (1 - (e.offsetY || 0) / Math.max(1, el.clientHeight))); // 鍵盤の手前(下)を押すほど、強い
    try { keysEl.setPointerCapture(e.pointerId); } catch (err) { /* 非対応でも弾ける */ }
  });
  const pointerUp = (e) => { const k = 'ptr' + e.pointerId, m = down.get(k); if (m === undefined) return; down.delete(k); release(m); };
  keysEl.addEventListener('pointerup', pointerUp); keysEl.addEventListener('pointercancel', pointerUp);
  keysEl.addEventListener('lostpointercapture', pointerUp);

  // ---- 自然物の選択 ----
  function buildSources() {
    srcEl.textContent = '';
    for (const id of ['auto', ...SOURCES]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'msrc'; b.dataset.src = id;
      b.innerHTML = `<span class="mico">${id === 'auto' ? '🧭' : SOURCE_ICON[id]}</span><span class="mname"></span>`;
      b.querySelector('.mname').textContent = t(`music.src.${id}`);
      b.addEventListener('click', () => { selected = id; syncStatus(); });
      srcEl.appendChild(b);
    }
  }
  function syncStatus() {
    for (const b of srcEl.querySelectorAll('.msrc')) b.classList.toggle('on', b.dataset.src === selected);
    const cur = currentSource();
    if (cur !== lastSource) { lastSource = cur; onSource(cur); } // いま演奏している自然物(MIDIケーブルのつなぎ先)
    const pw = getPower(); // 電池: 本体が光る(ok) / 点滅(low) / 光らない(dead・none)。CSS が見た目を決める
    kbEl.classList.toggle('on', pw.state === 'ok'); kbEl.classList.toggle('low', pw.state === 'low'); kbEl.classList.toggle('dead', pw.state === 'dead' || pw.state === 'none');
    const pct = Math.round(pw.fraction * 100);
    batEl.textContent = `🔋 ${t(`music.batteryState.${pw.state === 'none' ? 'dead' : pw.state}`, { pct })}`; batEl.className = 'music-battery ' + (pw.state === 'low' ? 'low' : pw.state === 'dead' || pw.state === 'none' ? 'dead' : '');
    statusEl.textContent = selected === 'auto' ? t('music.nowAuto', { src: t(`music.src.${cur}`) }) : t('music.now', { src: t(`music.src.${cur}`) });
  }

  // ---- 外部MIDIキーボード ----
  const midi = createMidiInput({
    onNoteOn: (n, v) => { if (!open) return; down.set('midi' + n, n); press(n, v); },
    onNoteOff: (n) => { const m = down.get('midi' + n); if (m === undefined) return; down.delete('midi' + n); release(m); },
    onState: (s, x) => {
      midiStatus.textContent = s === 'ready' ? (x && x.devices && x.devices.length ? t('music.midiReady', { names: x.devices.join(', ') }) : t('music.midiNone'))
        : s === 'denied' ? t('music.midiDenied') : s === 'unsupported' ? t('music.midiUnsupported') : '';
    },
  });
  midiBtn.addEventListener('click', () => midi.connect());

  // ---- PCキーボード(開いている間、鍵盤のキーを先に受け取る) ----
  function onKeyDown(e) {
    if (!open || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) close(); return; }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) shiftOctave(e.code === 'ArrowLeft' ? -1 : 1); return; }
    if (!isNoteKey(e.code)) return;
    e.preventDefault(); e.stopImmediatePropagation(); // E・B・F・Q などの、ほかの操作へは渡さない
    if (e.repeat || down.has('key' + e.code)) return;
    const m = keyToMidi(e.code, octave); if (m === null) return;
    down.set('key' + e.code, m); press(m, 0.8);
  }
  function onKeyUp(e) {
    const k = 'key' + e.code, m = down.get(k);
    if (m === undefined) return;
    e.stopImmediatePropagation(); down.delete(k); release(m);
  }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  function shiftOctave(d) {
    const next = Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, octave + d)); if (next === octave) return;
    for (const m of down.values()) release(m); down.clear(); // 弾いている途中の音は、止める
    octave = next; buildKeys();
  }
  $('#musicOctDown').addEventListener('click', () => shiftOctave(-1));
  $('#musicOctUp').addEventListener('click', () => shiftOctave(1));
  $('#musicCloseX').addEventListener('click', () => close());

  function openPanel() {
    if (open || !canOpen()) return false;
    open = true; root.classList.add('open'); root.setAttribute('aria-hidden', 'false');
    buildSources(); buildKeys(); syncStatus();
    timer = setInterval(syncStatus, 300); // 歩き回って、近くの自然物が変わった時・電池の残りの表示
    onOpenChange(true); return true;
  }
  function close() {
    if (!open) return;
    open = false; root.classList.remove('open'); root.setAttribute('aria-hidden', 'true');
    for (const m of down.values()) instrument.noteOff(m); down.clear(); instrument.allOff();
    clearInterval(timer); timer = null; onOpenChange(false);
  }
  return {
    open: openPanel, close, toggle() { return open ? (close(), false) : openPanel(); }, isOpen: () => open,
    getSource: currentSource, rebuild() { if (open) { buildSources(); buildKeys(); syncStatus(); } }, // 言語を切り替えた時
    dispose() { close(); window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true); midi.dispose(); },
  };
}
