// glue-math.js (v1.71)
// 接着の位置と角度を、数値で決めるための計算(画面にも物理にも触れない純粋な計算)。Nodeで検証できる。
//
// 考え方: 「相手の丸太(target)の軸上の1点 P」を決め、そこに「自分の丸太(mover)の軸上の1点」を、
//   接する向き n へ、半径ぶん離して置く。向きは 3 つの角度で決める。
//     tb    相手の軸上の位置(0=根元側の端 〜 1=先端側の端)
//     ta    自分の軸上の位置(0=根元 〜 1=先端。0.5=中央)
//     roll  相手のまわりのどこで接するか(度。0=真上、90=横…)。n = 相手の軸に垂直な方向
//     psi   2本の軸の交差角(度。相手の軸=0。±90=直角に交わる。nから見た、面内の向き)
//     theta 起こし角(度。0=接する面に寝かせる、90=面に垂直に立てる)
//     gap   接する面どうしのすき間(m。負=少しめり込ませて、くっついて見えるようにする)
//   フレーム: u = 相手の軸(根元→先端)、n = 接する向き、w = u × n。
//   自分の軸の向き d(フレーム内) = (cosθ·cosψ, sinθ, cosθ·sinψ)。
import * as THREE from 'three';

/** 2本の線分(3D)の、最短距離とその点のパラメータ(s: p1→q1、t: p2→q2 の 0〜1)。(Ericsonの方法) */
export function segmentClosest(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const dot = (u, v) => u.x * v.x + u.y * v.y + u.z * v.z;
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) { s = t = 0; }
  else if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return { dist: Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z), s, t };
}

const D2R = Math.PI / 180;
const radiusOf = (rec) => (rec.radiusTop + rec.radiusBottom) / 2;
const quatOf = (rec) => new THREE.Quaternion(rec.quaternion.x, rec.quaternion.y, rec.quaternion.z, rec.quaternion.w);

/** 丸太の軸の両端(根元=a、先端=b)と、根元→先端の単位ベクトル。 */
export function endsOf(rec) {
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(quatOf(rec));
  const c = new THREE.Vector3(rec.position.x, rec.position.y, rec.position.z), h = rec.length / 2;
  return { a: c.clone().addScaledVector(u, -h), b: c.clone().addScaledVector(u, h), u };
}

/** roll=0 の時の接する向き: 世界の真上を、軸に垂直な成分だけにしたもの(軸がほぼ垂直なら、世界のXを使う)。 */
export function baseNormal(u) {
  const n0 = new THREE.Vector3(0, 1, 0).addScaledVector(u, -u.y);
  if (n0.lengthSq() < 1e-6) n0.set(1, 0, 0).addScaledVector(u, -u.x);
  return n0.normalize();
}

/** 相手の丸太の、軸上の位置 tb と、まわり込み roll(度)から、フレームを作る。 */
export function frameOf(targetRec, tb, rollDeg) {
  const { a, b, u } = endsOf(targetRec);
  const P = a.clone().lerp(b, tb);
  const n0 = baseNormal(u);
  const n = n0.clone().applyAxisAngle(u, rollDeg * D2R).normalize();
  const w = new THREE.Vector3().crossVectors(u, n);
  return { P, u, n, w, n0 };
}

/** 自分の丸太の向き d(ワールド)。 */
export function moverDirection(frame, psiDeg, thetaDeg) {
  const th = thetaDeg * D2R, ps = psiDeg * D2R;
  const fx = Math.cos(th) * Math.cos(ps), fy = Math.sin(th), fz = Math.cos(th) * Math.sin(ps);
  return new THREE.Vector3().addScaledVector(frame.u, fx).addScaledVector(frame.n, fy).addScaledVector(frame.w, fz).normalize();
}

/** 面に垂直な向きに近いほど、自分の半径は効かない(端面が接する)。n方向の成分で決める。 */
export function contactOffset(targetR, moverR, dirDotN, gap) {
  return targetR + moverR * Math.sqrt(Math.max(0, 1 - dirDotN * dirDotN)) + gap;
}

/**
 * 自分の丸太の姿勢(中心の位置と向き)を求める。
 * @param {object} frame      frameOf の戻り値
 * @param {{ta:number,psi:number,theta:number,gap:number}} p
 * @param {{length:number, radius:number}} mover
 * @param {number} targetR    相手の半径
 */
export function moverPose(frame, p, mover, targetR) {
  const d = moverDirection(frame, p.psi, p.theta);
  const off = contactOffset(targetR, mover.radius, d.dot(frame.n), p.gap);
  const anchor = frame.P.clone().addScaledVector(frame.n, off);
  const pos = anchor.clone().addScaledVector(d, (0.5 - p.ta) * mover.length); // anchor = 中心 + d·(ta-0.5)·L
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  return { pos, quat, dir: d, anchor };
}

const signedAngle = (axis, v0, v1) => {
  const c = new THREE.Vector3().crossVectors(v0, v1);
  return Math.atan2(c.dot(axis), v0.dot(v1));
};

/**
 * いまの2本の姿勢から、接着の角度・位置を逆算する(再編集で、いまの状態から調整を始めるため)。
 * moverPose(frameOf(target, tb, roll), params, …) が、いまの姿勢を再現する(gapで差を吸収する)。
 */
export function inferParams(targetRec, moverRec) {
  const T = endsOf(targetRec), M = endsOf(moverRec);
  const cl = segmentClosest(M.a, M.b, T.a, T.b);
  const tb = cl.t, ta = cl.s;
  const P = T.a.clone().lerp(T.b, tb), Q = M.a.clone().lerp(M.b, ta);
  const v = Q.clone().sub(P);
  v.addScaledVector(T.u, -v.dot(T.u)); // 相手の軸に垂直な成分
  const n0 = baseNormal(T.u);
  let n;
  if (v.lengthSq() > 1e-10) n = v.clone().normalize(); else n = n0.clone();
  const roll = signedAngle(T.u, n0, n) / D2R;
  const w = new THREE.Vector3().crossVectors(T.u, n);
  const d = M.u;
  const fx = d.dot(T.u), fy = d.dot(n), fz = d.dot(w);
  const theta = Math.asin(Math.max(-1, Math.min(1, fy))) / D2R;
  const psi = Math.atan2(fz, fx) / D2R;
  const dist = v.length();
  const gap = dist - (radiusOf(targetRec) + radiusOf(moverRec) * Math.sqrt(Math.max(0, 1 - fy * fy)));
  return { tb, ta, roll, psi, theta, gap };
}

export const GLUE_DEFAULTS = { tb: 0.5, ta: 0.5, roll: 0, psi: 90, theta: 0, gap: -0.02 };
export const GLUE_LIMITS = { tb: [0, 1], ta: [0, 1], roll: [-180, 180], psi: [-180, 180], theta: [-90, 90], gap: [-0.1, 0.3] };
export function clampParam(name, v) { const [lo, hi] = GLUE_LIMITS[name]; return Math.max(lo, Math.min(hi, v)); }
export const radiusOfRec = radiusOf;
