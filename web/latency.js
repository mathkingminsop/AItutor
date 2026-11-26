// 응답 지연 측정: 학생 목소리가 마지막으로 들린 순간 → AI 음성 첫 조각이 도착한 순간.
// 학생이 느끼는 "말 끝나고 대답까지" 시간과 같다 (모델의 말 끝 감지 시간 포함).

export class LatencyTracker {
  constructor({ voiceRms = 0.02, maxMs = 30000 } = {}) {
    this.voiceRms = voiceRms;
    this.maxMs = maxMs;
    this.lastVoiceAt = null;
    this.waiting = false;
    this.samples = [];
  }

  /** 마이크 조각마다 호출. AI가 말하는 중에는 스피커 소리가 섞일 수 있어 세지 않는다. */
  onMic(rms, now, modelPlaying) {
    if (modelPlaying || rms < this.voiceRms) return;
    this.lastVoiceAt = now;
    this.waiting = true;
  }

  /** AI 음성 조각이 도착할 때마다 호출. 한 차례의 첫 조각이면 지연(ms)을 돌려준다. */
  onModelAudio(now) {
    if (!this.waiting || this.lastVoiceAt === null) return null;
    this.waiting = false;
    const ms = now - this.lastVoiceAt;
    if (ms < 0 || ms > this.maxMs) return null;
    this.samples.push(ms);
    return ms;
  }

  median() {
    if (!this.samples.length) return null;
    const s = [...this.samples].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  ratioUnder(goalMs = 1000) {
    if (!this.samples.length) return null;
    return this.samples.filter((v) => v <= goalMs).length / this.samples.length;
  }
}
