// falling-star.js
// 「落ちてくる星」の環境イベント(v1.38)。
//
// 約4分に1回(夜のあいだ)、空から星が地上へ落ちてきて、地面に残る(v1.54: 数十秒→15〜25分。同時に最大5つ)。
// ゲームの報酬やクエストではなく、この世界でときどき起きる出来事として扱う。
// プレイヤーが近づくと自動で回収され、ポーチへ入る。見守り中の雪だるまは、近づいて眺め、拾うかどうかを自分で決める
// (collect() で取り除く。ポーチへの出し入れはscene3d側)。
//
// 軽さのための方針:
// - パーティクルシステムは使わない。星本体(押し出し形状1つ)・光の玉(Sprite1つ)・
//   短い尾(Sprite 6つ)・PointLight 1つだけで、イベントの無い間は非表示。
// - PointLightは作成時に1度だけシーンへ追加し、イベントの無い間はintensityを0にする
//   (ライトの数が変わるとThree.jsが全マテリアルのシェーダーを作り直して
//    フレームが止まるため、追加・削除はしない)。
// - タイマーはフレームのdelta(アプリが動いていた時間)の積算で、ページの再読み込みや
//   時計時刻には依存しない。間隔・確率・大きさはすべて js/config.js で調整できる。
//
// 音は、このモジュールが hooks(onFallStart/onLanded/onRing/onCollected/onExpired)を
// 呼ぶだけで、鳴らす処理自体はscene3d.js側(SoundEngine.StarBells)が担当する。

import * as THREE from 'three';
import { createStarGeometry } from './snowman.js';
import { FALLING_STAR } from '../config.js';

const TRAIL_COUNT = 6;

/** 地上の星の光のゆらぎ(0.7〜1.0程度)。ゆっくり、やさしく揺れる。 */
export function flickerAt(t) {
  return 0.86 + 0.09 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 4.3 + 1.1);
}

/**
 * 着地点を選ぶ(純粋な関数。地形・障害物・川などの判定は呼び出し側の関数を使う。
 * 新しい配置ロジックは作らず、scene3d.jsが既に持っている collisionObstacles・
 * distanceToRiver・terrainHeightAt・getClimbBump をそのまま渡す)。
 *
 * @param {object} d
 * @param {() => number} d.rng
 * @param {number} d.playableRadius
 * @param {{x:number,z:number}} d.player
 * @param {{x:number,z:number,radius:number}[]} d.obstacles
 * @param {(x:number,z:number)=>{distance:number,width:number}} d.riverInfo
 * @param {(width:number)=>number} d.waterEdge - 川の中心線から水際までの距離
 * @param {(x:number,z:number)=>number} d.heightAt
 * @param {(x:number,z:number)=>number} [d.climbBump] - 岩の上などで>0
 * @param {(x:number,z:number)=>boolean} [d.extraReject]
 * @param {object} [d.cfg] - FALLING_STAR.landing相当
 * @returns {{x:number,z:number}|null}
 */
export function pickStarLandingSpot(d) {
  const cfg = d.cfg || FALLING_STAR.landing;
  const maxR = d.playableRadius - cfg.edgeMargin;
  for (let attempt = 0; attempt < 80; attempt++) {
    const ang = d.rng() * Math.PI * 2;
    const r = Math.sqrt(d.rng()) * maxR;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const pd = Math.hypot(x - d.player.x, z - d.player.z);
    if (pd < cfg.minFromPlayer || pd > cfg.maxFromPlayer) continue;
    let blocked = false;
    for (const o of d.obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.radius + cfg.obstacleMargin) { blocked = true; break; }
    }
    if (blocked) continue;
    const { distance, width } = d.riverInfo(x, z);
    if (distance < d.waterEdge(width) + cfg.waterMargin) continue;
    // 急斜面(のぼれない地形)を避ける: 周囲1.5mの4点との高低差
    const h0 = d.heightAt(x, z);
    let steep = false;
    for (const [ox, oz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
      if (Math.abs(d.heightAt(x + ox, z + oz) - h0) > 0.9) { steep = true; break; }
    }
    if (steep) continue;
    if (d.climbBump && d.climbBump(x, z) > 0.02) continue; // 岩の上
    if (d.extraReject && d.extraReject(x, z)) continue;
    return { x, z };
  }
  return null;
}

