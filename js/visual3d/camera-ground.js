// camera-ground.js
// カメラが「地面(+積雪)・水面より下」に入って、地形の裏側(雪で埋まっている
// はずの川底や地面の中)が見えてしまうのを防ぐ、純粋な計算部品。
// 2026-09(v1.25): 新規追加。
//
// 【不具合の原因】
// 地形・雪面のメッシュは片面描画(FrontSide)。地面より下にカメラが入ると、
// 裏面が描画されず(バックフェイスカリング)、下にある川底などが見えていた。
// 自動カメラの候補位置は「雪だるまの足元の高さ + オフセット」で決めており、
// 最大20m離れた位置そのものの地形の高さは確認していなかった。
//
// 【対策】
// - constrainCameraPosition: カメラ位置の周囲の数点+中心での「地形+積雪、
//   水面」の最大の高さ+余白を下限にする(斜面でも近クリップ面が食い込まない)。
// - isShotBlockedByGround: 自動カメラの候補位置が地面ほぼ直上/下、または
//   地形が被写体との視線を遮る場合にtrue(選び直しに使う)。

const CAMERA_GROUND_MARGIN = 0.3; // 地面からカメラまでの最低限の高さ
const CAMERA_REJECT_MARGIN = 0.1; // 候補位置を却下する閾値(これ未満は地面ほぼ直上)
const CAMERA_GROUND_PROBE = 0.7;  // 周囲を調べる半径
const PROBE_OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const WATER_SURFACE_BOB = 0.03; // 水面シェーダーの上下のうねり(river.jsの0.025)ぶんの余裕
const VIEW_RAY_SAMPLES = 24;

export const CAMERA_GROUND_CONSTANTS = { CAMERA_GROUND_MARGIN, CAMERA_REJECT_MARGIN, CAMERA_GROUND_PROBE, WATER_SURFACE_BOB };

/**
 * @param {object} deps
 * @param {(x:number,z:number)=>number} deps.terrainHeightFn - 地形の高さ
 * @param {(x:number,z:number)=>number} deps.waterSurfaceFn - 水面の高さ(水が無ければ-Infinity)
 * @param {()=>number} deps.snowOffsetFn - 積雪の深さ(雪面が見えていない時は0)
 */
export function createCameraGroundGuard({ terrainHeightFn, waterSurfaceFn, snowOffsetFn }) {
  /** 地形+積雪の表面の高さ(水面は含まない)。 */
  function getLandSurfaceY(x, z) {
    return terrainHeightFn(x, z) + snowOffsetFn();
  }

  /** カメラの下限とすべき「地面(+積雪)/水面」の、周囲を含めた最大の高さ(余白は含まない)。 */
  function getCameraGroundY(x, z) {
    let h = -Infinity;
    for (const [ox, oz] of PROBE_OFFSETS) {
      const px = x + ox * CAMERA_GROUND_PROBE, pz = z + oz * CAMERA_GROUND_PROBE;
      h = Math.max(h, getLandSurfaceY(px, pz), waterSurfaceFn(px, pz) + WATER_SURFACE_BOB);
    }
    return h;
  }

  /** カメラ位置を地面/水面より上へ補正する(posを書き換える)。補正したらtrue。 */
  function constrainCameraPosition(pos) {
    const minY = getCameraGroundY(pos.x, pos.z) + CAMERA_GROUND_MARGIN;
    if (pos.y < minY) { pos.y = minY; return true; }
    return false;
  }

  /** 地形(+積雪)が、カメラと被写体の間の視線を遮っているか(水面は遮らない)。 */
  function isTerrainBlockingView(pos, target) {
    for (let i = 1; i < VIEW_RAY_SAMPLES; i++) {
      const s = i / VIEW_RAY_SAMPLES;
      const x = pos.x + (target.x - pos.x) * s;
      const z = pos.z + (target.z - pos.z) * s;
      const y = pos.y + (target.y - pos.y) * s;
      if (y < getLandSurfaceY(x, z) + 0.05) return true;
    }
    return false;
  }

  /** 自動カメラの候補位置を却下すべきか(地面ほぼ直上/下、または地形が視線を遮る)。 */
  function isShotBlockedByGround(pos, target) {
    if (pos.y < getCameraGroundY(pos.x, pos.z) + CAMERA_REJECT_MARGIN) return true;
    return isTerrainBlockingView(pos, target);
  }

  return { getLandSurfaceY, getCameraGroundY, constrainCameraPosition, isTerrainBlockingView, isShotBlockedByGround };
}

/**
 * かまくらのドーム(半球)が、カメラと被写体の間の視線を遮る/カメラがドームの
 * 中に入る位置を判定する(2026-09 v1.28)。焚き火はかまくらの入口の正面にあり、
 * 焚き火を離れて撮ると、ドームが間に入りやすい。
 * @param {object} deps
 * @param {()=>{x:number,y:number,z:number}|null} deps.getDome - ドームの中心(地面上)。無ければnull
 * @param {number} deps.radius - ドームの外半径
 */
export function createDomeOcclusionGuard({ getDome, radius }) {
  const inside = (d, x, y, z, r) => {
    const dx = x - d.x, dy = y - d.y, dz = z - d.z;
    return dy > -0.3 && dx * dx + dy * dy + dz * dz < r * r;
  };
  /** 被写体(target)がドームの外にあり、カメラがドームの中にある/視線がドームを貫く時にtrue。 */
  function isShotBlockedByDome(pos, target) {
    const d = getDome();
    if (!d) return false;
    // 被写体がドームの中にある場合(雪だるまが中にいる)は判定しない(従来通り)
    if (inside(d, target.x, target.y, target.z, radius)) return false;
    if (inside(d, pos.x, pos.y, pos.z, radius + 0.3)) return true;
    for (let i = 1; i < VIEW_RAY_SAMPLES; i++) {
      const s = i / VIEW_RAY_SAMPLES;
      if (inside(d, pos.x + (target.x - pos.x) * s, pos.y + (target.y - pos.y) * s, pos.z + (target.z - pos.z) * s, radius - 0.05)) return true;
    }
    return false;
  }
  return { isShotBlockedByDome };
}
