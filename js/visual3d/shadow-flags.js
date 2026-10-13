// shadow-flags.js
// シーン全体へ「影を落とす/受ける」を一括で設定する処理(scene3d.jsから使う)。
// 2026-09(v1.26): 切り出した理由。それまでscene3d.js内の一括処理
// (traverseで全メッシュに castShadow=true / receiveShadow=true)が、
// igloo.jsで個別に設定した影のフラグ(外壁は影を受けない等。シャドウアクネ
// 対策)をすべて上書きしていた。v1.25の「かまくら表面のモアレ」修正が
// 実際のシーンでは効いていなかった原因。
// 個別に影の設定を決めているメッシュは `userData.keepShadowFlags = true`
// を付ければ、一括処理はそのメッシュに触れない。

/**
 * root以下の全メッシュに、既定の影設定(落とす/受ける)を適用する。
 * userData.keepShadowFlags が真のメッシュは、既存の設定を保つ。
 */
export function applyDefaultShadowFlags(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData && obj.userData.keepShadowFlags) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}
