// lantern.js (v1.56)
// ジャック・オー・ランタンの見た目と、その光の出し方。
//   ・createJackOLanternMesh: 手に持つ・地面に置く・落ちている・雪だるまの頭になる、の全てで同じ見た目を使う。
//     顔(目・鼻・口)は光る(MeshBasicMaterial。ライトが無くても光って見える)。
//   ・createLanternLightPool: PointLightは最大 n 個(3つ)だけ。光らせたい物が多いときは、カメラに近い順に割り当てる。
//     ライトの数を固定にして、描画の負荷(シェーダーの再コンパイル)を増やさない。
import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

// 中がくり抜かれて、光源が入っているかぼちゃ: 皮そのものがオレンジに光り(emissive)、くり抜いた顔は明るい黄色、
// まわりにやわらかい光の玉(加算合成のスプライト)が広がって、頭全体が光り輝いて見える。
const SKIN = new THREE.MeshToonMaterial({ vertexColors: true, color: 0xe8801c, emissive: 0xff7a12, emissiveIntensity: 0.5, gradientMap: getToonGradientMap() });
const STEM = new THREE.MeshToonMaterial({ color: 0x5a7430, emissive: 0x1c2a0a, emissiveIntensity: 0.4, gradientMap: getToonGradientMap() });
const GLOW = new THREE.MeshBasicMaterial({ color: 0xfff0a8, fog: false, side: THREE.DoubleSide }); // くり抜いた顔(中の光が見える)
const INNER = new THREE.MeshBasicMaterial({ color: 0xffc23c, fog: false, side: THREE.DoubleSide });  // くり抜きの縁の内側

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture || typeof document === 'undefined') return glowTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,214,120,0.95)'); grad.addColorStop(0.35, 'rgba(255,160,50,0.45)'); grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

/**
 * 縦のすじ(畝)が入った、平たいかぼちゃ形の体。
 * v1.56-H4: 条溝(縦の深い溝)を深く。以前は半径の±7.5%のなだらかな波で、溝が浅かった。
 *   今は、畝(ふくらみ)は広くて丸く、溝は狭くて深い(谷が鋭い)形にする。
 *   溝の底は畝の頂上より半径の約24%低く、頂点(上と下のへそ)に向かって浅くなりながら1点に集まる。
 *   畝の頂上は従来と同じ高さ(半径の1.075倍)なので、顔のパーツの置き方(placeOnSurface)は変わらない。
 *   溝が細かく見えるよう、周方向の分割を増やしている(1つの畝に約8分割)。
 */
export const PUMPKIN_LOBES = 8;
export const PUMPKIN_GROOVE_DEPTH = 0.24;
/** 方位角phiでの、半径の倍率(畝の頂上=1.075、溝の底=1.075-深さ)。縦位置yRatio(=|y|/半径)で溝は浅くなる。 */
export function pumpkinRadialScale(phi, yRatio, lobes = PUMPKIN_LOBES, depth = PUMPKIN_GROOVE_DEPTH) {
  const t = 0.5 + 0.5 * Math.cos(phi * lobes);          // 1=畝の頂上, 0=溝の底
  const groove = Math.pow(1 - t, 2.4);                  // 谷だけが鋭く落ち込む(広い畝・狭い溝)
  const fade = 1 - 0.55 * Math.pow(Math.min(1, yRatio), 2); // へそ(上下の端)では溝を浅く
  return 1.075 - depth * groove * fade;
}
function pumpkinBodyGeometry(radius, lobes = PUMPKIN_LOBES) {
  const geo = new THREE.SphereGeometry(radius, lobes * 8, 28);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const phi = Math.atan2(z, x);
    const k = pumpkinRadialScale(phi, Math.abs(y) / radius, lobes);
    const squash = 0.86;                                   // 平たく
    const pinch = 1 - 0.18 * Math.pow(Math.abs(y) / radius, 6); // 上と下のへこみ
    pos.setXYZ(i, x * k * pinch, y * squash, z * k * pinch);
    // 溝の底ほど暗く(光の当たり方に関わらず、溝の深さが見えるように)。畝の頂上は元の色のまま
    const depthT = (1.075 - k) / PUMPKIN_GROOVE_DEPTH; // 0=畝の頂上, 1=溝の底
    const v = 1 - 0.58 * Math.pow(Math.max(0, Math.min(1, depthT)), 0.7); // 谷の周りまで、やや広く暗くする
    cols[i * 3] = v; cols[i * 3 + 1] = v * 0.97; cols[i * 3 + 2] = v * 0.92;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

/** 楕円体の表面に置く: 顔のパーツを、かぼちゃの曲面に沿って外向きに置く。 */
function placeOnSurface(mesh, radius, nx, ny, lift = 0.02) {
  const R = radius * 1.0, Ry = radius * 0.86;
  const x = nx * R, y = ny * Ry;
  const z = Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny)) * R * 1.0 * (1 + 0.075) * 0.99 + lift * radius;
  mesh.position.set(x, y, z);
  const n = new THREE.Vector3(x / (R * R), y / (Ry * Ry), z / (R * R)).normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
}

