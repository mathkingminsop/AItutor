// Gemini Live API WebSocket 클라이언트 (브라우저 → Google 직접 연결).
// 서버에서 받은 1회용 토큰으로 연결하고, 연결이 끊기거나 서버가 곧 끊겠다고(goAway) 하면
// 세션 재개 핸들로 다시 연결해 90분 수업이 이어지게 한다.

const WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

/**
 * 이벤트: ready, audio(detail: base64 PCM 24kHz), interrupted, turncomplete,
 *        transcript(detail: {who, text}), reconnecting(detail: reason), closed, error(detail: message)
 */
export class LiveSession extends EventTarget {
  constructor({ fetchSession }) {
    super();
    this.fetchSession = fetchSession; // () => Promise<{token, model, systemPrompt}>
    this.ws = null;
    this.handle = null; // 세션 재개 핸들
    this.closedByUser = false;
    this.reconnects = 0;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get isOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN && this.ready;
  }

  async connect() {
    this.closedByUser = false;
    this.ready = false;
    const s = await this.fetchSession();
    const ws = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(s.token)}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(this.setupMessage(s)));
    ws.onmessage = async (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : await ev.data.text();
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      this.handleMessage(msg);
    };
    ws.onerror = () => this.emit('error', 'WebSocket 오류');
    ws.onclose = (ev) => {
      if (this.ws !== ws) return; // 이미 새 연결로 교체됨
      this.ready = false;
      if (this.closedByUser) return this.emit('closed');
      if (ev.code === 1008 || ev.code === 1007) {
        // 정책/요청 형식 오류: 재연결해도 같은 결과
        this.emit('error', `연결 거부 (${ev.code}): ${ev.reason || '설정 확인 필요'}`);
        return this.emit('closed');
      }
      this.reconnect(`연결 끊김 (${ev.code})`);
    };
  }

  setupMessage(s) {
    return {
      setup: {
        model: `models/${s.model}`,
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: s.systemPrompt }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // 오디오+영상 세션은 기본 길이 제한이 짧다. 오래된 대화를 밀어내며 계속 이어간다.
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: this.handle ? { handle: this.handle } : {},
      },
    };
  }

  handleMessage(msg) {
    if (msg.setupComplete) {
      this.ready = true;
      this.emit('ready');
    }
    if (msg.sessionResumptionUpdate) {
      const u = msg.sessionResumptionUpdate;
      if (u.resumable && u.newHandle) this.handle = u.newHandle;
    }
    if (msg.goAway) {
      this.reconnect(`서버 요청 재연결 (남은 시간 ${msg.goAway.timeLeft || '?'})`);
    }
    const c = msg.serverContent;
    if (c) {
      if (c.interrupted) this.emit('interrupted');
      for (const part of c.modelTurn?.parts || []) {
        if (part.inlineData?.mimeType?.startsWith('audio/pcm')) this.emit('audio', part.inlineData.data);
      }
      if (c.inputTranscription?.text) this.emit('transcript', { who: 'student', text: c.inputTranscription.text });
      if (c.outputTranscription?.text) this.emit('transcript', { who: 'tutor', text: c.outputTranscription.text });
      if (c.turnComplete) this.emit('turncomplete');
    }
  }

  async reconnect(reason) {
    if (this.reconnecting || this.closedByUser) return;
    if (this.reconnects >= 30) {
      this.emit('error', '재연결을 너무 많이 시도해서 멈췄습니다');
      return this.emit('closed');
    }
    this.reconnecting = true;
    this.reconnects++;
    this.emit('reconnecting', reason);
    const old = this.ws;
    this.ws = null;
    try {
      old?.close();
    } catch {}
    for (let attempt = 0; attempt < 5 && !this.closedByUser; attempt++) {
      try {
        await this.connect();
        break;
      } catch (e) {
        this.emit('error', `재연결 실패: ${e.message}`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    this.reconnecting = false;
  }

  sendAudio(int16Buffer) {
    if (!this.isOpen) return;
    this.ws.send(
      JSON.stringify({ realtimeInput: { audio: { data: toBase64(int16Buffer), mimeType: 'audio/pcm;rate=16000' } } }),
    );
  }

  sendFrame(jpegBase64) {
    if (!this.isOpen) return false;
    this.ws.send(JSON.stringify({ realtimeInput: { video: { data: jpegBase64, mimeType: 'image/jpeg' } } }));
    return true;
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