function makeGlowTexture(stops) {
  const S = stops || [[255, 244, 200], [255, 226, 140], [255, 210, 100]]; // 星の光(暖かい黄)。月の石は kit.glowStops で青白くする(v1.69)
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${S[0].join(',')},1)`);
  grad.addColorStop(0.25, `rgba(${S[1].join(',')},0.55)`);
  grad.addColorStop(1, `rgba(${S[2].join(',')},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 複数の星を同時に地上へ残せる。1つ1つは独立した見た目(メッシュ・光の玉・尾)を持ち、PointLightだけは
 * 全体で1つ(プレイヤーに最も近い地上の星、または落下中の星に付いて動く)。ライトの数は変えない。
 *
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(x:number,z:number)=>number} o.terrainHeightAt
 * @param {() => number} [o.snowDepth] v1.56-H4: 雪の深さ(m)。雪が積もっている間、星は雪面の上に落ちる
 * @param {(playerX:number,playerZ:number)=>({x:number,z:number}|null)} o.pickLandingSpot
 * @param {object} [o.config] - FALLING_STAR
 * @param {{intervalSec:number,firstDelaySec:number,lifetimeSec:number[]}|null} [o.testMode]
 * @param {() => number} [o.rng]
 * @param {object} [o.hooks] onFallStart/onLanded/onRing/onCollected/onExpired(引数は星の情報 info)/onTaken(見守りが拾った時)
 */