/** 三角形を、最長の辺が maxEdge 以下になるまで、4つに分けて細かくする(非インデックスの位置配列を返す)。 */
function subdividePositions(geo, maxEdge) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  let tris = [];
  const a = g.attributes.position.array;
  for (let i = 0; i < a.length; i += 9) tris.push([a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7], a[i + 8]]);
  const d = (t, i, j) => Math.hypot(t[i * 3] - t[j * 3], t[i * 3 + 1] - t[j * 3 + 1]);
  for (let pass = 0; pass < 6; pass++) {
    const next = []; let split = false;
    for (const t of tris) {
      if (Math.max(d(t, 0, 1), d(t, 1, 2), d(t, 2, 0)) <= maxEdge) { next.push(t); continue; }
      split = true;
      const m = (i, j) => [(t[i * 3] + t[j * 3]) / 2, (t[i * 3 + 1] + t[j * 3 + 1]) / 2, (t[i * 3 + 2] + t[j * 3 + 2]) / 2];
      const m01 = m(0, 1), m12 = m(1, 2), m20 = m(2, 0);
      const A = [t[0], t[1], t[2]], B = [t[3], t[4], t[5]], C = [t[6], t[7], t[8]];
      next.push([...A, ...m01, ...m20], [...m01, ...B, ...m12], [...m20, ...m12, ...C], [...m01, ...m12, ...m20]);
    }
    tris = next; if (!split) break;
  }
  const out = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => out.set(t, i * 9));
  return out;
}

/**
 * 顔のくり抜きの図形(平面、原点が中心)を、かぼちゃの表面に貼り付けた形状にする。
 * (nx, ny)=顔の中心の位置(球の正面に投影した座標)、rotZ=図形の回転、sc=拡大、liftR=表面から浮かす量(半径に対する割合)。
 * かぼちゃの表面(溝つき)の式は pumpkinRadialScale と同じ。表面の少し外側へ浮かせて、めり込まないようにする。
 */
