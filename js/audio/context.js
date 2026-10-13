/**
 * context.js
 * AudioContext・マスターゲイン・共通ユーティリティ(ノイズバッファ生成、パンナー、
 * 空間演出用リバーブ)を管理する基盤モジュール。
 * 他の audio/*.js は window.SoundEngine 名前空間経由でこれらを利用する。
 *
 * 【空間表現(定位感・サラウンド感)の設計】
 * 各音源は個別の StereoPannerNode を持ち、左右の定位を調整できる。
 * さらに全体には共有のコンボルバーリバーブ(生成した疑似インパルスレスポンス)を
 * ドライ/ウェットのバスとしてかけ、setSpaciousness() で「その場にいる」ような
 * 空間の広がりを調整できるようにしている。
 */
(function () {
  'use strict';

  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  let ctx = null;
  let masterGain = null;   // 最終出力(環境音バスと効果音バスの合流点。録音もここから取る)
  let ambientBus = null;   // v1.56-H3: 環境音(川・雨・風・虫・鳥・焚き火・雷・蜂)のバス
  let sfxBus = null;       // v1.56-H3: 効果音(足音・拾う/置く・チェスト・丸太・UI・星の鈴)のバス
  let ambientVolume = 1;   // 設定画面の音量(0〜1.5)。AudioContext作成前に決まった値も、作成時に反映する
  let sfxVolume = 1;
  let dryGain = null;
  let wetGain = null;
  let reverbNode = null;
  let spaciousness = 0.35;

  function init() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;
    ambientBus = ctx.createGain();
    ambientBus.gain.value = ambientVolume;
    sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxVolume;
    ambientBus.connect(masterGain);
    sfxBus.connect(masterGain);

    dryGain = ctx.createGain();
    wetGain = ctx.createGain();
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = createReverbImpulse(2.6, 2.8);

    masterGain.connect(dryGain);
    masterGain.connect(reverbNode);
    reverbNode.connect(wetGain);
    dryGain.connect(ctx.destination);
    wetGain.connect(ctx.destination);

    setSpaciousness(spaciousness);
    return ctx;
  }

  function getContext() {
    if (!ctx) init();
    return ctx;
  }

  function getMasterGain() {
    if (!masterGain) init();
    return masterGain;
  }

  /** 環境音のバス(環境音の音源はここへつなぐ)。 */
  function getAmbientBus() {
    if (!ambientBus) init();
    return ambientBus;
  }
  /** 効果音のバス(足音・拾う/置く・チェスト・丸太・UIの音はここへつなぐ)。 */
  function getSfxBus() {
    if (!sfxBus) init();
    return sfxBus;
  }
  const clampVol = (v) => Math.max(0, Math.min(1.5, Number.isFinite(v) ? v : 1));
  /** 設定画面の音量。AudioContextがまだ無くても値は覚えておき、作成時に反映する(音を有効にする前でも動かせる)。 */
  function setAmbientVolume(v) {
    ambientVolume = clampVol(v);
    if (ambientBus) ambientBus.gain.setTargetAtTime(ambientVolume, ctx.currentTime, 0.03);
  }
  function setSfxVolume(v) {
    sfxVolume = clampVol(v);
    if (sfxBus) sfxBus.gain.setTargetAtTime(sfxVolume, ctx.currentTime, 0.03);
  }
  const getAmbientVolume = () => ambientVolume;
  const getSfxVolume = () => sfxVolume;

  function setMasterVolume(v) {
    if (!masterGain) init();
    masterGain.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }

  /**
   * 空間の広がり(部屋の響き)を 0(狭い・ドライ)〜1(広い森の中にいるような響き)で設定
   */
  function setSpaciousness(v) {
    spaciousness = Math.max(0, Math.min(1, v));
    if (!ctx) return;
    const now = ctx.currentTime;
    dryGain.gain.setTargetAtTime(1 - spaciousness * 0.35, now, 0.3);
    wetGain.gain.setTargetAtTime(spaciousness * 0.55, now, 0.3);
  }

  function getSpaciousness() {
    return spaciousness;
  }

  async function resume() {
    if (!ctx) init();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx;
  }

  /**
   * 自然な森の中のような響きを模した、疑似インパルスレスポンスを生成する。
   * 減衰するノイズ(指数カーブ)で、金属的にならないよう左右chで微妙に位相をずらす。
   */
  function createReverbImpulse(duration = 2.5, decay = 2.5) {
    const c = getContext();
    const length = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(2, length, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  /**
   * StereoPannerNodeを作成するショートカット
   */
  function createPanner(pan = 0) {
    const c = getContext();
    const p = c.createStereoPanner();
    p.pan.value = pan;
    return p;
  }

  // --- ノイズバッファ生成ユーティリティ ---

  const bufferCache = new Map();

  function createWhiteNoiseBuffer(seconds = 4) {
    const key = 'white-' + seconds;
    if (bufferCache.has(key)) return bufferCache.get(key);
    const c = getContext();
    const bufferSize = c.sampleRate * seconds;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    bufferCache.set(key, buffer);
    return buffer;
  }

  function createPinkNoiseBuffer(seconds = 4) {
    const key = 'pink-' + seconds;
    if (bufferCache.has(key)) return bufferCache.get(key);
    const c = getContext();
    const bufferSize = c.sampleRate * seconds;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
    bufferCache.set(key, buffer);
    return buffer;
  }

  function createBrownNoiseBuffer(seconds = 4) {
    const key = 'brown-' + seconds;
    if (bufferCache.has(key)) return bufferCache.get(key);
    const c = getContext();
    const bufferSize = c.sampleRate * seconds;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5;
    }
    bufferCache.set(key, buffer);
    return buffer;
  }

  function createNoiseSource(type = 'white', seconds = 4) {
    const c = getContext();
    const src = c.createBufferSource();
    if (type === 'pink') src.buffer = createPinkNoiseBuffer(seconds);
    else if (type === 'brown') src.buffer = createBrownNoiseBuffer(seconds);
    else src.buffer = createWhiteNoiseBuffer(seconds);
    src.loop = true;
    return src;
  }

  function createNoiseBurstBuffer(durationSec = 0.05) {
    const c = getContext();
    const size = Math.max(1, Math.floor(c.sampleRate * durationSec));
    const buffer = c.createBuffer(1, size, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      const decay = 1 - i / size;
      data[i] = (Math.random() * 2 - 1) * decay;
    }
    return buffer;
  }

  function randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /**
   * 指数(対数)補間: min〜maxの間をtで滑らかに(かつ広いレンジで)補間する。
   * 雨粒の発生頻度のように「弱い時は数秒に1回、強い時は1秒間に数百回」といった
   * 桁違いのレンジを持つパラメータに使う。
   */
  function expInterp(min, max, t) {
    const tt = Math.max(0, Math.min(1, t));
    return min * Math.pow(max / min, tt);
  }

  /**
   * ポアソン過程における次のイベントまでの待ち時間(秒)を生成する。
   * rate はイベント発生率(1秒あたりの回数)。実際の降雨の粒の到着間隔は
   * 一様分布ではなく指数分布に従うことが統計的に知られている
   * (Uijlenhoet et al. の降雨粒子分布モデル等)。
   */
  function poissonGapSeconds(rate) {
    const r = Math.max(0.0001, rate);
    return -Math.log(1 - Math.random()) / r;
  }

  /**
   * ノイズ由来の有機的な(規則的すぎない)エンベロープカーブを生成する。
   * 雷鳴のロール(ゴロゴロ)音のように、単純な指数減衰よりも不規則な
   * うねりを持たせたい場合に、AudioParam.setValueCurveAtTime に渡して使う。
   * ランダムな値の列を平滑化(移動平均的処理)してから正規化し、
   * 全体を減衰させるテーパーをかけて自然に消えていくようにする。
   */
  function createEnvelopeCurve(durationSec, resolution = 40, smoothing = 0.75, decayPower = 1.4) {
    const n = Math.max(8, Math.floor(durationSec * resolution));
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = Math.random();
    const smoothed = new Float32Array(n);
    let prev = raw[0];
    for (let i = 0; i < n; i++) {
      prev = prev * smoothing + raw[i] * (1 - smoothing);
      smoothed[i] = prev;
    }
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, smoothed[i]);
    max = max || 1;
    for (let i = 0; i < n; i++) {
      const taper = Math.pow(1 - i / n, decayPower);
      smoothed[i] = (smoothed[i] / max) * taper;
    }
    // 先頭は必ず1に近い値から始める(アタック直後が最大になるように)
    smoothed[0] = Math.max(smoothed[0], 0.85);
    return smoothed;
  }

  SoundEngine.expInterp = expInterp;
  SoundEngine.poissonGapSeconds = poissonGapSeconds;
  SoundEngine.createEnvelopeCurve = createEnvelopeCurve;

  /**
   * ============================================================
   * バイノーラル立体空間システム
   * ============================================================
   * 川・雨・風・雷・焚き火・虫・鳥、全ての音源をこのシステムに統一し、
   * Web Audio の PannerNode(panningModel: 'HRTF')で前後左右・距離感を
   * 含む立体的な定位を行う。単純な左右パン(StereoPannerNode)よりも
   * 本物のバイノーラル体験に近い。
   *
   * 各音源は「基準位置(baseX/Y/Z、メートル単位、リスナーを原点として
   * 前方 = -Z、右 = +X、上 = +Y)」を持ち、以下のグローバル設定を
   * 掛け合わせた上で実際のPannerNodeの位置に変換される:
   *   - roomScale  : 全体の距離感の縮尺(大きいほど音源が遠くに感じる)
   *   - rotation   : シーン全体をリスナーの周りで回転させる(「振り向く」操作)
   *   - panningModel / distanceModel / rolloffFactor / refDistance / maxDistance
   *     : PannerNode自体の特性(処理負荷や距離減衰のかかり方)
   *
   * 常時鳴り続ける音源(風・焚き火・川の各レイヤー・雨の方角ゾーンなど)は
   * registerSpatialSource() で登録しておくことで、設定変更時に自動的に
   * 位置・特性が再計算される。虫・鳥の一鳴き・雷の一撃のような短命な音は
   * 登録不要(発生時点の設定でその都度位置を計算すれば十分)。
   */
  const spatialSettings = {
    panningModel: 'HRTF',     // 'HRTF' または 'equalpower'(軽量・簡易)
    distanceModel: 'inverse', // 'linear' | 'inverse' | 'exponential'
    rolloffFactor: 0.3,
    refDistance: 1,
    maxDistance: 10000,
    roomScale: 1,             // 0.3(狭い)〜2(広大)程度を想定
    rotation: 0,              // ラジアン。シーン全体の回転(「振り向く」)
  };
  const spatialRegistry = []; // { panner, getPosition }

  function transformSpatialPosition(x, y, z) {
    const sx = x * spatialSettings.roomScale;
    const sy = y * spatialSettings.roomScale;
    const sz = z * spatialSettings.roomScale;
    const cos = Math.cos(spatialSettings.rotation);
    const sin = Math.sin(spatialSettings.rotation);
    return { x: sx * cos - sz * sin, y: sy, z: sx * sin + sz * cos };
  }

  function applyPannerCharacteristics(panner) {
    panner.panningModel = spatialSettings.panningModel;
    panner.distanceModel = spatialSettings.distanceModel;
    panner.refDistance = spatialSettings.refDistance;
    panner.rolloffFactor = spatialSettings.rolloffFactor;
    panner.maxDistance = spatialSettings.maxDistance;
  }

  /**
   * 音源1つぶんの位置を実際にPannerNodeへ適用する(即時反映、スムージングあり)
   */
  function applySpatialPosition(panner, x, y, z) {
    applyPannerCharacteristics(panner);
    const pos = transformSpatialPosition(x, y, z);
    const c = getContext();
    if (panner.positionX) {
      const now = c.currentTime;
      panner.positionX.setTargetAtTime(pos.x, now, 0.15);
      panner.positionY.setTargetAtTime(pos.y, now, 0.15);
      panner.positionZ.setTargetAtTime(pos.z, now, 0.15);
    } else if (panner.setPosition) {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
  }

  /**
   * 新しいHRTF PannerNodeを作成し、基準位置(baseX/Y/Z)を設定して返す。
   * persistent=true の場合、グローバル設定変更時に自動更新される
   * (常時鳴り続ける音源のレイヤーバス向け)。
   * @param {Function} [getPositionFn] persistent時、現在の基準位置を返す関数
   *   (音源側で位置が動く場合はここで最新値を返すようにする)
   */
  function createSpatialPanner(x, y, z, persistent, getPositionFn) {
    const c = getContext();
    const panner = c.createPanner();
    applyPannerCharacteristics(panner);
    applySpatialPositionImmediate(panner, x, y, z);
    if (persistent) {
      spatialRegistry.push({ panner, getPosition: getPositionFn || (() => ({ x, y, z })) });
    }
    return panner;
  }

  function applySpatialPositionImmediate(panner, x, y, z) {
    const pos = transformSpatialPosition(x, y, z);
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else if (panner.setPosition) {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
  }

  function unregisterSpatialSource(panner) {
    const idx = spatialRegistry.findIndex((e) => e.panner === panner);
    if (idx >= 0) spatialRegistry.splice(idx, 1);
  }

  function updateAllSpatialSources() {
    spatialRegistry.forEach(({ panner, getPosition }) => {
      const p = getPosition();
      applySpatialPosition(panner, p.x, p.y, p.z);
    });
  }

  function setSpatialParam(name, value) {
    if (!(name in spatialSettings)) return;
    spatialSettings[name] = value;
    updateAllSpatialSources();
  }

  function getSpatialSettings() {
    return Object.assign({}, spatialSettings);
  }

  SoundEngine.createSpatialPanner = createSpatialPanner;
  SoundEngine.applySpatialPosition = applySpatialPosition;
  SoundEngine.unregisterSpatialSource = unregisterSpatialSource;
  SoundEngine.transformSpatialPosition = transformSpatialPosition;
  SoundEngine.setSpatialParam = setSpatialParam;
  SoundEngine.getSpatialSettings = getSpatialSettings;
  // 個別の使いやすいショートカット
  SoundEngine.setPanningModel = (v) => setSpatialParam('panningModel', v);
  SoundEngine.setDistanceModel = (v) => setSpatialParam('distanceModel', v);
  SoundEngine.setRolloffFactor = (v) => setSpatialParam('rolloffFactor', v);
  SoundEngine.setRefDistance = (v) => setSpatialParam('refDistance', v);
  SoundEngine.setMaxDistance = (v) => setSpatialParam('maxDistance', v);
  SoundEngine.setRoomScale = (v) => setSpatialParam('roomScale', v);
  SoundEngine.setSceneRotationDeg = (deg) => setSpatialParam('rotation', (deg * Math.PI) / 180);

  SoundEngine.init = init;
  SoundEngine.getContext = getContext;
  SoundEngine.getMasterGain = getMasterGain;
  SoundEngine.setMasterVolume = setMasterVolume;
  SoundEngine.getAmbientBus = getAmbientBus;
  SoundEngine.getSfxBus = getSfxBus;
  SoundEngine.setAmbientVolume = setAmbientVolume;
  SoundEngine.setSfxVolume = setSfxVolume;
  SoundEngine.getAmbientVolume = getAmbientVolume;
  SoundEngine.getSfxVolume = getSfxVolume;
  SoundEngine.setSpaciousness = setSpaciousness;
  SoundEngine.getSpaciousness = getSpaciousness;
  SoundEngine.resume = resume;
  SoundEngine.createPanner = createPanner;
  SoundEngine.createWhiteNoiseBuffer = createWhiteNoiseBuffer;
  SoundEngine.createPinkNoiseBuffer = createPinkNoiseBuffer;
  SoundEngine.createBrownNoiseBuffer = createBrownNoiseBuffer;
  SoundEngine.createNoiseSource = createNoiseSource;
  SoundEngine.createNoiseBurstBuffer = createNoiseBurstBuffer;
  SoundEngine.randomRange = randomRange;
  SoundEngine.randomChoice = randomChoice;
  SoundEngine.clamp = clamp;
})();
