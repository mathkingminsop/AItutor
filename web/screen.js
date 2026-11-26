// 화면 캡처: 5초마다 확인하되, 화면이 크게 바뀌면(페이지 넘김, 새 문제) 바로 보낸다.
// 바뀐 게 없으면 보내지 않는다. 판단 로직(frameDiff, shouldSend)은 DOM 없이 테스트할 수 있다.

export const DEFAULTS = {
  tickMs: 1000, // 1초마다 작은 썸네일로 변화량을 잰다
  periodMs: 5000, // 필기처럼 작은 변화는 5초에 한 번 모아서 보낸다
  smallDiff: 1.5, // 이보다 작으면 "안 바뀜"
  bigDiff: 12, // 이보다 크면 "화면 전환", 바로 보낸다
  minGapMs: 1000, // 아무리 바뀌어도 1초에 한 장 이하
  thumbW: 64,
  thumbH: 36,
  maxWidth: 1024, // 모델로 보내는 이미지 최대 너비
  jpegQuality: 0.7,
};

/** 같은 길이의 회색조 배열 두 개의 평균 절대 차이 (0~255). */
export function frameDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** RGBA 픽셀 배열 → 회색조 Uint8Array. */
export function toGray(rgba) {
  const gray = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return gray;
}

/**
 * 지금 프레임을 보낼지 정한다.
 * @returns {null | 'first' | 'big-change' | 'periodic'}
 */
export function shouldSend({ diff, sinceLastSentMs, hasSent }, cfg = DEFAULTS) {
  if (!hasSent) return 'first';
  if (sinceLastSentMs < cfg.minGapMs) return null;
  if (diff >= cfg.bigDiff) return 'big-change';
  if (sinceLastSentMs >= cfg.periodMs && diff >= cfg.smallDiff) return 'periodic';
  return null;
}

export class ScreenSampler {
  constructor({ onFrame, config = {} }) {
    this.onFrame = onFrame;
    this.cfg = { ...DEFAULTS, ...config };
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.thumb = document.createElement('canvas');
    this.thumb.width = this.cfg.thumbW;
    this.thumb.height = this.cfg.thumbH;
    this.full = document.createElement('canvas');
    this.lastSentGray = null;
    this.lastSentAt = 0;
    this.timer = null;
    this.stats = { sent: 0, skipped: 0 };
  }

  async start(stream) {
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.timer = setInterval(() => this.tick(), this.cfg.tickMs);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.lastSentGray = null;
  }

  tick() {
    const v = this.video;
    if (!v.videoWidth) return;
    const tctx = this.thumb.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(v, 0, 0, this.cfg.thumbW, this.cfg.thumbH);
    const gray = toGray(tctx.getImageData(0, 0, this.cfg.thumbW, this.cfg.thumbH).data);
    const now = performance.now();
    const diff = frameDiff(gray, this.lastSentGray);
    const reason = shouldSend(
      { diff, sinceLastSentMs: now - this.lastSentAt, hasSent: this.lastSentGray !== null },
      this.cfg,
    );
    if (!reason) {
      this.stats.skipped++;
      return;
    }
    const scale = Math.min(1, this.cfg.maxWidth / v.videoWidth);
    this.full.width = Math.round(v.videoWidth * scale);
    this.full.height = Math.round(v.videoHeight * scale);
    this.full.getContext('2d').drawImage(v, 0, 0, this.full.width, this.full.height);
    const dataUrl = this.full.toDataURL('image/jpeg', this.cfg.jpegQuality);
    this.lastSentGray = gray;
    this.lastSentAt = now;
    this.stats.sent++;
    this.onFrame(dataUrl.slice(dataUrl.indexOf(',') + 1), { reason, diff });
  }
}
