// midi-input.js (v1.97) — 外部のMIDIキーボードを受け取る(Web MIDI)。接続の許可は、ボタンを押した時だけ求める。
//   MIDI入力は、演奏を受け取るためのもの。ゲーム側に、一般的なMIDI音源を足すものではない。
import { parseMidiMessage } from './notes.js';

export function createMidiInput({ onNoteOn = () => {}, onNoteOff = () => {}, onState = () => {}, nav = (typeof navigator !== 'undefined' ? navigator : null) } = {}) {
  let access = null, state = 'idle'; // idle | unsupported | denied | ready
  const held = new Set();
  const setState = (s, extra) => { state = s; onState(s, extra); };
  function bind() {
    for (const input of access.inputs.values()) input.onmidimessage = handle;
    const names = [...access.inputs.values()].map((i) => i.name || 'MIDI');
    setState('ready', { devices: names });
  }
  function handle(ev) {
    const m = parseMidiMessage(ev.data);
    if (m.type === 'on') { held.add(m.note); onNoteOn(m.note, m.velocity); }
    else if (m.type === 'off') { held.delete(m.note); onNoteOff(m.note); }
  }
  return {
    /** 許可を求めて、接続する(ボタンを押した時に呼ぶ)。 */
    async connect() {
      if (!nav || typeof nav.requestMIDIAccess !== 'function') { setState('unsupported'); return false; }
      try { access = await nav.requestMIDIAccess({ sysex: false }); } catch (e) { setState('denied'); return false; }
      access.onstatechange = bind; // 抜き差しにも追従
      bind();
      return true;
    },
    heldNotes: () => [...held],
    getState: () => state,
    dispose() { if (access) { for (const i of access.inputs.values()) i.onmidimessage = null; access.onstatechange = null; } held.clear(); },
  };
}
