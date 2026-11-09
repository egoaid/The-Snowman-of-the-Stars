// midi-keyboard.js (v1.99) — 世界に置かれている、MIDIキーボード(内蔵音源なし)の3Dモデル。
//   デザイン: 37鍵(22白鍵+15黒鍵)の小さなキーボード。スケルトン(透けた)ブルーの本体、左側にクリーム色の2つのホイール、
//   紫の丸いボタン、オクターブのボタンと赤いLED、奥にパネルの印刷、背面にMIDI端子。(固有名詞は、どこにも使わない)
//   ・setGlow(0〜1): 電池が入っていると、本体が全体的に光る。なくなると光らない。少ない時は、tick() が点滅させる。
//   ・setKeyDown(midi, down): 鍵盤が沈む。setBase(midi): 左端の鍵盤の音(C)。
//   ・cableAnchor: MIDIケーブルをつなぐ背面の端子の位置。
import * as THREE from 'three';
import { glowLevel } from '../music/battery.js';

export const KB = { keys: 37, whites: 22, length: 0.66, depth: 0.2, height: 0.034 };
const BLACK_SEMITONES = [1, 3, 6, 8, 10];

function panelTexture() { // 奥のパネルの、薄い印刷(文字は入れない。細い線と目盛りだけ)
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 96); g.strokeStyle = 'rgba(235,250,255,0.55)'; g.lineWidth = 1.5;
  for (let r = 0; r < 4; r++) { g.beginPath(); g.moveTo(150, 14 + r * 11); g.lineTo(150 + 150 + (r % 2) * 40, 14 + r * 11); g.stroke(); }
  g.fillStyle = 'rgba(235,250,255,0.5)';
  for (let i = 0; i < 26; i++) g.fillRect(40 + i * 17, 70, 8, 2);
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(380, 14 + i * 9); g.lineTo(380 + 90 - (i % 3) * 18, 14 + i * 9); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 2; return t;
}

