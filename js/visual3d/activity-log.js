// activity-log.js (v1.80)
// 雪だるまの「活動ログ」。歩いた経路と、出来事(行き先の決定・拾う・落とし物・座る/寝る・はまり/脱出・川を渡る…)を、
// シミュレーション上の秒数(早送りでも実時間でもない、ゲーム内で進んだ秒数)で記録して、あとで解析できるようにする。
//   ・軌跡: 1秒ごとに [t, x, z, 行動, 水際までの距離, 昼夜, 天気]
//   ・出来事: {t, kind, x, z, ...}
//   ・最大 maxSamples / maxEvents 件(古いものから捨てる)。メモリは小さく、ゲームの動作には影響しない(失敗は握りつぶす)。
//   ・管理者だけが、JSON / CSV で書き出せる(scene3d.js 経由)。three.js には依存しない(Nodeで試験できる)。
export const SAMPLE_COLUMNS = ['t', 'x', 'z', 'act', 'edge', 'night', 'weather'];

export function createActivityLog({ maxSamples = 20000, maxEvents = 8000, version = '', sampleEverySec = 1 } = {}) {
  const samples = [];
  const events = [];
  let simT = 0, nextSample = 0, enabled = true, seq = 0;

  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

  return {
    setEnabled(v) { enabled = !!v; },
    isEnabled: () => enabled,
    /** 毎フレーム: 経過時間を進めて、1秒ごとに軌跡を1行足す。state() は、必要な時だけ呼ぶ(軽くするため)。 */
    tick(dt, state) {
      simT += dt;
      if (!enabled || simT < nextSample) return;
      nextSample += sampleEverySec; if (nextSample < simT) nextSample = simT; // 1秒ごと(ずれを溜めない)
      try {
        const s = state();
        samples.push([r1(simT), r2(s.x), r2(s.z), s.act, r1(s.edge), s.night ? 1 : 0, s.weather || '']);
        if (samples.length > maxSamples) samples.shift();
      } catch (e) { /* ログの失敗は握りつぶす */ }
    },
    /** 出来事を足す。pos があれば x,z も記録。 */
    event(kind, data = {}) {
      if (!enabled) return;
      try {
        const e = { ...data, n: ++seq, t: r1(simT), kind }; // 出来事の名前(kind)を、データで上書きさせない
        if (Number.isFinite(e.x)) e.x = r2(e.x);
        if (Number.isFinite(e.z)) e.z = r2(e.z);
        events.push(e);
        if (events.length > maxEvents) events.shift();
      } catch (e) { /* 同上 */ }
    },
    now: () => simT,
    clear() { samples.length = 0; events.length = 0; simT = 0; nextSample = 0; seq = 0; },
    sizes: () => ({ samples: samples.length, events: events.length, simSeconds: r1(simT) }),
    toObject(extra = {}) {
      return { app: 'The Snowman of the Stars', version, kind: 'activity-log', simSeconds: r1(simT), columns: SAMPLE_COLUMNS, samples, events, ...extra };
    },
    /** CSV(軌跡) と CSV(出来事) を、文字列で返す。 */
    toCSV() {
      const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const trackCsv = [SAMPLE_COLUMNS.join(',')].concat(samples.map((r) => r.map(q).join(','))).join('\n');
      const keys = ['n', 't', 'kind', 'x', 'z'];
      for (const e of events) for (const k of Object.keys(e)) if (!keys.includes(k)) keys.push(k);
      const eventCsv = [keys.join(',')].concat(events.map((e) => keys.map((k) => q(e[k])).join(','))).join('\n');
      return { track: trackCsv, events: eventCsv };
    },
    /** ブラウザで、JSONとCSVをダウンロードする(管理者用)。ファイル名の配列を返す。 */
    download(format = 'json', extra = {}) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const base = `snowman-activity-v${version}-${ts}`;
      const files = [];
      const save = (name, text, type) => {
        const blob = new Blob([text], { type });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        files.push(name);
      };
      if (format === 'csv') { const c = this.toCSV(); save(`${base}-track.csv`, c.track, 'text/csv'); save(`${base}-events.csv`, c.events, 'text/csv'); }
      else save(`${base}.json`, JSON.stringify(this.toObject(extra)), 'application/json');
      return files;
    },
  };
}
