// camera-director.js
// 見守りモード用の自動シネマティックカメラ。
// 2026-09: 新規追加。「自動で動く雪だるまを主人公として、俯瞰・全身・
// やや離れた場所・ドローン風など様々なアングルで、見飽きない映画のように
// 撮影してほしい」という要望に対応する。
//
// 2026-09(改訂1): 「一人のカメラマンがずっと動いているように見える」との
// 指摘を受け、ショットの切り替えを即座(ハードカット)にする方式へ変更。
// 世界のいろんな場所に固定カメラが設置してあり、それをスイッチングして
// いるように見せる。テントだけのカットは削除し、雪だるまが映る構図の
// 重みを高くした。
//
// 2026-09(改訂2): 追加の指摘に対応。
// - 「画面いっぱいに木の葉だけになるカットがある」→ カメラ位置が木の
//   葉(canopy)の中に入り込んでしまうケースを避けるため、`isBlocked`
//   コールバックで候補位置を確認し、葉の中に入りそうならやり直す
//   `pickClearPosition()` を追加した。
// - 「川面だけにズームするカットは不要」→ river_only ショットを削除。
// - 「ゆっくりズームは雪だるま・焚き火・お花畑以外には使わない」→
//   ズーム(fovStart!==fovEnd)を使うショットを full_body / wide_distant
//   (雪だるま)・campfire_only(焚き火)・flowers_only(お花畑)に限定し、
//   それ以外(overhead / low_angle / drone_pan)は固定画角のままにした。

//
// 2026-09(改訂3): 「自動カメラで地形の裏側(雪で埋まっているはずの川の中や
// 地面の中)が見えてしまう」不具合への対応。
// 原因: 以前は候補位置の高さを「雪だるまの足元の高さ + オフセット」で決めて
// おり、最大20m離れたカメラ位置そのものの地形の高さは確認していなかった。
// 斜面・川岸・谷では地面より下にカメラが入り、片面描画の地形/雪面を
// 裏側から見て(裏面が描画されず)、埋まっているはずの川底などが見えた。
// ドローン風パンでもカット中に旋回して潜り込むことがあった。
// 対策(アルゴリズムで解決):
// - `isBlocked(pos, target)` で、地面/水面の下に入る位置や、地形が雪だるま
//   (被写体)との間を遮る位置を候補から外して選び直す。
// - 選び直しを繰り返しても見つからなければ、被写体に近づけた位置
//   (距離を0.7倍、0.5倍)でも試す。
// - `constrainPosition(pos)` を、カット開始時と毎フレーム(パン中)の
//   位置更新の直後に必ず通し、どんな場合でも地面/水面の下には入らない
//   ようにする(最終的な安全網)。補正後にlookAtをやり直す。

// 2026-09(改訂4, v1.28): 焚き火のカットの見直し。
// - 「焚き火のズームが近すぎる。焚き火全体が入るように」→ 以前は距離1.6m・画角
//   40°(ズーム時34°)で、画面に映る高さは約1.0〜1.16m。焚き火(薪・石の輪・
//   炎)は高さ約1.4m・幅約1.74mあり、そもそも収まらなかった。距離4.4〜5.6m・
//   カメラ高さ+1.0〜1.7m・画角40°(ズーム時は37°まで)にして、焚き火が
//   画面の高さの約4〜6割を占め、周囲も少し入る構図にした。
// - 「焚き火のカットが多すぎる」→ 10時間分を実物のコードで試すと、焚き火専用
//   カットは平均3.7分に1回だった。選ばれやすさの重みを0.7→0.25に下げ、
//   さらに前回の焚き火カットから8分以上空ける(FIRE_COOLDOWN_SECONDS)。
// - かまくらのドームが視線を遮る/カメラがドームの中に入る位置は`isBlocked`で
//   却下する(焚き火はかまくらの入口の正面にあり、距離を取るとドームが
//   間に入りやすくなるため)。十分に離れた位置が見つからない場合は、無理に
//   近づけず、焚き火のカット自体を見送って別のカットにする。

import * as THREE from 'three';