export function createMidiKeyboard() {
  const group = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x1f9fb8, transparent: true, opacity: 0.8, roughness: 0.28, metalness: 0.08, emissive: 0x3feaff, emissiveIntensity: 0 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5, emissive: 0x7fefff, emissiveIntensity: 0 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.35, emissive: 0x2a8fa0, emissiveIntensity: 0 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xe6dfc9, roughness: 0.7 });
  const purpleMat = new THREE.MeshStandardMaterial({ color: 0xb8a5ee, roughness: 0.5, emissive: 0x8f7be0, emissiveIntensity: 0 });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x4a1010 });
  const portMat = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.6 });
  const L = KB.length, D = KB.depth, H = KB.height;

  // 本体: 下の板・左のホイール台・奥のパネルの帯
  const plate = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), shellMat); plate.position.y = H / 2; group.add(plate);
  const leftBlock = new THREE.Mesh(new THREE.BoxGeometry(0.115, H + 0.014, D), shellMat); leftBlock.position.set(-L / 2 + 0.0575, (H + 0.014) / 2, 0); group.add(leftBlock);
  const back = new THREE.Mesh(new THREE.BoxGeometry(L - 0.115, H + 0.026, 0.07), shellMat); back.position.set(0.0575, (H + 0.026) / 2, -D / 2 + 0.035); group.add(back);
  const pt = panelTexture();
  if (pt) { const pan = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.14, 0.05), new THREE.MeshBasicMaterial({ map: pt, transparent: true, depthWrite: false })); pan.rotation.x = -Math.PI / 2; pan.position.set(0.0575, H + 0.0275, -D / 2 + 0.035); group.add(pan); }
  const halo = new THREE.Mesh(new THREE.BoxGeometry(L * 1.06, H + 0.05, D * 1.1), new THREE.MeshBasicMaterial({ color: 0x4cecff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.position.y = (H + 0.02) / 2; halo.raycast = () => {}; group.add(halo); // 光の殻は、クリックの邪魔をしない

  // 左: ホイール2つ(ピッチ/アサイン)・紫のボタン・オクターブのボタンとLED
  for (let i = 0; i < 2; i++) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.026, 14), creamMat); w.material.flatShading = true;
    w.rotation.z = Math.PI / 2; w.position.set(-L / 2 + 0.05, H + 0.02, -D / 2 + 0.045 + i * 0.045); group.add(w);
  }
  const shiftBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 16), purpleMat); shiftBtn.position.set(-L / 2 + 0.05, H + 0.011, 0.012); group.add(shiftBtn);
  const leds = [];
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.008, 0.014), creamMat); b.position.set(-L / 2 + 0.032 + i * 0.03, H + 0.011, 0.07); group.add(b);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), ledMat.clone()); led.position.set(-L / 2 + 0.032 + i * 0.03, H + 0.009, 0.048); group.add(led); leds.push(led);
  }

  // 鍵盤: 37鍵。奥の縁を支点に、手前が沈む。
  const x0 = -L / 2 + 0.125, kw = (L - 0.125 - 0.012) / KB.whites, keyZ0 = -D / 2 + 0.07 + 0.002, keyLen = D - 0.07 - 0.012;
  const keys = []; let wi = 0;
  for (let i = 0; i < KB.keys; i++) {
    const black = BLACK_SEMITONES.includes(i % 12);
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(black ? kw * 0.6 : kw * 0.94, black ? 0.014 : 0.012, black ? keyLen * 0.62 : keyLen), black ? blackMat : whiteMat);
    mesh.position.z = (black ? keyLen * 0.31 : keyLen / 2); pivot.add(mesh); mesh.userData.keyIndex = i; // クリックで押せる鍵盤の番号
    const cx = black ? x0 + wi * kw - kw * 0.02 : x0 + wi * kw + kw / 2; if (!black) wi++;
    pivot.position.set(cx, H + (black ? 0.016 : 0.007), keyZ0);
    group.add(pivot); keys.push({ pivot, black, down: false });
  }
  const cableAnchor = new THREE.Object3D(); cableAnchor.position.set(L / 2 - 0.15, H * 0.6, -D / 2 - 0.006); group.add(cableAnchor);
  for (let i = 0; i < 2; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.012, 10), portMat); p.rotation.x = Math.PI / 2; p.position.set(L / 2 - 0.15 + (i - 0.5) * 0.04, H * 0.6, -D / 2 - 0.004); group.add(p); }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  let base = 48, glow = 0;
  const api = {
    group, cableAnchor, leds,
    /** 左端の鍵盤の音(MIDIノート番号)。画面の鍵盤と同じ範囲(C〜C 37鍵)。 */
    setBase(m) { base = m; },
    setKeyDown(midi, down) { const k = keys[midi - base]; if (!k || k.down === down) return; k.down = down; k.pivot.rotation.x = down ? 0.07 : 0; },
    releaseAll() { for (const k of keys) { k.down = false; k.pivot.rotation.x = 0; } },
    /** 本体の光(0〜1)。全体が、青く光る。 */
    setGlow(level) {
      glow = level; shellMat.emissiveIntensity = 0.95 * level; whiteMat.emissiveIntensity = 0.16 * level; blackMat.emissiveIntensity = 0.5 * level;
      purpleMat.emissiveIntensity = 0.8 * level; halo.material.opacity = 0.2 * level; halo.visible = level > 0.01;
      for (const led of leds) led.material.color.setHex(level > 0.01 ? 0xff3b30 : 0x4a1010);
    },
    /** 電池の状態('none' 'ok' 'low' 'dead')と時刻で、光らせる(少ない時は点滅)。 */
    tick(state, time) { api.setGlow(glowLevel(state, time)); },
    getGlow: () => glow,
    /**
     * レイ(視線やマウス)が当たったものを調べる。鍵盤なら { key: MIDIノート番号, distance }、本体(鍵盤以外)なら { key: null, distance }、外れなら null。
     * 本体を押した時は、鍵盤を鳴らさず、長押しで拾えるようにする(scene3d.js)。
     */
    pick(raycaster) {
      const hits = raycaster.intersectObject(group, true);
      for (const h of hits) {
        let o = h.object; while (o && o !== group && o.userData.keyIndex === undefined) o = o.parent;
        return o && o.userData.keyIndex !== undefined ? { key: base + o.userData.keyIndex, distance: h.distance } : { key: null, distance: h.distance };
      }
      return null;
    },
  };
  api.setGlow(0);
  return api;
}
