// leaf-fall.js
// 秋に、広葉樹の樹冠から枯れ葉が舞い落ち、木の下に積もっていく表現。
// 2026-09(v1.30): 新規。
//
// 設計:
// - 「舞い落ちている葉」(Falling)と「地面に積もった葉」(Pile)を、別々の
//   固定長プールとして扱う。Fallingは毎フレーム位置を更新する必要がある
//   (揺れながら落ちる)のに対し、Pileは着地した瞬間に1回だけ位置を書けば
//   よく、以降は静止したままでよいため、更新コストが大きく異なる。
// - 色ごとに別のInstancedMesh(ground-detail.jsの落ち葉と同じ理由:
//   InstancedMeshの頂点カラーが環境によって正しく反映されないことがあった
//   ため、色は「別のInstancedMesh」で確実に出す)。
// - Pileは固定長のリングバッファ。満杯になったら、最も古い葉を新しい葉で
//   上書きする(「積もった葉の総数を無限に増やさず、重くなったらそこで
//   打ち止めにする」というユーザーの要望に対応)。木の下に元々ある静的な
//   落ち葉(ground-detail.jsのcreateFallenLeaves)の上に重ねて表示する形に
//   なるため、上書きで多少入れ替わっても不自然には見えない。
// - 落ち葉の動き(揺れながら舞い落ちる)は雨・雪とは別の動き。左右に揺れ、
//   回転しながら、ゆっくり落ちる。風が強い日ほど横方向の揺れが大きくなる。
// - 発生量(1秒あたりの新しい葉の数)は、season.jsのgetAutumnProgress()から
//   導く「今まさにどれだけ活発に散っているか」という強さのカーブ
//   (getSheddingIntensity)で決める。色づき始め・落葉し終わりの前後では
//   ほぼ発生せず、秋の半ば〜後半にかけて最も多く散る。
// - 秋(見た目上。台風シーズン含む)以外の季節では新しい葉を発生させない。
//   ただし、既に舞っている葉はそのまま落ちきらせる(季節の変わり目で
//   空中の葉が急に消えないようにするため)。積もった葉(Pile)自体の
//   表示/非表示は、呼び出し側(scene3d.js)が既存の静的な落ち葉と同じ
//   タイミング(season.isAutumnLike())で切り替える想定
//   (=雪が降る季節にはそもそも落ち葉の山ごと隠れるため、積雪との
//   タイミングが重ならない。ユーザー要望通り、両者を同時に見せる必要はない)。

import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

/** 舞い落ちる葉の色パレット(黄・橙・赤茶・焦げ茶)。 */
const LEAF_PALETTE = [0xd9b23c, 0xd6822c, 0xa8431c, 0x7a4a22];

/** 挙動を決める定数(将来の見た目調整用にまとめてある)。 */
export const LEAF_FALL_PARAMS = {
  fallSpeedMin: 0.32, fallSpeedMax: 0.55, // m/秒。雨・雪よりずっとゆっくり
  swayAmpMin: 0.35, swayAmpMax: 0.75, // 横揺れの強さ(m/秒相当の振幅係数)
  swayFreqMin: 0.7, swayFreqMax: 1.6, // 揺れの周期(rad/秒)
  spinRateMin: 1.5, spinRateMax: 4.0, // 落ちながらの回転速度(rad/秒)
  windDrift: 0.5, // 風の強さ(0〜1想定)が横方向の移動に与える係数
  windSwayBonus: 1.2, // 風の強さが横揺れの振幅に与える追加係数
  scaleMin: 0.6, scaleMax: 1.1,
  groundEpsilon: 0.015,
};

/**
 * 落葉の「今どれだけ活発に散っているか」の強さ(0〜1)。0.15までは
 * (色づき始めたばかりでまだ落ちない)無風状態に近い低さ、その後
 * 半ばでピークになり、落葉し終わる頃(progress→1)には自然と0へ戻る
 * (season.getBroadleafDefoliation()と同じ区間を、山型カーブで辿る)。
 * @param {number} progress season.getAutumnProgress()の戻り値
 */
