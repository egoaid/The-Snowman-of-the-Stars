// interaction.js
// v1.39 フェーズ1: 視線中心の「狙う」仕組み(常時表示のクロスヘアは出さない)。
//
// 画面中央=カメラの向いている方向、という前提で、カメラの位置と向きだけから
// 「今どの登録済みオブジェクトを見ているか」を割り出す。実際のThree.js
// Raycasterやプロキシメッシュは使わず、ベクトル演算だけで済ませている
// (視線方向への投影距離と、そこからの横方向のずれを見る。円柱状の
// 「狙いの筒」に対象の当たり判定球が触れているかを見るのと同じこと)。
// 登録数が数百あっても、対象ごとにMath.hypot程度の計算で済むので軽い。
//
// 狙われている対象は、共有の1つの「光の殻」(加算合成・裏面描画の半透明球)を
// その対象の位置・大きさに合わせて移動・拡大縮小することで示す。対象本体の
// マテリアルには一切触れないので、同じマテリアルを共有する他の対象(例えば
// 同じ種類の岩や木)が連動して光ってしまうことはない。

export function createInteractionSystem({ THREE, reach = 3.4 }) {
  const entries = new Map();
  let nextId = 1;

  const highlightGeo = new THREE.IcosahedronGeometry(1, 1);
  const highlightMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c4,
    transparent: true,
    opacity: 0.16,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const highlight = new THREE.Mesh(highlightGeo, highlightMat);
  highlight.visible = false;
  highlight.renderOrder = 998;
  highlight.matrixAutoUpdate = true;

  let focused = null;

  /**
   * @param {object} def
   * @param {() => {x:number,y:number,z:number}} def.getPosition
   * @param {number} def.radius - 当たり判定・ハイライトのだいたいの半径(m)
   * @param {string} def.kind
   * @param {number} [def.reach] - この対象だけ届く距離を変えたい時
   * @param {() => boolean} [def.enabled] - falseの間は判定そのものから外す(既定: 常にtrue)
   * @param {() => boolean} [def.canInteract] - 省略時はtrue。falseでもハイライトはするが、
   *   trigger()では反応しない(「見えてはいるが今は何もできない」を表現できる)。
   * @param {(entry:object) => void} [def.onInteract]
   * @returns {number} id(unregisterに使う)
   */
  function register(def) {
    const id = nextId++;
    entries.set(id, { id, reach: def.reach || reach, ...def });
    return id;
  }
  function unregister(id) {
    entries.delete(id);
    if (focused && focused.id === id) { focused = null; highlight.visible = false; }
  }

  /**
   * @param {{x:number,y:number,z:number}} eye
   * @param {{x:number,y:number,z:number}} forward - 正規化済みの視線方向
   */
  function update(eye, forward) {
    let best = null;
    let bestAlong = Infinity;
    for (const e of entries.values()) {
      if (e.enabled && !e.enabled()) continue;
      const p = e.getPosition();
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
      const maxReach = e.reach + e.radius;
      // まず粗い距離のふるい分け(平方根なし)。対象の大半はここで弾ける。
      if (dx * dx + dy * dy + dz * dz > maxReach * maxReach) continue;
      const along = dx * forward.x + dy * forward.y + dz * forward.z; // 視線方向への投影距離
      if (along <= 0.05 || along > maxReach) continue; // 背後、または遠すぎる
      const lateralSq = dx * dx + dy * dy + dz * dz - along * along; // 視線からの横ずれ(二乗)
      const toleranceSq = e.radius * e.radius * 1.2; // 見た目の大きさに応じた狙いやすさ
      if (lateralSq > toleranceSq) continue;
      if (along < bestAlong) { bestAlong = along; best = e; }
    }
    focused = best;
    if (focused) {
      const p = focused.getPosition();
      highlight.position.set(p.x, p.y, p.z);
      const s = focused.radius * 1.2;
      highlight.scale.set(s, s, s);
      highlight.visible = true;
    } else {
      highlight.visible = false;
    }
  }

  function hide() { focused = null; highlight.visible = false; }

  return {
    highlightObject: highlight,
    register,
    unregister,
    update,
    hide,
    getFocused: () => focused,
    getFocusedKind: () => (focused ? focused.kind : null),
    /** 現在狙っている対象へアクションを起こす。何もしなければfalseを返す。 */
    trigger() {
      if (!focused) return false;
      if (focused.canInteract && !focused.canInteract()) return false;
      if (focused.onInteract) { focused.onInteract(focused); return true; }
      return false;
    },
  };
}
