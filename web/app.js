import { LiveSession, base64ToInt16 } from './live.js';
import { ScreenSampler } from './screen.js';
import { LatencyTracker } from './latency.js';
import { friendlyError } from './friendly.js';

const $ = (id) => document.getElementById(id);
const ui = {
  start: $('start'), share: $('share'), stop: $('stop'),
  pill: $('pill'), pillText: $('pill-text'),
  steps: [$('step-1'), $('step-2'), $('step-3')],
  alert: $('alert'), alertTitle: $('alert-title'), alertHint: $('alert-hint'), alertClose: $('alert-close'),
  transcript: $('transcript'), empty: $('empty'),
  preview: $('preview'), previewEmpty: $('preview-empty'),
  micLevel: $('mic-level'), speaking: $('speaking'),
  latLast: $('lat-last'), latP50: $('lat-p50'), latOk: $('lat-ok'),
  elapsed: $('elapsed'), reconnects: $('reconnects'), frames: $('frames'),
};

const sessionId = crypto.randomUUID().slice(0, 8);
let live, micCtx, micStream, playCtx, playNode, sampler, startedAt, clock;
let modelPlaying = false;
let connected = false;
const latency = new LatencyTracker();

// ---- 화면 상태 표시 ----

const PILL = {
  idle: '대기 중',
  connecting: '연결하는 중…',
  listening: '듣고 있어요',
  speaking: 'AI가 말하는 중',
  reconnecting: '다시 연결하는 중…',
  error: '문제가 생겼어요',
  ended: '수업이 끝났어요',
};
function setState(state) {
  ui.pill.dataset.state = state;
  ui.pillText.textContent = PILL[state];
}

// step: 지금 해야 할 단계 번호(1~3). 4면 모두 완료.
function setStep(step) {
  ui.steps.forEach((el, i) => {
    el.classList.toggle('done', i + 1 < step);
    el.classList.toggle('active', i + 1 === step);
  });
}

function showError(err, context) {
  const f = friendlyError(err, context);
  ui.alertTitle.textContent = f.title;
  ui.alertHint.textContent = f.hint;
  ui.alert.hidden = false;
}
function hideError() { ui.alert.hidden = true; }

function setSpeaking(on) {
  modelPlaying = on;
  ui.speaking.hidden = !on;
  if (connected) setState(on ? 'speaking' : 'listening');
}

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
  ui.empty?.remove();
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

// ---- 연결과 오디오 ----

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
  playNode.port.onmessage = (e) => setSpeaking(e.data.type === 'playing');

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
    ui.micLevel.style.width = `${Math.min(100, Math.round(e.data.rms * 400))}%`;
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
  hideError();
  ui.start.disabled = true;
  ui.start.textContent = '준비 중…';
  setStep(2);
  setState('connecting');
  try {
    await setupAudio();
    live = new LiveSession({ fetchSession });
    live.addEventListener('ready', () => {
      connected = true;
      hideError();
      setState('listening');
      setStep(3);
      ui.start.textContent = '수업 중';
      ui.share.disabled = false;
      ui.stop.disabled = false;
    });
    live.addEventListener('audio', (e) => playAudio(e.detail));
    live.addEventListener('interrupted', () => playNode.port.postMessage({ type: 'clear' }));
    live.addEventListener('transcript', (e) => addTranscript(e.detail.who, e.detail.text));
    live.addEventListener('reconnecting', (e) => {
      connected = false;
      setState('reconnecting');
      ui.reconnects.textContent = String(live.reconnects);
      addTranscript('system', '연결이 잠깐 끊겨서 다시 연결하고 있어요. 대화는 이어집니다.');
      metric('reconnect', null, e.detail);
    });
    live.addEventListener('error', (e) => {
      showError(e.detail);
      metric('error', null, e.detail);
    });
    live.addEventListener('closed', () => {
      if (!live?.closedByUser) {
        connected = false;
        setState('error');
        resetButtons();
      }
    });
    await live.connect();
    startedAt = Date.now();
    clock = setInterval(tickClock, 1000);
    metric('session_start');
  } catch (err) {
    showError(err);
    setState('error');
    teardown();
    resetButtons();
  }
}

async function shareScreen() {
  hideError();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    ui.preview.srcObject = stream;
    ui.preview.classList.add('on');
    ui.previewEmpty.hidden = true;
    ui.preview.play();
    sampler = new ScreenSampler({
      onFrame: (b64, info) => {
        if (live.sendFrame(b64)) metric('frame', Math.round(info.diff * 10) / 10, info.reason);
      },
    });
    await sampler.start(stream);
    stream.getVideoTracks()[0].addEventListener('ended', stopShare);
    setStep(4);
    ui.share.textContent = '공유 중지';
    ui.share.onclick = stopShare;
  } catch (err) {
    showError(err, 'screen');
  }
}

function stopShare() {
  sampler?.stop();
  ui.preview.srcObject?.getTracks().forEach((t) => t.stop());
  ui.preview.classList.remove('on');
  ui.preview.srcObject = null;
  ui.previewEmpty.hidden = false;
  if (connected) setStep(3);
  ui.share.textContent = '화면 공유';
  ui.share.onclick = shareScreen;
}

function teardown() {
  connected = false;
  live?.close();
  stopShare();
  sampler = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micCtx?.close();
  playCtx?.close();
  clearInterval(clock);
  ui.micLevel.style.width = '0';
  ui.speaking.hidden = true;
  modelPlaying = false;
}

function resetButtons() {
  ui.stop.disabled = true;
  ui.share.disabled = true;
  ui.start.disabled = false;
  ui.start.textContent = '다시 시작';
  setStep(2);
}

function stop() {
  if (startedAt) metric('session_end', Math.round((Date.now() - startedAt) / 1000));
  teardown();
  resetButtons();
  setState('ended');
  addTranscript('system', '수업을 끝냈어요. 수고했어요!');
  startedAt = null;
}

ui.start.onclick = start;
ui.share.onclick = shareScreen;
ui.stop.onclick = stop;
ui.alertClose.onclick = hideError;