/** 焚き火専用カットを、前回から最低これだけ(秒)空ける。 */
export const FIRE_COOLDOWN_SECONDS = 480;
/** 焚き火専用カットの、選ばれやすさの重み(他のカットは2〜4)。 */
export const FIRE_SHOT_WEIGHT = 0.25;
/** 焚き火専用カットのカメラ距離(m)・高さ(焚き火の地面からの高さ, m)・画角(度)。 */
export const FIRE_SHOT_PARAMS = {
  distMin: 4.4, distMax: 5.6,
  heightMin: 1.0, heightMax: 1.7,
  targetHeight: 0.55, // 見る点(焚き火の地面から。炎・薪の中心あたり)
  fovStart: 40, fovZoomEnd: 37, zoomProbability: 0.3,
};

const UP = new THREE.Vector3(0, 1, 0);
const _rel = new THREE.Vector3();

/**
 * @param {object} [options]
 * @param {(pos:THREE.Vector3, target:THREE.Vector3)=>boolean} [options.isBlocked] - そのカメラ位置が
 *   木の葉・地面の下に埋もれる、または地形が被写体を遮る(=採用したくない)
 *   場合にtrueを返すコールバック。
 * @param {(pos:THREE.Vector3)=>void} [options.constrainPosition] - カメラ位置を
 *   地面/水面より上へ補正するコールバック(pos自体を書き換える)。
 */
