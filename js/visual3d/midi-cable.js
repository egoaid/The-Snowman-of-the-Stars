// midi-cable.js (v1.99) — 演奏している自然物と、キーボードをつなぐ MIDI ケーブル。
//   cablePoints(): 2点の間を、たるませて、地面にもぐらないように通る点列(three.js に依存しない。Nodeで試験できる)。
//   createMidiCable(): その点列を、黒いケーブルと、両端のプラグとして見せる。
import * as THREE from 'three';

/** a→b の、地面にもぐらないケーブルの点列。dist が長いほど、たるむ。 */
export function cablePoints(a, b, groundAt, n = 14) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), sag = Math.min(0.5, 0.06 + dist * 0.05);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
    let y = a.y + (b.y - a.y) * u - Math.sin(u * Math.PI) * sag;
    if (i > 0 && i < n) y = Math.max(y, groundAt(x, z) + 0.025); // 地面の上を、はうように
    pts.push({ x, y, z });
  }
  return pts;
}

export function createMidiCable({ scene, groundAt }) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const mat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55 });
  const plugMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.4, metalness: 0.4 });
  let tube = null, last = null;
  const plugA = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 10), plugMat), plugB = plugA.clone();
  group.add(plugA, plugB);
  const dirTmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function orient(plug, from, to) { dirTmp.set(to.x - from.x, to.y - from.y, to.z - from.z).normalize(); plug.quaternion.setFromUnitVectors(up, dirTmp); plug.position.set(from.x, from.y, from.z).addScaledVector(dirTmp, 0.02); }
  return {
    group,
    /** a=キーボード側、b=自然物側(世界座標)。ほとんど動いていなければ、作り直さない。 */
    set(a, b) {
      group.visible = true;
      if (last && Math.hypot(last.a.x - a.x, last.a.y - a.y, last.a.z - a.z) + Math.hypot(last.b.x - b.x, last.b.y - b.y, last.b.z - b.z) < 0.02) return;
      last = { a: { ...a }, b: { ...b } };
      const pts = cablePoints(a, b, groundAt).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const curve = new THREE.CatmullRomCurve3(pts);
      if (tube) { group.remove(tube); tube.geometry.dispose(); }
      tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.013, 6, false), mat); tube.castShadow = true; group.add(tube);
      orient(plugA, pts[1], pts[0]); plugA.position.copy(pts[0]).addScaledVector(dirTmp.set(pts[1].x - pts[0].x, pts[1].y - pts[0].y, pts[1].z - pts[0].z).normalize(), 0.018);
      orient(plugB, pts[pts.length - 2], pts[pts.length - 1]); plugB.position.copy(pts[pts.length - 1]).addScaledVector(dirTmp.set(pts[pts.length - 2].x - pts[pts.length - 1].x, pts[pts.length - 2].y - pts[pts.length - 1].y, pts[pts.length - 2].z - pts[pts.length - 1].z).normalize(), 0.018);
      plugA.quaternion.setFromUnitVectors(up, dirTmp.set(pts[1].x - pts[0].x, pts[1].y - pts[0].y, pts[1].z - pts[0].z).normalize());
      plugB.quaternion.setFromUnitVectors(up, dirTmp.set(pts[pts.length - 2].x - pts[pts.length - 1].x, pts[pts.length - 2].y - pts[pts.length - 1].y, pts[pts.length - 2].z - pts[pts.length - 1].z).normalize());
    },
    hide() { group.visible = false; last = null; },
    isVisible: () => group.visible,
  };
}
