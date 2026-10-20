// moon-stone.js (v1.69)
// 月の石・月のかけらの形: 三日月。軽い押し出し形状1つ(頂点は数十個)。
//
// 三日月 = 外側の円(半径R、中心は原点) から、内側の円(半径r、中心は (d, 0)) を引いた形。
// 開いている側が +x を向く。厚みは R の 0.28 倍。向きは、使う側で回す。

import * as THREE from 'three';

/**
 * @param {number} radius 外側の円の半径(m)
 * @returns {THREE.ExtrudeGeometry} 中心が原点の三日月(xy平面、z方向に厚み)
 */
export function createCrescentGeometry(radius = 0.2) {
  const R = radius, r = radius * 0.80, d = radius * 0.46;
  // 2つの円の交点
  const x = (d * d + R * R - r * r) / (2 * d);
  const y = Math.sqrt(Math.max(0, R * R - x * x));
  const outerA = Math.atan2(y, x);                // 外側の円の、上の交点の角度
  const innerA = Math.atan2(y, x - d);            // 内側の円の、上の交点の角度(中心(d,0)から見て)
  const shape = new THREE.Shape();
  shape.moveTo(x, y);
  shape.absarc(0, 0, R, outerA, Math.PI * 2 - outerA, false);        // 外側: 上の交点 → 左側を回って → 下の交点
  shape.absarc(d, 0, r, -innerA, innerA, true);                       // 内側: 下の交点 → 左側を回って → 上の交点(時計回り)
  shape.closePath();
  const depth = R * 0.28;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: depth * 0.18, bevelSize: R * 0.035, bevelSegments: 1, curveSegments: 14,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

/** 三日月のおおよその幅(+x方向の、外側の円の左端から、先端までの広がり)。当たり判定の目安に使う。 */
export const crescentWidth = (radius) => radius * 1.0 + radius * 0.2;