export function createCameraDirector(options = {}) {
  const isBlocked = typeof options.isBlocked === 'function' ? options.isBlocked : null;
  const constrainPosition = typeof options.constrainPosition === 'function' ? options.constrainPosition : null;

  let activeShot = null;
  let shotTimer = 0;
  let shotElapsed = 0;
  let lastShotType = null;
  let directorTime = 0; // 見守り開始からの経過秒(焚き火カットの間隔管理に使う)
  let lastFireCutAt = -FIRE_COOLDOWN_SECONDS * 0.5; // 開始直後に焚き火カットが出ないよう、半分ぶん経過したことにする

  /**
   * center を中心に angle(0〜2π) の位置を作る buildPosFn を何度か試し、
   * isBlocked に引っかからない位置を探す。
   * buildPosFn(angle, k): kは被写体からの水平距離の倍率(1=通常)。
   * まずk=1で6回、見つからなければ被写体に近づけて(0.7倍、0.5倍)
   * 各3回ずつ試す。それでも見つからなければ最後の候補を返す(この場合も、
   * 呼び出し側でconstrainPositionを通すため地面の下には入らない)。
   * @param {(angle:number, k:number)=>THREE.Vector3} buildPosFn
   * @param {THREE.Vector3} target - このカメラが見る点(遮蔽判定に使う)
   */
  function pickClearPosition(buildPosFn, target, options = {}) {
    const plan = options.plan || [1, 1, 1, 1, 1, 1, 0.7, 0.7, 0.7, 0.5, 0.5, 0.5];
    let pos = null;
    for (const k of plan) {
      pos = buildPosFn(Math.random() * Math.PI * 2, k);
      if (!isBlocked || !isBlocked(pos, target)) return pos;
    }
    // options.strict: 見つからなければ、無理に採用せずnullを返す(呼び出し側で別のカットにする)
    return options.strict ? null : pos;
  }

  /**
   * ctx: {
   *   snowman: {x,y,z},
   *   camp: {x,y,z} | null, fire: {x,y,z} | null,
   *   river: {x,y,z} | null, flower: {x,y,z} | null,
   * }
   */
  function pickShot(ctx) {
    // 雪だるまが主人公なので、雪だるまが映るショットの重みを高くし、
    // 映らないカットワーク(花畑・焚き火だけ)は時々挟む程度にする。
    const candidates = [
      { type: 'full_body', w: 4 },
      { type: 'wide_distant', w: 3 },
      { type: 'overhead', w: 2.5 },
      { type: 'low_angle', w: 2.2 },
      { type: 'drone_pan', w: 2 },
    ];
    if (ctx.flower) candidates.push({ type: 'flowers_only', w: 0.9 });
    if (ctx.fire && directorTime - lastFireCutAt >= FIRE_COOLDOWN_SECONDS) {
      candidates.push({ type: 'campfire_only', w: FIRE_SHOT_WEIGHT });
    }

    const pool = candidates.filter((c) => c.type !== lastShotType);
    const total = pool.reduce((s, c) => s + c.w, 0);
    let r = Math.random() * total;
    for (const c of pool) {
      r -= c.w;
      if (r <= 0) return c.type;
    }
    return pool[0].type;
  }

  /**
   * ショットを1つ組み立てる。
   * pos/target: カット開始時に即座にセットする固定のカメラ配置。
   * fovStart/fovEnd: 異なる値ならショットの間ゆっくりズームする(同じなら固定)。
   * panSpeed: 0以外なら、targetを中心にゆっくり周回する(ドローン風)。
   */
  function buildShot(type, ctx) {
    const sp = ctx.snowman;
    const rand = (a, b) => a + Math.random() * (b - a);
    switch (type) {
      case 'overhead': {
        const target = new THREE.Vector3(sp.x, sp.y + 0.5, sp.z);
        const pos = pickClearPosition((angle, k) =>
          new THREE.Vector3(sp.x + Math.cos(angle) * 3 * k, sp.y + rand(13, 17), sp.z + Math.sin(angle) * 3 * k), target);
        return {
          pos,
          target,
          duration: rand(9, 13), fovStart: 45, fovEnd: 45, panSpeed: 0,
        };
      }
      case 'full_body': {
        // 「設置されたカメラ」らしく、基本は固定。ごくまれにだけ、
        // わずかに寄る(ゆっくりズームイン)。雪だるまが被写体なのでズームOK。
        const dist = rand(4.5, 6.5);
        const target = new THREE.Vector3(sp.x, sp.y + 0.85, sp.z);
        const pos = pickClearPosition((angle, k) =>
          new THREE.Vector3(sp.x + Math.cos(angle) * dist * k, sp.y + rand(1.3, 1.9), sp.z + Math.sin(angle) * dist * k), target);
        const doZoom = Math.random() < 0.4;
        return {
          pos,
          target,
          duration: rand(8, 12), fovStart: 42, fovEnd: doZoom ? 36 : 42, panSpeed: 0,
        };
      }
      case 'wide_distant': {
        const dist = rand(13, 20);
        const target = new THREE.Vector3(sp.x, sp.y + 0.6, sp.z);
        const pos = pickClearPosition((angle, k) =>
          new THREE.Vector3(sp.x + Math.cos(angle) * dist * k, sp.y + rand(3.5, 7), sp.z + Math.sin(angle) * dist * k), target);
        const doZoom = Math.random() < 0.4;
        return {
          pos,
          target,
          duration: rand(12, 17), fovStart: 40, fovEnd: doZoom ? 34 : 40, panSpeed: 0,
        };
      }
      case 'low_angle': {
        // 見上げるような撮影(カメラを低く、注視点は少し高めに)。固定画角。
        const dist = rand(3, 4.5);
        const target = new THREE.Vector3(sp.x, sp.y + 1.5, sp.z);
        const pos = pickClearPosition((angle, k) =>
          new THREE.Vector3(sp.x + Math.cos(angle) * dist * k, sp.y + rand(0.25, 0.45), sp.z + Math.sin(angle) * dist * k), target);
        return {
          pos,
          target,
          duration: rand(7, 10), fovStart: 46, fovEnd: 46, panSpeed: 0,
        };
      }
      case 'drone_pan': {
        // 少し斜め上から、ごくゆっくり周回する「ドローン撮影」風。固定画角
        // (画角変化は雪だるま・焚き火・花畑のショットに限定するため、
        // ここではパンのみでズームはしない)。
        const dist = rand(9, 15);
        const target = new THREE.Vector3(sp.x, sp.y + 0.5, sp.z);
        const pos = pickClearPosition((angle, k) =>
          new THREE.Vector3(sp.x + Math.cos(angle) * dist * k, sp.y + rand(6, 10), sp.z + Math.sin(angle) * dist * k), target);
        return {
          pos,
          target,
          duration: rand(16, 22), fovStart: 38, fovEnd: 38,
          panSpeed: rand(0.015, 0.028) * (Math.random() < 0.5 ? 1 : -1),
        };
      }
      case 'flowers_only': {
        const fp = ctx.flower;
        const target = new THREE.Vector3(fp.x, fp.y + 0.12, fp.z);
        const pos = pickClearPosition((angle, k) =>
          new THREE.Vector3(fp.x + Math.cos(angle) * 1.8 * k, fp.y + rand(0.4, 0.8), fp.z + Math.sin(angle) * 1.8 * k), target);
        const doZoom = Math.random() < 0.4;
        return {
          pos,
          target,
          duration: rand(6, 9), fovStart: 44, fovEnd: doZoom ? 38 : 44, panSpeed: 0,
        };
      }
      case 'campfire_only': {
        // 焚き火(高さ約1.4m・幅約1.74m)の全体と周囲が入る、離れた構図。
        const fp = ctx.fire;
        const F = FIRE_SHOT_PARAMS;
        const dist = rand(F.distMin, F.distMax);
        const target = new THREE.Vector3(fp.x, fp.y + F.targetHeight, fp.z);
        // 近づけ過ぎない(kは0.85まで)。見つからなければnull(別のカットにする)
        const pos = pickClearPosition((angle, k) =>
          new THREE.Vector3(fp.x + Math.cos(angle) * dist * k, fp.y + rand(F.heightMin, F.heightMax), fp.z + Math.sin(angle) * dist * k),
          target, { plan: [1, 1, 1, 1, 1, 1, 1, 1, 0.85, 0.85, 0.85, 0.85], strict: true });
        if (!pos) return null;
        const doZoom = Math.random() < F.zoomProbability;
        return {
          pos,
          target,
          duration: rand(6, 9), fovStart: F.fovStart, fovEnd: doZoom ? F.fovZoomEnd : F.fovStart, panSpeed: 0,
        };
      }
      default:
        return {
          pos: new THREE.Vector3(sp.x + 6, sp.y + 2.5, sp.z + 6),
          target: new THREE.Vector3(sp.x, sp.y + 0.6, sp.z),
          duration: 8, fovStart: 42, fovEnd: 42, panSpeed: 0,
        };
    }
  }

  /**
   * @param {number} delta
   * @param {object} ctx - 上記buildShot()参照
   * @param {THREE.PerspectiveCamera} camera
   */
  function update(delta, ctx, camera) {
    if (!ctx || !ctx.snowman) return;

    directorTime += delta;
    shotTimer -= delta;
    if (!activeShot || shotTimer <= 0) {
      let type = pickShot(ctx);
      let shot = buildShot(type, ctx);
      if (!shot) { // 焚き火の適切な位置が見つからなかった: 別のカットにする(間隔は消費しない)
        type = 'full_body';
        shot = buildShot(type, ctx);
      }
      if (type === 'campfire_only') lastFireCutAt = directorTime;
      lastShotType = type;
      activeShot = shot;
      shotTimer = activeShot.duration;
      shotElapsed = 0;
      // ハードカット: 前のショットから補間せず、即座に新しい位置・画角へ切り替える
      if (constrainPosition) constrainPosition(activeShot.pos); // 地面/水面の下には入れない
      camera.position.copy(activeShot.pos);
      camera.lookAt(activeShot.target);
      camera.fov = activeShot.fovStart;
      camera.updateProjectionMatrix();
      return;
    }

    shotElapsed += delta;
    const progress = Math.min(1, shotElapsed / activeShot.duration);

    if (activeShot.panSpeed !== 0) {
      // 注視点を中心に、カメラをゆっくり周回させる(ドローンが旋回するイメージ)
      _rel.subVectors(camera.position, activeShot.target);
      _rel.applyAxisAngle(UP, activeShot.panSpeed * delta);
      camera.position.copy(activeShot.target).add(_rel);
      // 旋回で地形の低い所/高い所を通っても、地面/水面の下に潜らないようにする。
      // (補正した高さは次フレームの旋回の基準になるが、旋回は水平回転なので
      //  次フレームで再び補正されるだけであり、被写体のlookAtも毎回やり直す)
      if (constrainPosition) constrainPosition(camera.position);
      camera.lookAt(activeShot.target);
    }

    if (activeShot.fovStart !== activeShot.fovEnd) {
      // ショットの尺全体を使って、直線的にゆっくりズームする
      camera.fov = activeShot.fovStart + (activeShot.fovEnd - activeShot.fovStart) * progress;
      camera.updateProjectionMatrix();
    }
  }

  function reset() {
    activeShot = null;
  }

  /** 検証用: 状態(間隔・直前のカット)を変えずに、指定の種類のカットを1つ組み立てる。 */
  function previewShot(type, ctx) {
    return buildShot(type, ctx);
  }

  return { update, reset, previewShot };
}