export function getSheddingIntensity(progress) {
  const START = 0.15;
  if (progress <= START || progress >= 1) return 0;
  const p = (progress - START) / (1 - START);
  return Math.sin(p * Math.PI);
}

/**
 * 落ち葉システムを作る。
 * @param {(x:number,z:number)=>number} terrainHeightFn
 * @param {object} [options]
 * @param {number} [options.fallCapacityPerColor] 同時に舞っていられる葉の数(色ごと)
 * @param {number} [options.pileCapacityPerColor] 積もった葉として保持する数(色ごと、固定長リングバッファ)
 * @param {number} [options.seed]
 */
export function createLeafFallSystem(terrainHeightFn, options = {}) {
  const fallCap = options.fallCapacityPerColor ?? 12;
  const pileCap = options.pileCapacityPerColor ?? 60;
  let seed = (options.seed ?? 1) >>> 0;
  const rng = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const group = new THREE.Group();
  const pileGroup = new THREE.Group(); // 積もった葉(表示/非表示を静的な落ち葉と揃えるため分離)
  group.add(pileGroup);

  // 2026-09(v1.31): 「待っても散っているのが分からない」との指摘を踏まえ、
// 実機での視認性を優先してひとまわり大きくした(0.09→0.13)。小さすぎて
// 480×270の内部解像度では気付きにくかった可能性があるため。
const leafGeo = new THREE.CircleGeometry(0.13, 5);
  leafGeo.rotateX(-Math.PI / 2);

  const dummy = new THREE.Object3D();

  const colors = LEAF_PALETTE;
  const fallingMeshes = colors.map((color) => {
    // 2026-09(バグ修正、v1.34): 葉は円形の平らな板(裏表がある)なので、
    // 既定のマテリアルのままだと片面(THREE.FrontSide)しか描画されない。
    // 葉は舞いながらランダムな向きを取るため、カメラが葉の裏側に回り込む
    // 場面は普通に起こり、「ある視点では見えるのに、視点を回すと消える」
    // という指摘の原因になっていた。両面描画にして解消する。
    const mat = new THREE.MeshToonMaterial({ color, gradientMap: getToonGradientMap(), side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(leafGeo, mat, fallCap);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = fallCap;
    // 2026-09(バグ修正): InstancedMeshは既定では「ジオメトリ自体の(原点付近の
    // ごく小さな)バウンディングスフィア」だけでフラスタムカリング判定をする。
    // 各インスタンスは実際には木の下などワールド中の離れた位置に置かれるため、
    // カメラが原点から離れていると、実際は視界に入っているインスタンスでも
    // メッシュごと丸ごと描画スキップされてしまう(=シミュレーション上のカウント
    // (leaves: falling)は正しく減っていくのに、画面には何も見えないバグの原因)。
    // weather.js の雨/雪/雲/虹の各InstancedMeshと同じくfrustumCulledを無効化する。
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  });
  const pileMeshes = colors.map((color) => {
    const mat = new THREE.MeshToonMaterial({ color, gradientMap: getToonGradientMap(), side: THREE.DoubleSide }); // 同上、裏側からも見えるように
    const mesh = new THREE.InstancedMesh(leafGeo, mat, pileCap);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // 上と同じ理由
    mesh.count = 0; // 最初は1枚も積もっていない
    pileGroup.add(mesh);
    return mesh;
  });

  // 各色ごとの「舞っている葉」の状態(構造of配列。GC負荷を避けるため
  // オブジェクト配列ではなくtypedarray的な素朴な並列配列にする)。
  const fall = colors.map(() => ({
    active: new Uint8Array(fallCap),
    x: new Float32Array(fallCap), y: new Float32Array(fallCap), z: new Float32Array(fallCap),
    fallSpeed: new Float32Array(fallCap),
    swayAmpX: new Float32Array(fallCap), swayAmpZ: new Float32Array(fallCap),
    swayFreqX: new Float32Array(fallCap), swayFreqZ: new Float32Array(fallCap),
    swayPhaseX: new Float32Array(fallCap), swayPhaseZ: new Float32Array(fallCap),
    spinRate: new Float32Array(fallCap), rotAngle: new Float32Array(fallCap),
    scale: new Float32Array(fallCap), age: new Float32Array(fallCap),
  }));
  // 各色ごとの「積もった葉」のリングバッファ書き込み位置。
  const pileCursor = new Int32Array(colors.length);
  const pileFilled = new Int32Array(colors.length); // 現在使用中のスロット数(見た目の枚数=mesh.countに反映)

  let emitAccumulator = 0;

  function findFreeFallSlot(colorIdx) {
    const f = fall[colorIdx];
    for (let i = 0; i < fallCap; i++) if (!f.active[i]) return i;
    return -1;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} topY 発生源となる樹冠の高さ(ワールドY)
   * @param {number} radius 樹冠の半径(発生位置をこの範囲内でばらつかせる)
   */
  function spawnFallingLeaf(x, z, topY, radius) {
    const colorIdx = Math.floor(rng() * colors.length);
    const slot = findFreeFallSlot(colorIdx);
    if (slot < 0) return false; // 満杯: 諦める(無理に押し出さない。舞う葉は少数で十分)
    const f = fall[colorIdx];
    const a = rng() * Math.PI * 2, r = rng() * radius * 0.85;
    f.active[slot] = 1;
    f.x[slot] = x + Math.cos(a) * r;
    f.z[slot] = z + Math.sin(a) * r;
    f.y[slot] = topY - rng() * radius * 0.3;
    const P = LEAF_FALL_PARAMS;
    f.fallSpeed[slot] = P.fallSpeedMin + rng() * (P.fallSpeedMax - P.fallSpeedMin);
    f.swayAmpX[slot] = P.swayAmpMin + rng() * (P.swayAmpMax - P.swayAmpMin);
    f.swayAmpZ[slot] = P.swayAmpMin + rng() * (P.swayAmpMax - P.swayAmpMin);
    f.swayFreqX[slot] = P.swayFreqMin + rng() * (P.swayFreqMax - P.swayFreqMin);
    f.swayFreqZ[slot] = P.swayFreqMin + rng() * (P.swayFreqMax - P.swayFreqMin);
    f.swayPhaseX[slot] = rng() * Math.PI * 2;
    f.swayPhaseZ[slot] = rng() * Math.PI * 2;
    f.spinRate[slot] = (rng() < 0.5 ? -1 : 1) * (P.spinRateMin + rng() * (P.spinRateMax - P.spinRateMin));
    f.rotAngle[slot] = rng() * Math.PI * 2;
    f.scale[slot] = P.scaleMin + rng() * (P.scaleMax - P.scaleMin);
    f.age[slot] = 0;
    return true;
  }

  /** 着地した葉を、その色のPileリングバッファへ1枚積む。満杯なら最も古い1枚を上書きする。 */
  function depositToPile(colorIdx, x, y, z, rotAngle, scale) {
    const slot = pileCursor[colorIdx];
    pileCursor[colorIdx] = (slot + 1) % pileCap;
    pileFilled[colorIdx] = Math.min(pileCap, pileFilled[colorIdx] + 1);
    dummy.position.set(x, y, z);
    // 地面に落ちた葉なので、ほぼ水平のまま(わずかにランダムな傾きだけ)にする
    dummy.rotation.set((rng() - 0.5) * 0.3, rotAngle, (rng() - 0.5) * 0.3);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    const mesh = pileMeshes[colorIdx];
    mesh.setMatrixAt(slot, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = pileFilled[colorIdx];
  }

  /**
   * @param {number} dt
   * @param {object} state
   * @param {boolean} state.shedding 新しい葉を発生させてよいか(=見た目上の秋)
   * @param {number} state.intensity getSheddingIntensity()の戻り値(0〜1)
   * @param {number} state.windFactor 0(無風)〜1(強風)の目安
   * @param {{x:number,z:number,top:number,radius:number}[]} state.sources 発生源(広葉樹)の一覧
   */
  function update(dt, state) {
    const { shedding, intensity, windFactor, sources } = state;

    // --- 発生 ---
    if (shedding && intensity > 0 && sources && sources.length > 0) {
      const BASE_RATE_PER_TREE = 3.2; // 1本あたり、強さ最大時に1秒間に発生させる枚数の目安(2026-09: 視認性のため2.2→3.2に増量)
      const rate = BASE_RATE_PER_TREE * intensity * sources.length;
      emitAccumulator += rate * dt;
      let guard = 0;
      while (emitAccumulator >= 1 && guard < 8) {
        emitAccumulator -= 1;
        guard++;
        const src = sources[Math.floor(rng() * sources.length)];
        spawnFallingLeaf(src.x, src.z, src.top, src.radius);
      }
    } else {
      emitAccumulator = 0;
    }

    // --- 舞っている葉の更新 ---
    const P = LEAF_FALL_PARAMS;
    const windDriftX = windFactor * P.windDrift; // 風向きは簡略化し、+X方向へ流れるとみなす
    for (let c = 0; c < colors.length; c++) {
      const f = fall[c];
      const mesh = fallingMeshes[c];
      for (let i = 0; i < fallCap; i++) {
        if (!f.active[i]) {
          dummy.position.set(0, -9999, 0);
          dummy.scale.setScalar(0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        f.age[i] += dt;
        f.y[i] -= f.fallSpeed[i] * dt;
        const swayScale = 1 + windFactor * P.windSwayBonus;
        f.x[i] += (Math.sin(f.age[i] * f.swayFreqX[i] + f.swayPhaseX[i]) * f.swayAmpX[i] * swayScale) * dt + windDriftX * dt;
        f.z[i] += (Math.sin(f.age[i] * f.swayFreqZ[i] + f.swayPhaseZ[i]) * f.swayAmpZ[i] * swayScale) * dt;
        f.rotAngle[i] += f.spinRate[i] * dt;

        const groundY = terrainHeightFn(f.x[i], f.z[i]) + P.groundEpsilon;
        if (f.y[i] <= groundY) {
          depositToPile(c, f.x[i], groundY, f.z[i], f.rotAngle[i], f.scale[i] * 0.9);
          f.active[i] = 0;
          dummy.position.set(0, -9999, 0);
          dummy.scale.setScalar(0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        dummy.position.set(f.x[i], f.y[i], f.z[i]);
        dummy.rotation.set(Math.PI / 2.3, f.rotAngle[i], 0);
        dummy.scale.setScalar(f.scale[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.count = fallCap; // 非アクティブなスロットはscale=0で描画コストのみ(見た目に影響なし)
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** デバッグ用: 発生量の制限を無視して、すぐにn枚(まで)を舞わせる。 */
  function burst(n, sources) {
    if (!sources || sources.length === 0) return 0;
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const src = sources[Math.floor(rng() * sources.length)];
      if (spawnFallingLeaf(src.x, src.z, src.top, src.radius)) spawned++;
    }
    return spawned;
  }

  /** デバッグ・検証用: 現在舞っている葉の総数。 */
  function countFalling() {
    let n = 0;
    for (const f of fall) for (let i = 0; i < fallCap; i++) if (f.active[i]) n++;
    return n;
  }
  /** デバッグ・検証用: 現在積もっている葉の総数(色の合計)。 */
  function countPiled() {
    let n = 0;
    for (const v of pileFilled) n += v;
    return n;
  }

  /** 積もった葉の表示/非表示(既存の静的な落ち葉と同じタイミングで切り替える想定)。 */
  function setPileVisible(v) {
    pileGroup.visible = !!v;
  }

  return { group, update, setPileVisible, countFalling, countPiled, burst, fallCapacityTotal: fallCap * colors.length, pileCapacityTotal: pileCap * colors.length };
}