export function createFallingStarSystem(o) {
  const cfg = o.config || FALLING_STAR;
  const rng = o.rng || Math.random;
  const hooks = o.hooks || {};
  const testMode = o.testMode || null;
  const maxStars = Math.max(1, cfg.maxStars || 1);
  // v1.69: 月の石でも使えるよう、形・色を差し替えられる(kit)。省略すれば従来どおりの星。
  const kit = o.kit || {};
  const kitColors = kit.colors || {};
  const liveCount = () => stars.filter((s) => !s.buried).length; // 地面に埋まっている物は、同時に降る数の上限に数えない

  const glowTex = typeof document !== 'undefined' ? makeGlowTexture(kit.glowStops) : null;

  // 作成時に1度だけ追加し、以後は追加・削除しない(intensityだけ動かす)
  const light = new THREE.PointLight(kitColors.light ?? 0xffe0a0, 0, cfg.lightDistance, 2);
  o.scene.add(light);

  let nextId = 1;
  const pool = []; // 見た目の使い回し
  const stars = []; // いま世界にある星(落下中・地上)

  function makeVisual() {
    const group = new THREE.Group();
    group.visible = false;
    o.scene.add(group);
    const starMat = new THREE.MeshBasicMaterial({ color: kitColors.stone ?? 0xffe27a, transparent: true, fog: false });
    const starMesh = new THREE.Mesh(kit.createGeometry ? kit.createGeometry(cfg.groundRadius) : createStarGeometry(cfg.groundRadius), starMat);
    group.add(starMesh);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, color: kitColors.glow ?? 0xffe9a8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const glow = new THREE.Sprite(glowMat);
    group.add(glow);
    const trail = [];
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const m = new THREE.SpriteMaterial({
        map: glowTex, color: kitColors.trail ?? 0xffeeb8, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const sp = new THREE.Sprite(m);
      trail.push(sp);
      group.add(sp);
    }
    return { group, starMat, starMesh, glowMat, glow, trail };
  }
  function acquireVisual() {
    const v = pool.pop() || makeVisual();
    v.group.visible = true;
    return v;
  }
  function releaseVisual(v) {
    v.group.visible = false;
    v.trail.forEach((s) => { s.material.opacity = 0; });
    pool.push(v);
  }

  const S = { countdown: 0 };
  const between = (arr) => arr[0] + rng() * (arr[1] - arr[0]);
  let lastPlayer = { x: 0, z: 0 };

  function scheduleNext(first) {
    if (testMode) {
      S.countdown = first ? testMode.firstDelaySec : testMode.intervalSec;
      return;
    }
    const base = cfg.intervalSec;
    S.countdown = first
      ? base * between(cfg.firstDelayFactor)
      : base * (1 + cfg.intervalJitter * (rng() * 2 - 1));
  }
  scheduleNext(true);

  // v1.56-H4: 雪が積もっている時は、星は雪面の上に落ちて、少し埋まった高さ(雪面+0.1m)に浮かぶ。雪が無ければ従来どおり地面+0.5m。
  //   o.snowDepth() は雪の深さ(m、無ければ0)。雪が増減しても、星は雪面に追従する。
  const landedY = (st) => {
    const d = o.snowDepth ? o.snowDepth() : 0;
    // v1.69: 地面に埋まっている物(buried)は、地面すれすれ(cfg.buriedSink)。雪があれば、雪面からわずかに出る
    if (st.buried) return o.terrainHeightAt(st.spotX, st.spotZ) + (d > 0 ? d + 0.02 : (cfg.buriedSink ?? 0.1));
    return o.terrainHeightAt(st.spotX, st.spotZ) + (d > 0 ? d + 0.1 : 0.5);
  };
  const infoOf = (st) => ({
    id: st.id, phase: st.phase,
    x: st.phase === 'falling' ? st.pos.x : st.spotX,
    y: st.pos.y,
    z: st.phase === 'falling' ? st.pos.z : st.spotZ,
    spotX: st.spotX, spotZ: st.spotZ,
    remaining: st.phase === 'landed' ? st.lifetime - st.t : Infinity,
    age: st.t,
  });
  function setAlpha(st, a) { st.vis.starMat.opacity = a; st.vis.glowMat.opacity = 0.6 * a; }

  function spawn(player) {
    const spot = o.pickLandingSpot(player.x, player.z);
    if (!spot) { S.countdown = 30; return false; } // 条件に合う場所が無ければ少し後で再挑戦
    // 地上の星が上限なら、いちばん古い星を静かに消し始める(新しい星の場所を空ける)
    if (liveCount() >= maxStars) {
      const oldest = stars.filter((x) => x.phase === 'landed').sort((a, b) => b.t - a.t)[0];
      if (oldest) oldest.lifetime = Math.min(oldest.lifetime, oldest.t + cfg.fadeOutSec);
      if (liveCount() >= maxStars + 1) { S.countdown = 15; return false; }
    }
    const st = {
      id: nextId++, phase: 'falling', t: 0, lifetime: 0, ringTimer: 0,
      start: new THREE.Vector3(), land: new THREE.Vector3(), pos: new THREE.Vector3(),
      spotX: spot.x, spotZ: spot.z, vis: acquireVisual(),
    };
    st.land.set(spot.x, landedY(st), spot.z);
    const dirA = rng() * Math.PI * 2;
    st.start.set(spot.x + Math.cos(dirA) * 70, st.land.y + 62, spot.z + Math.sin(dirA) * 70);
    st.vis.starMesh.scale.setScalar(0.6);
    setAlpha(st, 1);
    stars.push(st);
    scheduleNext(false);
    if (hooks.onFallStart) hooks.onFallStart(infoOf(st));
    return true;
  }

  function remove(st, kind) {
    const i = stars.indexOf(st);
    if (i >= 0) stars.splice(i, 1);
    releaseVisual(st.vis);
    const info = infoOf(st);
    if (kind === 'collected' && hooks.onCollected) hooks.onCollected(info);
    else if (kind === 'taken' && hooks.onTaken) hooks.onTaken(info);
    else if (kind === 'expired' && hooks.onExpired) hooks.onExpired(info);
  }

  const TMP = new THREE.Vector3();
  function fallPosition(st, u, out) {
    // だんだん速くなりながら、少し弧を描いて落ちる
    const e = Math.pow(Math.min(1, Math.max(0, u)), 1.5);
    out.lerpVectors(st.start, st.land, e);
    out.y += Math.sin(Math.PI * Math.min(1, u)) * 2.5; // ふわっと膨らむ弧
    return out;
  }

  /** 1つの星を進める。戻り値: {a, f}(地上の星の明るさの目安。ライト用)かnull。 */
  function updateStar(st, dt, ctx) {
    st.t += dt;
    const v = st.vis;
    if (st.phase === 'falling') {
      const u = st.t / cfg.fallDurationSec;
      fallPosition(st, u, st.pos);
      v.group.position.copy(st.pos);
      v.starMesh.rotation.y += dt * 5;
      const s = 2.0 + Math.sin(st.t * 18) * 0.15;
      v.glow.scale.set(s, s, 1);
      for (let i = 0; i < TRAIL_COUNT; i++) {
        fallPosition(st, u - (i + 1) * 0.022, TMP);
        v.trail[i].position.copy(TMP).sub(st.pos);
        const ts = 1.5 * (1 - i / (TRAIL_COUNT + 1));
        v.trail[i].scale.set(ts, ts, 1);
        v.trail[i].material.opacity = 0.5 * (1 - i / TRAIL_COUNT) * (u > 0.02 ? 1 : 0);
      }
      if (u >= 1) {
        st.phase = 'landed';
        st.t = 0;
        st.lifetime = testMode ? between(testMode.lifetimeSec) : between(cfg.lifetimeSec);
        st.ringTimer = 2.5;
        v.trail.forEach((sp) => { sp.material.opacity = 0; });
        if (hooks.onLanded) hooks.onLanded(infoOf(st));
      }
      return { a: 0.5 / Math.max(cfg.lightIntensity, 0.01), f: 1, falling: true };
    }

    // --- 地上 ---
    const fadeIn = Math.min(1, st.t / 0.8);
    const remaining = st.lifetime - st.t;
    const fadeOut = Math.min(1, Math.max(0, remaining / cfg.fadeOutSec));
    const a = fadeIn * fadeOut;
    const f = flickerAt(st.t + st.id * 1.7); // 星ごとに揺れ方をずらす
    const bob = Math.sin(st.t * 1.3 + st.id) * 0.07;
    st.pos.set(st.spotX, landedY(st) + bob, st.spotZ);
    v.group.position.copy(st.pos);
    if (!st.buried) v.starMesh.rotation.y += dt * 0.7; // 埋まっている物は回らない(v1.69)
    v.starMesh.scale.setScalar((0.6 + 0.4 * fadeIn) * (0.96 + 0.06 * f));
    setAlpha(st, a * (0.9 + 0.1 * f));
    const gs = 2.6 * (0.9 + 0.2 * f) * (0.5 + 0.5 * fadeIn);
    v.glow.scale.set(gs, gs, 1);
    st.alpha = a; st.flicker = f;
    return { a, f, falling: false };
  }

  /**
   * @param {number} delta
   * @param {{playerX:number, playerZ:number, canCollect:boolean, isNight?:boolean}} ctx
   */
  function update(delta, ctx) {
    const dt = Math.min(Math.max(delta, 0), 0.5);
    lastPlayer = { x: ctx.playerX, z: ctx.playerZ };
    // 新しい星までの数えは、夜のあいだだけ進む(昼は止まる)。確認用のテスト設定中は時刻を問わない。
    const counting = testMode || !cfg.nightOnly || ctx.isNight !== false;
    if (counting) S.countdown -= dt;
    if (S.countdown <= 0 && counting) spawn({ x: ctx.playerX, z: ctx.playerZ });

    let lightStar = null, lightState = null, bestD = Infinity;
    let collectedThisFrame = false; // 1コマに回収するのは1つだけ(近くに何個あっても、1つずつ)
    for (const st of stars.slice()) {
      const r = updateStar(st, dt, ctx);
      if (st.phase === 'landed') {
        st.ringTimer -= dt;
        const remaining = st.lifetime - st.t;
        // 余韻の鈴は、いちばん近い星だけ(複数が同時に鳴らないように、あとで間引く)
        if (st.ringTimer <= 0) {
          st.ringTimer = between(cfg.ringIntervalSec);
          if (hooks.onRing && st.alpha > 0.3 && st === nearestLanded()) hooks.onRing(infoOf(st));
        }
        if (ctx.canCollect && !collectedThisFrame && st.t > 0.8 && remaining > cfg.fadeOutSec * 0.05) {
          if (Math.hypot(ctx.playerX - st.spotX, ctx.playerZ - st.spotZ) < cfg.collectRadius) { collectedThisFrame = true; remove(st, 'collected'); continue; }
        }
        if (remaining <= 0) { remove(st, 'expired'); continue; }
      }
      // ライトを付ける星: 落下中の星を優先、無ければプレイヤーに最も近い地上の星
      const d = Math.hypot(st.pos.x - ctx.playerX, st.pos.z - ctx.playerZ);
      const score = r.falling ? -1 : d;
      if (score < bestD) { bestD = score; lightStar = st; lightState = r; }
    }
    if (lightStar) {
      light.position.set(lightStar.phase === 'falling' ? lightStar.pos.x : lightStar.spotX, lightStar.pos.y + (lightStar.phase === 'falling' ? 0 : 0.6), lightStar.phase === 'falling' ? lightStar.pos.z : lightStar.spotZ);
      light.intensity = lightStar.phase === 'falling' ? 0.5 : cfg.lightIntensity * lightState.f * lightState.a;
    } else {
      light.intensity = 0;
    }
  }

  function nearestLanded() {
    let best = null, bd = Infinity;
    for (const st of stars) {
      if (st.phase !== 'landed') continue;
      const d = Math.hypot(st.spotX - lastPlayer.x, st.spotZ - lastPlayer.z);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  return {
    update,
    /** 音・見守りの気づき用の「いま注目する星」: 落下中があればそれ、無ければ最も近い地上の星。無ければnull。 */
    getActive() {
      const falling = stars.find((x) => x.phase === 'falling');
      const st = falling || nearestLanded();
      return st ? infoOf(st) : null;
    },
    /** 地上にある星の一覧(拾える物の探索用)。消え始めている星は含めない。 */
    getLanded() {
      return stars.filter((x) => x.phase === 'landed' && x.t > 0.8 && x.lifetime - x.t > cfg.fadeOutSec).map(infoOf);
    },
    isLanded: () => stars.some((x) => x.phase === 'landed'),
    count: () => stars.length,
    /** 見守りの雪だるまが拾った時など、外から取り除く(onTakenを呼ぶ)。取り除けたらtrue。 */
    take(id) {
      const st = stars.find((x) => x.id === id && x.phase === 'landed');
      if (!st) return false;
      remove(st, 'taken');
      return true;
    },
    /** 開発用: 今すぐ落とす(コンソールから。通常のUIには出さない)。 */
    trigger(player) { return spawn(player); },
    /**
     * v1.69: 地面に埋まっている物(月の石)を、指定の場所に置く。落下はせず、消えず、拾われるまでずっと残る。
     * @returns {number} id
     */
    plantBuried(x, z) {
      const st = {
        id: nextId++, phase: 'landed', t: 1, lifetime: Infinity, ringTimer: 1e9, buried: true,
        start: new THREE.Vector3(), land: new THREE.Vector3(), pos: new THREE.Vector3(),
        spotX: x, spotZ: z, vis: acquireVisual(),
      };
      st.pos.set(x, landedY(st), z); st.vis.starMesh.scale.setScalar(1); setAlpha(st, 1);
      st.vis.starMesh.rotation.y = (x * 12.9898 + z * 78.233) % (Math.PI * 2); // 向きは場所ごとにばらばら
      stars.push(st);
      return st.id;
    },
    /** 開発・検証用: 落下を省いて、指定の場所に地上の星をすぐ置く。 */
    debugPlant(x, z) {
      const st = {
        id: nextId++, phase: 'landed', t: 1, lifetime: 1500, ringTimer: 4,
        start: new THREE.Vector3(), land: new THREE.Vector3(), pos: new THREE.Vector3(),
        spotX: x, spotZ: z, vis: acquireVisual(),
      };
      st.pos.set(x, landedY(st), z); st.vis.starMesh.scale.setScalar(1); setAlpha(st, 1);
      stars.push(st);
      return st.id;
    },
    getCountdown: () => S.countdown,
    getPhase: () => (stars.some((x) => x.phase === 'falling') ? 'falling' : stars.length ? 'landed' : 'idle'),
    dispose() {
      for (const st of stars) { o.scene.remove(st.vis.group); }
      for (const v of pool.concat(stars.map((x) => x.vis))) {
        o.scene.remove(v.group);
        v.starMat.dispose(); v.glowMat.dispose(); v.trail.forEach((s) => s.material.dispose());
      }
      o.scene.remove(light);
      light.dispose();
    },
  };
}
