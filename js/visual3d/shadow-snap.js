// shadow-snap.js
// 太陽の影の範囲(shadow.camera)の中心を、影マップの「1マス(テクセル)」単位に
// 揃える(スナップする)計算。2026-09(v1.28): 新規追加。
//
// 【不具合】「雪だるまの表面に変な影のムラが出ることがある」
// 影の範囲は、毎フレーム「カメラの足元」へ追従させていた。その位置は連続値の
// ままだったので、カメラが動くたびに、影マップの1マス(約4.9cm = 50m/1024)の
// 格子が世界に対して少しずつずれた。すると、丸い雪だるまの表面のように、
// 光と影の境目が微妙な場所では、どのマスの深度と比べるかが毎フレーム変わり、
// まだら模様が這うようにちらついて見える(shadow swimming)。
//
// 【対策】 影の範囲の中心を、光から見た平面(光の座標系のx,y)で、1マスの
// 整数倍に丸める。視点が動いても、世界の点は常に同じマスの位相に乗るので、
// 影のちらつきが起きない。奥行き方向(z)は丸めない(必要が無い)。丸めによる
// 中心のずれは最大でも1マス弱(約5cm)なので、影の範囲は実質同じ。
import * as THREE from 'three';

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Vector3} center 影の範囲の中心(ワールド座標)
 * @param {THREE.Vector3} lightDir 「中心から光源へ向かう」単位ベクトル
 * @param {number} extent 影の範囲の一辺の長さ(shadow.camera の right-left。m)
 * @param {number} mapSize 影マップの解像度(px)
 * @param {THREE.Vector3} [out]
 * @returns {THREE.Vector3} スナップ済みの中心
 */
export function snapShadowCenter(center, lightDir, extent, mapSize, out = new THREE.Vector3()) {
  // THREEのlookAt(光源→中心、up=(0,1,0))で作られる影カメラの軸と同じ:
  //   z = 光源方向(=lightDir), x = normalize(cross(up, z)), y = cross(z, x)
  _x.crossVectors(_up, lightDir);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0); // 真上/真下の光(ほぼ起きない)の退避
  _x.normalize();
  _y.crossVectors(lightDir, _x).normalize();
  const texel = extent / mapSize;
  const cx = center.dot(_x), cy = center.dot(_y);
  const sx = Math.round(cx / texel) * texel;
  const sy = Math.round(cy / texel) * texel;
  return out.copy(center).addScaledVector(_x, sx - cx).addScaledVector(_y, sy - cy);
}