function conformToPumpkin(shapeGeo, radius, nx, ny, rotZ, sc, liftR) {
  const R = radius, Ry = radius * 0.86;
  const arr = subdividePositions(shapeGeo, radius * 0.045);
  const cs = Math.cos(rotZ), sn = Math.sin(rotZ);
  const out = new Float32Array(arr.length);
  const n = new THREE.Vector3();
  for (let i = 0; i < arr.length; i += 3) {
    const u = arr[i] * sc, v = arr[i + 1] * sc;
    const X = nx * R + (u * cs - v * sn), Y = ny * Ry + (u * sn + v * cs);
    let sx = X / R, sy = Y / Ry;
    const sz = Math.sqrt(Math.max(0.02, 1 - sx * sx - sy * sy));
    const len = Math.hypot(sx, sy, sz); sx /= len; sy /= len; const sz2 = sz / len;
    const k = pumpkinRadialScale(Math.atan2(sz2, sx), Math.abs(sy));
    const pinch = 1 - 0.18 * Math.pow(Math.abs(sy), 6);
    const px = sx * k * pinch * R, py = sy * Ry, pz = sz2 * k * pinch * R;
    n.set(px / (R * R), py / (Ry * Ry), pz / (R * R)).normalize();
    out[i] = px + n.x * liftR * R; out[i + 1] = py + n.y * liftR * R; out[i + 2] = pz + n.z * liftR * R;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return geo;
}

/**
 * 半径 radius(m)のジャック・オー・ランタン。原点は中心。顔は+z向き。
 * 三角の目と鼻、ぎざぎざの口(笑っている)、頭頂部のヘタ。顔は全部くり抜かれていて、中の光が漏れる。
 */
export function createJackOLanternMesh(radius = 0.16) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(pumpkinBodyGeometry(radius), SKIN);
  body.castShadow = true;
  g.add(body);
  // ヘタ(頭頂部): 太めの柄が、少し曲がって立つ。まわりに小さなへこみ
  const stem = new THREE.Group();
  const s1 = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.13, radius * 0.2, radius * 0.34, 7), STEM);
  s1.position.y = radius * 0.17; stem.add(s1);
  const s2 = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.09, radius * 0.13, radius * 0.26, 7), STEM);
  s2.position.set(radius * 0.05, radius * 0.4, 0); s2.rotation.z = -0.35; stem.add(s2);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.1, radius * 0.1, 6), STEM);
  cap.position.set(radius * 0.13, radius * 0.55, 0); cap.rotation.z = -0.7; stem.add(cap);
  stem.position.y = radius * 0.78;
  g.add(stem);

  // くり抜いた顔(明るい黄色)。縁の内側に、少しだけ濃い色を重ねて、厚みのある穴に見せる
  const tri = (w, h, up = true) => { const sh = new THREE.Shape(); const s = up ? 1 : -1; sh.moveTo(0, s * h / 2); sh.lineTo(-w / 2, -s * h / 2); sh.lineTo(w / 2, -s * h / 2); sh.closePath(); return sh; };
  // v1.56-H4: くり抜きの顔は、深くなった溝に沿って、かぼちゃの曲面に貼り付ける(平らな板のままだと、溝の上に浮いてしまう)。
  //   図形を細かく分割してから、各頂点を「かぼちゃの表面」へ写す(溝の谷では谷の底へ、畝の上では畝の上へ)。
  const addCut = (shape, nx, ny, rotZ = 0, scale = 1, lift = 0.02) => {
    const mk = (sc, liftR, mat) => {
      const geo = conformToPumpkin(new THREE.ShapeGeometry(shape), radius, nx, ny, rotZ, sc, liftR);
      return new THREE.Mesh(geo, mat);
    };
    g.add(mk(1.22 * scale, lift * 0.35, INNER)); // 縁の内側(少し大きく、少し沈める)
    g.add(mk(scale, lift, GLOW));                // くり抜いた穴(中の光)
  };
  const eyeW = radius * 0.34, eyeH = radius * 0.34;
  addCut(tri(eyeW, eyeH, true), -0.34, 0.26, 0.1);   // 三角の目(上向きの三角。少し内側に傾ける)
  addCut(tri(eyeW, eyeH, true), 0.34, 0.26, -0.1);
  addCut(tri(radius * 0.17, radius * 0.16, false), 0, 0.02, 0); // 三角の鼻(下向き)
  // ぎざぎざの口(笑っている): 上辺がぎざぎざで、下辺が下に丸い三日月
  const m = new THREE.Shape(); const W = radius * 0.4, T = radius * 0.12; const teeth = 6;
  m.moveTo(-W, 0);
  for (let i = 0; i <= teeth; i++) { const x = -W + (2 * W * i) / teeth; m.lineTo(x, i % 2 === 0 ? 0 : -T * 0.55); } // 上のぎざぎざ
  m.quadraticCurveTo(W * 0.75, -T * 2.4, 0, -T * 2.6);
  m.quadraticCurveTo(-W * 0.75, -T * 2.4, -W, 0);
  addCut(m, 0, -0.2, 0, 1, 0.05); // 口は大きいので、曲面から浮かせて、体に埋もれないように
  // 中の光源: 頭全体が光り輝く(加算合成のやわらかい光の玉)
  const tex = getGlowTexture();
  if (tex) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffb04a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(radius * 5.2); g.add(glow);
  }
  g.userData.glow = true;
  return g;
}

/**
 * 光らせたい物の一覧から、カメラに近い順に最大 n 個へ PointLight を割り当てる。
 * emitters: [{ x, y, z, intensity, distance, color? }]
 */
export function createLanternLightPool(scene, n = 3) {
  const lights = [];
  for (let i = 0; i < n; i++) {
    const l = new THREE.PointLight(0xffa640, 0, 14, 2);
    l.position.set(0, -100, 0);
    scene.add(l); lights.push(l);
  }
  const order = [];
  return {
    lights,
    update(emitters, camX, camY, camZ, t = 0) {
      order.length = 0;
      for (const e of emitters) order.push({ e, d: Math.hypot(e.x - camX, e.y - camY, e.z - camZ) });
      order.sort((a, b) => a.d - b.d);
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i], o = order[i];
        if (!o) { l.intensity = 0; continue; }
        const flick = 1 + 0.07 * Math.sin(t * 7 + i * 2.1) + 0.04 * Math.sin(t * 13.3 + i);
        l.position.set(o.e.x, o.e.y, o.e.z);
        l.intensity = o.e.intensity * flick; l.distance = o.e.distance;
        if (o.e.color) l.color.setHex(o.e.color);
      }
    },
    count: () => lights.filter((l) => l.intensity > 0).length,
    dispose() { for (const l of lights) { scene.remove(l); l.dispose(); } },
  };
}
