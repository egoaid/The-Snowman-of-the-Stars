// listener-rel.js (v1.102) — 音源の位置を、聞き手(カメラ)から見た相対位置に直す。
//   音源は、世界の座標に固定されている。ここで、カメラの位置と向きを使って、聞き手から見た位置に直す。
//   これまでは、カメラの左右の向き(yaw)だけを使っていたので、カメラが上や下を向く・見下ろす(俯瞰)と、
//   映像上の方向と、音の方向が食い違った。いまは、カメラの向きすべて(上下の傾きも)を使う。
//   座標の向き: x=右 / y=上 / z=手前(聞き手の前は -z)。Web Audio のリスナーの初期の向きと、同じ。
import * as THREE from 'three';

const _inv = new THREE.Quaternion(), _d = new THREE.Vector3();
/** 世界の位置の差(dx,dy,dz)を、カメラの向き q から見た位置に直す。 */
export function toListenerSpace(dx, dy, dz, q) {
  _inv.copy(q).invert(); _d.set(dx, dy, dz).applyQuaternion(_inv);
  return { x: _d.x, y: _d.y, z: _d.z };
}
/** camera をもとに、(x,y,z)[世界] → 聞き手から見た {x,y,z} に直す関数を作る。 */
export function createListenerRelative(camera) {
  const q = new THREE.Quaternion(), p = new THREE.Vector3();
  return (x, y, z) => { camera.getWorldQuaternion(q); camera.getWorldPosition(p); return toListenerSpace(x - p.x, y - p.y, z - p.z, q); };
}
