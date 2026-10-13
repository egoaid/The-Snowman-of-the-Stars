/**
 * presets.js
 * 環境音ジェネレーターのプリセット管理。
 * シーン設定: 川辺の大木の下にテントを張ったキャンプ。
 *
 * 各プリセットは、雨・雷・風・川・虫・鳥・焚き火・空間表現(全体設定)の
 * 全パラメータをまとめて保持するJSONオブジェクト。
 * captureCurrentState() で現在の設定を同じ形式で取り出せるので、
 * ユーザープリセットの保存(JSON書き出し)・読み込みにも同じロジックを使う。
 */
(function () {
  'use strict';

  const BUILTIN_PRESETS = [
    {
      name: '① 春の小川と鳥のさえずり',
      rain: { enabled: false },
      thunder: { enabled: false, autoIntensity: 0, spread: 0.7 },
      wind: { enabled: true, intensity: 0.12, leavesEnabled: true, leavesAmount: 0.4, panWanderAmount: 0.4 },
      river: { enabled: true, size: 0.25, noiseFloor: 0.12, reverbAmount: 0.45, farVolume: 0.3, farRate: 6, midVolume: 0.25, midRate: 18, nearVolume: 0.3, nearRate: 34, bubbleVolume: 0.55, bubbleRate: 0.4, splashAmount: 0.25, pan: 0, stereoWidth: 0.85 },
      insects: { enabled: false, season: 'spring', density: 0.2, spread: 0.7, enabledSpecies: null },
      birds: { enabled: true, season: 'spring', density: 0.7, spread: 0.8, enabledSpecies: null },
      fire: { enabled: false, roar: 0.4, crackle: 0.4, pan: 0 },
      spatial: { spaciousness: 0.3, roomScale: 1, rotationDeg: 0, rolloffFactor: 0.3, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '② 夏の夜、虫の大合唱と焚き火',
      rain: { enabled: false },
      thunder: { enabled: false, autoIntensity: 0, spread: 0.7 },
      wind: { enabled: true, intensity: 0.08, leavesEnabled: true, leavesAmount: 0.25, panWanderAmount: 0.3 },
      river: { enabled: true, size: 0.3, noiseFloor: 0.1, reverbAmount: 0.4, farVolume: 0.3, farRate: 6, midVolume: 0.25, midRate: 18, nearVolume: 0.28, nearRate: 34, bubbleVolume: 0.45, bubbleRate: 0.35, splashAmount: 0.2, pan: 0, stereoWidth: 0.85 },
      insects: { enabled: true, season: 'summer', density: 0.85, spread: 0.9, enabledSpecies: null },
      birds: { enabled: false, season: 'summer', density: 0.3, spread: 0.7, enabledSpecies: null },
      fire: { enabled: true, roar: 0.45, crackle: 0.55, pan: 0 },
      spatial: { spaciousness: 0.35, roomScale: 1, rotationDeg: 0, rolloffFactor: 0.3, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '③ 梅雨の小雨、テントの中',
      rain: { enabled: true, intensity: 0.28, surfaceDropsEnabled: true, surfaceDropAmount: 0.6, attackDropsEnabled: false, attackDropAmount: 0.3 },
      thunder: { enabled: false, autoIntensity: 0, spread: 0.7 },
      wind: { enabled: true, intensity: 0.1, leavesEnabled: true, leavesAmount: 0.3, panWanderAmount: 0.4 },
      river: { enabled: true, size: 0.3, noiseFloor: 0.15, reverbAmount: 0.5, farVolume: 0.32, farRate: 6, midVolume: 0.27, midRate: 18, nearVolume: 0.3, nearRate: 32, bubbleVolume: 0.5, bubbleRate: 0.4, splashAmount: 0.3, pan: 0, stereoWidth: 0.85 },
      insects: { enabled: true, season: 'summer', density: 0.25, spread: 0.7, enabledSpecies: null },
      birds: { enabled: false, season: 'summer', density: 0.2, spread: 0.7, enabledSpecies: null },
      fire: { enabled: false, roar: 0.3, crackle: 0.3, pan: 0 },
      spatial: { spaciousness: 0.4, roomScale: 1, rotationDeg: 0, rolloffFactor: 0.3, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '④ 夏の夕立、激しい雷雨',
      rain: { enabled: true, intensity: 0.82, surfaceDropsEnabled: true, surfaceDropAmount: 0.85, attackDropsEnabled: true, attackDropAmount: 0.7 },
      thunder: { enabled: true, autoIntensity: 0.6, spread: 0.9 },
      wind: { enabled: true, intensity: 0.6, leavesEnabled: true, leavesAmount: 0.7, panWanderAmount: 0.8 },
      river: { enabled: true, size: 0.4, noiseFloor: 0.2, reverbAmount: 0.45, farVolume: 0.35, farRate: 5, midVolume: 0.3, midRate: 16, nearVolume: 0.32, nearRate: 30, bubbleVolume: 0.4, bubbleRate: 0.4, splashAmount: 0.4, pan: 0, stereoWidth: 0.85 },
      insects: { enabled: false, season: 'summer', density: 0.1, spread: 0.7, enabledSpecies: null },
      birds: { enabled: false, season: 'summer', density: 0, spread: 0.7, enabledSpecies: null },
      fire: { enabled: false, roar: 0.2, crackle: 0.2, pan: 0 },
      spatial: { spaciousness: 0.3, roomScale: 1.2, rotationDeg: 0, rolloffFactor: 0.35, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '⑤ 秋の虫時雨と焚き火',
      rain: { enabled: false },
      thunder: { enabled: false, autoIntensity: 0, spread: 0.7 },
      wind: { enabled: true, intensity: 0.2, leavesEnabled: true, leavesAmount: 0.6, panWanderAmount: 0.5 },
      river: { enabled: true, size: 0.25, noiseFloor: 0.12, reverbAmount: 0.45, farVolume: 0.28, farRate: 6, midVolume: 0.24, midRate: 18, nearVolume: 0.28, nearRate: 34, bubbleVolume: 0.5, bubbleRate: 0.35, splashAmount: 0.25, pan: 0, stereoWidth: 0.85 },
      insects: { enabled: true, season: 'autumn', density: 0.7, spread: 0.85, enabledSpecies: null },
      birds: { enabled: false, season: 'autumn', density: 0.2, spread: 0.7, enabledSpecies: null },
      fire: { enabled: true, roar: 0.55, crackle: 0.6, pan: 0 },
      spatial: { spaciousness: 0.35, roomScale: 1, rotationDeg: 0, rolloffFactor: 0.3, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '⑥ 台風接近、強風と大雨',
      rain: { enabled: true, intensity: 0.95, surfaceDropsEnabled: true, surfaceDropAmount: 0.9, attackDropsEnabled: true, attackDropAmount: 0.85 },
      thunder: { enabled: true, autoIntensity: 0.25, spread: 0.6 },
      wind: { enabled: true, intensity: 0.95, leavesEnabled: true, leavesAmount: 0.9, panWanderAmount: 1.0 },
      river: { enabled: true, size: 0.6, noiseFloor: 0.25, reverbAmount: 0.4, farVolume: 0.4, farRate: 4, midVolume: 0.35, midRate: 14, nearVolume: 0.35, nearRate: 26, bubbleVolume: 0.4, bubbleRate: 0.5, splashAmount: 0.55, pan: 0, stereoWidth: 0.9 },
      insects: { enabled: false, season: 'summer', density: 0, spread: 0.7, enabledSpecies: null },
      birds: { enabled: false, season: 'summer', density: 0, spread: 0.7, enabledSpecies: null },
      fire: { enabled: false, roar: 0, crackle: 0, pan: 0 },
      spatial: { spaciousness: 0.25, roomScale: 1.3, rotationDeg: 0, rolloffFactor: 0.4, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '⑦ 冬の静寂、フクロウの声',
      rain: { enabled: false },
      thunder: { enabled: false, autoIntensity: 0, spread: 0.7 },
      wind: { enabled: true, intensity: 0.18, leavesEnabled: false, leavesAmount: 0.1, panWanderAmount: 0.3 },
      river: { enabled: true, size: 0.15, noiseFloor: 0.08, reverbAmount: 0.5, farVolume: 0.2, farRate: 8, midVolume: 0.18, midRate: 22, nearVolume: 0.2, nearRate: 40, bubbleVolume: 0.4, bubbleRate: 0.2, splashAmount: 0.15, pan: 0, stereoWidth: 0.85 },
      insects: { enabled: false, season: 'winter', density: 0, spread: 0.7, enabledSpecies: null },
      birds: { enabled: true, season: 'winter', density: 0.25, spread: 0.7, enabledSpecies: null },
      fire: { enabled: false, roar: 0.3, crackle: 0.3, pan: 0 },
      spatial: { spaciousness: 0.45, roomScale: 1.1, rotationDeg: 0, rolloffFactor: 0.25, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '⑧ 大河の轟音',
      rain: { enabled: false },
      thunder: { enabled: false, autoIntensity: 0, spread: 0.7 },
      wind: { enabled: true, intensity: 0.25, leavesEnabled: true, leavesAmount: 0.4, panWanderAmount: 0.5 },
      river: { enabled: true, size: 0.95, noiseFloor: 0.25, reverbAmount: 0.5, farVolume: 0.55, farRate: 3, midVolume: 0.5, midRate: 8, nearVolume: 0.5, nearRate: 16, bubbleVolume: 0.6, bubbleRate: 0.85, splashAmount: 0.75, pan: 0, stereoWidth: 1.0 },
      insects: { enabled: true, season: 'summer', density: 0.3, spread: 0.7, enabledSpecies: null },
      birds: { enabled: false, season: 'summer', density: 0.2, spread: 0.7, enabledSpecies: null },
      fire: { enabled: false, roar: 0.3, crackle: 0.3, pan: 0 },
      spatial: { spaciousness: 0.4, roomScale: 1.4, rotationDeg: 0, rolloffFactor: 0.25, refDistance: 1.2, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '⑨ 焚き火とせせらぎの夜',
      rain: { enabled: false },
      thunder: { enabled: false, autoIntensity: 0, spread: 0.7 },
      wind: { enabled: true, intensity: 0.06, leavesEnabled: true, leavesAmount: 0.2, panWanderAmount: 0.3 },
      river: { enabled: true, size: 0.2, noiseFloor: 0.1, reverbAmount: 0.45, farVolume: 0.25, farRate: 7, midVolume: 0.22, midRate: 20, nearVolume: 0.26, nearRate: 36, bubbleVolume: 0.55, bubbleRate: 0.3, splashAmount: 0.2, pan: 0, stereoWidth: 0.85 },
      insects: { enabled: true, season: 'autumn', density: 0.3, spread: 0.7, enabledSpecies: null },
      birds: { enabled: false, season: 'autumn', density: 0.1, spread: 0.7, enabledSpecies: null },
      fire: { enabled: true, roar: 0.5, crackle: 0.65, pan: 0 },
      spatial: { spaciousness: 0.4, roomScale: 0.9, rotationDeg: 0, rolloffFactor: 0.3, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
    {
      name: '⑩ 快晴の朝、テント撤収前',
      rain: { enabled: false },
      thunder: { enabled: false, autoIntensity: 0, spread: 0.7 },
      wind: { enabled: true, intensity: 0.2, leavesEnabled: true, leavesAmount: 0.5, panWanderAmount: 0.6 },
      river: { enabled: true, size: 0.35, noiseFloor: 0.15, reverbAmount: 0.45, farVolume: 0.3, farRate: 6, midVolume: 0.27, midRate: 18, nearVolume: 0.3, nearRate: 30, bubbleVolume: 0.5, bubbleRate: 0.45, splashAmount: 0.3, pan: 0, stereoWidth: 0.85 },
      insects: { enabled: true, season: 'spring', density: 0.3, spread: 0.7, enabledSpecies: null },
      birds: { enabled: true, season: 'spring', density: 0.8, spread: 0.85, enabledSpecies: null },
      fire: { enabled: false, roar: 0.2, crackle: 0.2, pan: 0 },
      spatial: { spaciousness: 0.3, roomScale: 1, rotationDeg: 0, rolloffFactor: 0.3, refDistance: 1, panningModel: 'HRTF', distanceModel: 'inverse' },
    },
  ];

  /**
   * 現在のエンジン状態を、プリセットと同じ形式のJSON互換オブジェクトとして取り出す。
   */
  function captureCurrentState({ engines, insects, birds }) {
    const { rain, thunder, wind, river, fire } = engines;
    const spatial = SoundEngine.getSpatialSettings();
    return {
      name: 'ユーザープリセット',
      rain: {
        enabled: rain.running,
        intensity: rain.intensity,
        surfaceDropsEnabled: rain.surfaceDropsEnabled,
        surfaceDropAmount: rain.surfaceDropAmount,
        attackDropsEnabled: rain.attackDropsEnabled,
        attackDropAmount: rain.attackDropAmount,
      },
      thunder: {
        enabled: thunder.running,
        autoIntensity: thunder.autoIntensity,
        spread: thunder.spread,
      },
      wind: {
        enabled: wind.running,
        intensity: wind.intensity,
        leavesEnabled: wind.leavesEnabled,
        leavesAmount: wind.leavesAmount,
        panWanderAmount: wind.panWanderAmount,
      },
      river: {
        enabled: river.running,
        size: river._sizeRef !== undefined ? river._sizeRef : 0.4,
        noiseFloor: river.noiseFloorAmount,
        reverbAmount: river.reverbAmount,
        farVolume: river.farVolume,
        farRate: river.farRateMs,
        midVolume: river.midVolume,
        midRate: river.midRateMs,
        nearVolume: river.nearVolume,
        nearRate: river.nearRateMs,
        bubbleVolume: river.bubbleVolume,
        bubbleRate: river.bubbleRate,
        splashAmount: river.splashAmount,
        pan: river.pan,
        stereoWidth: river.stereoWidth,
      },
      insects: {
        enabled: insects.running,
        season: insects.season,
        density: insects.density,
        spread: insects.spread,
        enabledSpecies: Array.from(insects.enabledSpecies),
      },
      birds: {
        enabled: birds.running,
        season: birds.season,
        density: birds.density,
        spread: birds.spread,
        enabledSpecies: Array.from(birds.enabledSpecies),
      },
      fire: {
        enabled: fire.running,
        roar: fire.roar,
        crackle: fire.crackle,
        pan: fire.pan,
      },
      spatial: {
        spaciousness: SoundEngine.getSpaciousness(),
        roomScale: spatial.roomScale,
        rotationDeg: (spatial.rotation * 180) / Math.PI,
        rolloffFactor: spatial.rolloffFactor,
        refDistance: spatial.refDistance,
        panningModel: spatial.panningModel,
        distanceModel: spatial.distanceModel,
      },
    };
  }

  function setSlider(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    // 値表示用のspan(id + 'Val' 等の慣例)があれば更新を試みる
    const valEl = document.getElementById(id.replace(/^([a-z]+)_/, '$1') + 'Val');
    if (valEl) valEl.textContent = value;
  }

  function setCheckbox(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
  }

  /**
   * プリセットを実際のエンジンに適用する。各セクションのenabledに応じて
   * start()/stop()を呼び、パラメータをすべて反映する。スライダーのUI表示も
   * できる範囲で同期する。
   */
  function applyPreset(preset, { engines, insects, birds }) {
    const { rain, thunder, wind, river, fire } = engines;

    // --- 雨 ---
    if (preset.rain) {
      const p = preset.rain;
      if (p.enabled && !rain.running) rain.start();
      if (!p.enabled && rain.running) rain.stop();
      if (p.intensity !== undefined) { rain.setIntensity(p.intensity); setSlider('rain_intensity', p.intensity); }
      if (p.surfaceDropsEnabled !== undefined) { rain.setSurfaceDrops(p.surfaceDropsEnabled); setCheckbox('rain_surfaceEnabled', p.surfaceDropsEnabled); }
      if (p.surfaceDropAmount !== undefined) { rain.setSurfaceDropAmount(p.surfaceDropAmount); setSlider('rain_surfaceAmount', p.surfaceDropAmount); }
      if (p.attackDropsEnabled !== undefined) { rain.setAttackDrops(p.attackDropsEnabled); setCheckbox('rain_attackEnabled', p.attackDropsEnabled); }
      if (p.attackDropAmount !== undefined) { rain.setAttackDropAmount(p.attackDropAmount); setSlider('rain_attackAmount', p.attackDropAmount); }
    }

    // --- 雷鳴 ---
    if (preset.thunder) {
      const p = preset.thunder;
      if (p.enabled && !thunder.running) thunder.start();
      if (!p.enabled && thunder.running) thunder.stop();
      if (p.autoIntensity !== undefined) { thunder.setAutoIntensity(p.autoIntensity); setSlider('thunder_auto', p.autoIntensity); }
      if (p.spread !== undefined) { thunder.setSpread(p.spread); setSlider('thunder_spread', p.spread); }
    }

    // --- 風 ---
    if (preset.wind) {
      const p = preset.wind;
      if (p.enabled && !wind.running) wind.start();
      if (!p.enabled && wind.running) wind.stop();
      if (p.intensity !== undefined) { wind.setIntensity(p.intensity); setSlider('wind_intensity', p.intensity); }
      if (p.leavesEnabled !== undefined) { wind.setLeaves(p.leavesEnabled); setCheckbox('wind_leavesEnabled', p.leavesEnabled); }
      if (p.leavesAmount !== undefined) { wind.setLeavesAmount(p.leavesAmount); setSlider('wind_leavesAmount', p.leavesAmount); }
      if (p.panWanderAmount !== undefined) { wind.setPanWanderAmount(p.panWanderAmount); setSlider('wind_wander', p.panWanderAmount); }
    }

    // --- 川 ---
    if (preset.river) {
      const p = preset.river;
      if (p.enabled && !river.running) river.start();
      if (!p.enabled && river.running) river.stop();
      if (p.size !== undefined) { river.setSize(p.size); setSlider('river_size', p.size); }
      if (p.noiseFloor !== undefined) { river.setNoiseFloor(p.noiseFloor); setSlider('river_noiseFloor', p.noiseFloor); }
      if (p.reverbAmount !== undefined) { river.setReverbAmount(p.reverbAmount); setSlider('river_reverb', p.reverbAmount); }
      if (p.farVolume !== undefined) { river.setFarVolume(p.farVolume); setSlider('river_farVol', p.farVolume); }
      if (p.farRate !== undefined) { river.setFarRate(p.farRate); setSlider('river_farRate', p.farRate); }
      if (p.midVolume !== undefined) { river.setMidVolume(p.midVolume); setSlider('river_midVol', p.midVolume); }
      if (p.midRate !== undefined) { river.setMidRate(p.midRate); setSlider('river_midRate', p.midRate); }
      if (p.nearVolume !== undefined) { river.setNearVolume(p.nearVolume); setSlider('river_nearVol', p.nearVolume); }
      if (p.nearRate !== undefined) { river.setNearRate(p.nearRate); setSlider('river_nearRate', p.nearRate); }
      if (p.bubbleVolume !== undefined) { river.setBubbleVolume(p.bubbleVolume); setSlider('river_bubbleVol', p.bubbleVolume); }
      if (p.bubbleRate !== undefined) { river.setBubbleRate(p.bubbleRate); setSlider('river_bubbleRate', p.bubbleRate); }
      if (p.splashAmount !== undefined) { river.setSplashAmount(p.splashAmount); setSlider('river_splash', p.splashAmount); }
      if (p.pan !== undefined) { river.setPan(p.pan); setSlider('river_pan', p.pan); }
      if (p.stereoWidth !== undefined) { river.setStereoWidth(p.stereoWidth); setSlider('river_width', p.stereoWidth); }
    }

    // --- 虫 ---
    if (preset.insects) {
      const p = preset.insects;
      if (p.enabled && !insects.running) insects.start();
      if (!p.enabled && insects.running) insects.stop();
      if (p.season) { insects.setSeason(p.season); document.getElementById('insects_season').value = p.season; }
      if (p.density !== undefined) { insects.setDensity(p.density); setSlider('insects_density', p.density); }
      if (p.spread !== undefined) { insects.setSpread(p.spread); setSlider('insects_spread', p.spread); }
      if (p.enabledSpecies) {
        Object.keys(SoundEngine.Insects.SPECIES).forEach((k) => {
          insects.setSpeciesEnabled(k, p.enabledSpecies.includes(k));
        });
      }
    }

    // --- 鳥 ---
    if (preset.birds) {
      const p = preset.birds;
      if (p.enabled && !birds.running) birds.start();
      if (!p.enabled && birds.running) birds.stop();
      if (p.season) { birds.setSeason(p.season); document.getElementById('birds_season').value = p.season; }
      if (p.density !== undefined) { birds.setDensity(p.density); setSlider('birds_density', p.density); }
      if (p.spread !== undefined) { birds.setSpread(p.spread); setSlider('birds_spread', p.spread); }
      if (p.enabledSpecies) {
        Object.keys(SoundEngine.Birds.SPECIES).forEach((k) => {
          birds.setSpeciesEnabled(k, p.enabledSpecies.includes(k));
        });
      }
    }

    // --- 焚き火 ---
    if (preset.fire) {
      const p = preset.fire;
      if (p.enabled && !fire.running) fire.start();
      if (!p.enabled && fire.running) fire.stop();
      if (p.roar !== undefined) { fire.setRoar(p.roar); setSlider('fire_roar', p.roar); }
      if (p.crackle !== undefined) { fire.setCrackle(p.crackle); setSlider('fire_crackle', p.crackle); }
      if (p.pan !== undefined) { fire.setPan(p.pan); setSlider('fire_pan', p.pan); }
    }

    // --- 空間表現 ---
    if (preset.spatial) {
      const p = preset.spatial;
      if (p.spaciousness !== undefined) { SoundEngine.setSpaciousness(p.spaciousness); setSlider('space_reverb', p.spaciousness); }
      if (p.roomScale !== undefined) { SoundEngine.setRoomScale(p.roomScale); setSlider('space_room', p.roomScale); }
      if (p.rotationDeg !== undefined) { SoundEngine.setSceneRotationDeg(p.rotationDeg); setSlider('space_rotation', p.rotationDeg); }
      if (p.rolloffFactor !== undefined) { SoundEngine.setRolloffFactor(p.rolloffFactor); setSlider('space_rolloff', p.rolloffFactor); }
      if (p.refDistance !== undefined) { SoundEngine.setRefDistance(p.refDistance); setSlider('space_refdist', p.refDistance); }
      if (p.panningModel) { SoundEngine.setPanningModel(p.panningModel); document.getElementById('space_panningModel').value = p.panningModel; }
      if (p.distanceModel) { SoundEngine.setDistanceModel(p.distanceModel); document.getElementById('space_distanceModel').value = p.distanceModel; }
    }
  }

  window.AmbientPresets = { BUILTIN_PRESETS, captureCurrentState, applyPreset };
})();
