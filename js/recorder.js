/**
 * recorder.js
 * 現在鳴っている音(マスター出力)をキャプチャし、WAVファイルとして
 * ダウンロードできるようにする。MediaRecorderはwebm/ogg等の圧縮形式になり
 * 「WAVで」という要望に合わないため、ScriptProcessorNodeで生のPCMサンプルを
 * 直接取得し、自前でWAVヘッダを書き出す方式にしている。
 *
 * 録音中はマスター出力を「無音のゲイン」経由でも destination に繋ぐ
 * (Web Audioの仕様上、ScriptProcessorNodeはdestinationまで接続されていないと
 * onaudioprocessが発火しないブラウザがあるため)。これにより音量が変わったり
 * 二重に聞こえたりすることはない。
 */
(function () {
  'use strict';

  let scriptNode = null;
  let silentGain = null;
  let recordedChunksL = [];
  let recordedChunksR = [];
  let totalSamples = 0;
  let isRecording = false;
  let startTime = 0;
  let timerInterval = null;

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function updateDisplay() {
    const elapsed = (performance.now() - startTime) / 1000;
    const bytes = totalSamples * 2 /* 16bit */ * 2 /* stereo */ + 44;
    const timeEl = document.getElementById('recordTime');
    const sizeEl = document.getElementById('recordSize');
    if (timeEl) timeEl.textContent = formatTime(elapsed);
    if (sizeEl) sizeEl.textContent = formatSize(bytes);
  }

  /**
   * Float32の左右チャンネル配列から16bit PCM WAV形式のBlobを作成する。
   */
  function encodeWAV(left, right, sampleRate) {
    const numFrames = left.length;
    const numChannels = 2;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    function floatTo16BitPCM(offset, input) {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // インターリーブして書き込み
    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true); offset += 2;
      view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true); offset += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  async function startRecording() {
    if (isRecording) return;
    await SoundEngine.resume();
    const ctx = SoundEngine.getContext();
    const master = SoundEngine.getMasterGain();

    recordedChunksL = [];
    recordedChunksR = [];
    totalSamples = 0;

    const bufferSize = 4096;
    scriptNode = ctx.createScriptProcessor(bufferSize, 2, 2);
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    master.connect(scriptNode);
    scriptNode.connect(silentGain);
    silentGain.connect(ctx.destination);

    scriptNode.onaudioprocess = (e) => {
      const inputL = e.inputBuffer.getChannelData(0);
      const inputR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inputL;
      recordedChunksL.push(inputL.slice());
      recordedChunksR.push(inputR.slice());
      totalSamples += inputL.length;
    };

    isRecording = true;
    startTime = performance.now();
    timerInterval = setInterval(updateDisplay, 250);

    const btn = document.getElementById('recordBtn');
    if (btn) btn.textContent = '録音停止 & ダウンロード';
    const block = document.getElementById('recordBlock');
    if (block) block.classList.add('active');
  }

  function stopRecordingAndDownload() {
    if (!isRecording) return;
    isRecording = false;
    clearInterval(timerInterval);

    try {
      const master = SoundEngine.getMasterGain();
      master.disconnect(scriptNode);
      scriptNode.disconnect();
      silentGain.disconnect();
    } catch (e) {}

    const ctx = SoundEngine.getContext();
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);
    let offset = 0;
    for (let i = 0; i < recordedChunksL.length; i++) {
      left.set(recordedChunksL[i], offset);
      right.set(recordedChunksR[i], offset);
      offset += recordedChunksL[i].length;
    }

    const blob = encodeWAV(left, right, ctx.sampleRate);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const filename = `ambient-recording-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.wav`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    const btn = document.getElementById('recordBtn');
    if (btn) btn.textContent = '録音開始';
    const block = document.getElementById('recordBlock');
    if (block) block.classList.remove('active');

    recordedChunksL = [];
    recordedChunksR = [];
    totalSamples = 0;
    document.getElementById('recordTime').textContent = '00:00';
    document.getElementById('recordSize').textContent = '0 KB';
  }

  window.toggleRecording = function () {
    if (isRecording) {
      stopRecordingAndDownload();
    } else {
      startRecording();
    }
  };
})();
