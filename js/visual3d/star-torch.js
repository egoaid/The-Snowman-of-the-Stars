// star-torch.js (v1.74)
// 星の松明: 細い棒の先に、星のかけら(光る小さな星)がついた松明。地面に立てて置ける。炎ではなく星の光なので、
// 揺らぎは小さく、ゆっくり瞬く。光の強さ・届く範囲は、焚き火と同じくらい(強さ約3.4・範囲10m)。
//   ・createStarTorchMesh(): 置いた時の見た目(原点=地面。棒+十字に重ねた星+光の玉+ときどき舞い上がる星くず)
//   ・tickStarTorch(mesh, t): 毎フレーム。光の玉がゆっくり脈打ち、星くずが昇る
//   ・createHeldStarTorch(): 右手に持った時の小さな見た目(周りは照らさない)
//   ・STAR_TORCH: 大きさと光の値(光そのものは、ランタンと同じ光の枠(lantern.js)から割り当てる)
import * as THREE from 'three';
import { createStarGeometry } from './snowman.js';

export const STAR_TORCH = {
  height: 1.15,        // 地面から、棒の先(星の中心の少し下)まで(m)
  starRadius: 0.11,    // 先の星の大きさ(m)
  footprint: 0.18,     // 置く時の重なり判定の円の半径(m)。細いので小さい
  intensity: 3.4,      // 焚き火(3.2〜3.4)と同じくらい
  distance: 10,        // 焚き火と同じ範囲(m)
  color: 0xffe6a0,     // 金に近い暖かい白
};

const STICK_MAT = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85, metalness: 0 });
const BAND_MAT = new THREE.MeshStandardMaterial({ color: 0x3d2a18, roughness: 0.9, metalness: 0 });
const STAR_MAT = new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false });

let glowTex = null;
function getGlowTexture() {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,248,214,0.95)'); grad.addColorStop(0.3, 'rgba(255,226,130,0.45)'); grad.addColorStop(1, 'rgba(255,200,90,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const FAR_GLOW_SCALE = 4.2; // 遠い松明の光のにじみの大きさ(m)。地面の近くまで広がって、「このあたりが明るい」と見える

/** その松明が、本物の光(光の枠)をもらえていない時は on=true。見た目だけの大きな光のにじみを出す。 */
export function setStarTorchFar(mesh, on) {
  const ud = mesh && mesh.userData && mesh.userData.starTorch; if (ud) ud.farTarget = on ? 1 : 0;
}

/** 棒+十字に重ねた星(どの向きから見ても星に見える)。 */
function buildBody(height, starRadius) {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, height + 0.05, 7), STICK_MAT);
  stick.position.y = (height - 0.05) / 2; stick.castShadow = true; g.add(stick);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 8), BAND_MAT);
  band.position.y = height - 0.05; g.add(band);
  const starGeo = createStarGeometry(starRadius);
  const stars = [];
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Mesh(starGeo, STAR_MAT);
    s.position.y = height + starRadius * 0.85; s.rotation.y = i * Math.PI / 2; g.add(s); stars.push(s);
  }
  return { g, stars };
}

export function createStarTorchMesh({ glow = true, sparkles = true } = {}) {
  const { g, stars } = buildBody(STAR_TORCH.height, STAR_TORCH.starRadius);
  const topY = STAR_TORCH.height + STAR_TORCH.starRadius * 0.85;
  const ud = { stars, glow: null, far: null, farTarget: 0, sparkles: [], topY, seed: Math.random() * 100 };
  if (glow && getGlowTexture()) {
    const m = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const sp = new THREE.Sprite(m); sp.position.y = topY; sp.scale.setScalar(1.0); g.add(sp); ud.glow = sp;
  }
  if (glow && getGlowTexture()) {
    // v1.75: 光の枠から外れた(遠い)松明に出す、大きなやわらかい光のにじみ。見た目だけ(周りは照らさない)。普段は消えている。
    const m = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffe6a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const sp = new THREE.Sprite(m); sp.position.y = topY - 0.25; sp.scale.setScalar(FAR_GLOW_SCALE); sp.visible = false; g.add(sp); ud.far = sp;
  }
  if (sparkles && getGlowTexture()) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xfff2b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const sp = new THREE.Sprite(m); sp.scale.setScalar(0.07); sp.visible = false; g.add(sp);
      ud.sparkles.push({ sp, phase: i / 3, dx: (i - 1) * 0.06 });
    }
  }
  g.userData.starTorch = ud;
  return g;
}

/** 毎フレーム: 光の玉がゆっくり脈打つ。星くずが、星のあたりから、ふわっと上へ昇って消える。星はごくゆっくり回る。 */
export function tickStarTorch(mesh, t) {
  const ud = mesh && mesh.userData && mesh.userData.starTorch; if (!ud) return;
  const s = t + ud.seed;
  const pulse = 1 + 0.07 * Math.sin(s * 1.7) + 0.035 * Math.sin(s * 3.1 + 1);
  if (ud.glow) { ud.glow.scale.setScalar(1.0 * pulse); ud.glow.material.opacity = 0.72 + 0.13 * Math.sin(s * 1.7 + 0.5); }
  if (ud.far) { // 遠い松明の光のにじみ: ふわっと出て、ふわっと消える。ゆっくり脈打つ
    const cur = ud.far.userData.k || 0, k = cur + (ud.farTarget - cur) * 0.06;
    ud.far.userData.k = k;
    ud.far.visible = k > 0.01;
    ud.far.material.opacity = k * (0.5 + 0.08 * Math.sin(s * 1.3));
    ud.far.scale.setScalar(FAR_GLOW_SCALE * (1 + 0.04 * Math.sin(s * 1.7)));
  }
  for (const p of ud.sparkles) {
    const k = ((s * 0.42 + p.phase) % 1 + 1) % 1; // 0〜1で1周(約2.4秒)
    p.sp.visible = k > 0.02;
    p.sp.position.set(p.dx + Math.sin(s * 2 + p.phase * 6) * 0.04, ud.topY + 0.05 + k * 0.5, Math.cos(s * 1.6 + p.phase * 5) * 0.04);
    p.sp.material.opacity = Math.sin(k * Math.PI) * 0.9;
  }
}

/** 右手に持つ小さな見た目(光の玉・星くずは無し)。 */
export function createHeldStarTorch() {
  const body = createStarTorchMesh({ glow: false, sparkles: false });
  body.scale.setScalar(0.26);
  const holder = new THREE.Group(); holder.add(body); holder.rotation.z = 0.2;
  return holder;
}
