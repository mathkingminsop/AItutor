import { LiveSession, base64ToInt16 } from './live.js';
import { ScreenSampler } from './screen.js';
import { LatencyTracker } from './latency.js';

const $ = (id) => document.getElementById(id);
const ui = {
  start: $('start'), share: $('share'), stop: $('stop'), status: $('status'),
  transcript: $('transcript'), preview: $('preview'),
  latLast: $('lat-last'), latP50: $('lat-p50'), latOk: $('lat-ok'),
  elapsed: $('elapsed'), reconnects: $('reconnects'), frames: $('frames'),
};

const sessionId = crypto.randomUUID().slice(0, 8);
let live, micCtx, micStream, playCtx, playNode, sampler, startedAt, clock;
let modelPlaying = false;
const latency = new LatencyTracker();

function setStatus(text) { ui.status.textContent = text; }

function metric(kind, value = null, detail = null) {
  fetch('/api/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, kind, value, detail }),
    keepalive: true,
  }).catch(() => {});
}

// 같은 화자의 전사 조각은 한 말풍선에 이어 붙인다.
let lastBubble = null;
function addTranscript(who, text) {
  if (lastBubble && lastBubble.dataset.who === who && who !== 'system') {
    lastBubble.textContent += text;
  } else {
    lastBubble = document.createElement('li');
    lastBubble.className = who;
    lastBubble.dataset.who = who;
    lastBubble.textContent = text;
    ui.transcript.append(lastBubble);
  }
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

async function fetchSession() {
  const res = await fetch('/api/session', { method: 'POST' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `서버 오류 ${res.status}`);
  return res.json();
}

async function setupAudio() {
  // 재생: 모델 출력이 24kHz PCM이므로 같은 샘플레이트로 만든다.
  playCtx = new AudioContext({ sampleRate: 24000 });
  await playCtx.audioWorklet.addModule('audio-worklets.js');
  playNode = new AudioWorkletNode(playCtx, 'playback-processor');
  playNode.connect(playCtx.destination);
  playNode.port.onmessage = (e) => { modelPlaying = e.data.type === 'playing'; };

  // 캡처: 브라우저 기본 샘플레이트로 받고 워클릿에서 16kHz로 줄인다.
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  micCtx = new AudioContext();
  await micCtx.audioWorklet.addModule('audio-worklets.js');
  const src = micCtx.createMediaStreamSource(micStream);
  const capture = new AudioWorkletNode(micCtx, 'capture-processor');
  capture.port.onmessage = (e) => {
    latency.onMic(e.data.rms, performance.now(), modelPlaying);
    live?.sendAudio(e.data.pcm);
  };
  src.connect(capture);
}

function playAudio(b64) {
  const ms = latency.onModelAudio(performance.now());
  if (ms !== null) {
    metric('latency', Math.round(ms));
    ui.latLast.textContent = `${Math.round(ms)} ms`;
    ui.latP50.textContent = `${Math.round(latency.median())} ms`;
    ui.latOk.textContent = `${Math.round(latency.ratioUnder(1000) * 100)}% (${latency.samples.length}회)`;
  }
  const pcm = base64ToInt16(b64);
  const f32 = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
  playNode.port.postMessage({ type: 'push', samples: f32 }, [f32.buffer]);
}

function tickClock() {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  ui.elapsed.textContent = `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, '0')}초`;
  if (sampler) ui.frames.textContent = `${sampler.stats.sent} / ${sampler.stats.skipped}`;
}

async function start() {
  ui.start.disabled = true;
  setStatus('마이크와 연결을 준비하는 중…');
  try {
    await setupAudio();
    live = new LiveSession({ fetchSession });
    live.addEventListener('ready', () => {
      setStatus('연결됨. 말을 걸어 보세요.');
      ui.share.disabled = false;
      ui.stop.disabled = false;
    });
    live.addEventListener('audio', (e) => playAudio(e.detail));
    live.addEventListener('interrupted', () => playNode.port.postMessage({ type: 'clear' }));
    live.addEventListener('transcript', (e) => addTranscript(e.detail.who, e.detail.text));
    live.addEventListener('reconnecting', (e) => {
      ui.reconnects.textContent = String(live.reconnects);
      addTranscript('system', `재연결 중: ${e.detail}`);
      metric('reconnect', null, e.detail);
    });
    live.addEventListener('error', (e) => {
      addTranscript('system', e.detail);
      metric('error', null, e.detail);
    });
    live.addEventListener('closed', () => setStatus('연결이 끝났습니다.'));
    await live.connect();
    startedAt = Date.now();
    clock = setInterval(tickClock, 1000);
    metric('session_start');
  } catch (err) {
    setStatus(`시작 실패: ${err.message}`);
    ui.start.disabled = false;
    teardown();
  }
}

async function shareScreen() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    ui.preview.srcObject = stream;
    ui.preview.classList.add('on');
    ui.preview.play();
    sampler = new ScreenSampler({
      onFrame: (b64, info) => {
        if (live.sendFrame(b64)) metric('frame', Math.round(info.diff * 10) / 10, info.reason);
      },
    });
    await sampler.start(stream);
    stream.getVideoTracks()[0].addEventListener('ended', stopShare);
    ui.share.textContent = '공유 중지';
    ui.share.onclick = stopShare;
  } catch (err) {
    addTranscript('system', `화면 공유 실패: ${err.message}`);
  }
}

function stopShare() {
  sampler?.stop();
  ui.preview.classList.remove('on');
  ui.preview.srcObject = null;
  ui.share.textContent = '화면 공유';
  ui.share.onclick = shareScreen;
}

function teardown() {
  live?.close();
  stopShare();
  sampler = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micCtx?.close();
  playCtx?.close();
  clearInterval(clock);
}

function stop() {
  if (startedAt) metric('session_end', Math.round((Date.now() - startedAt) / 1000));
  teardown();
  ui.stop.disabled = true;
  ui.share.disabled = true;
  ui.start.disabled = false;
  setStatus('수업을 끝냈습니다.');
  startedAt = null;
}

ui.start.onclick = start;
ui.share.onclick = shareScreen;
ui.stop.onclick = stop;
