import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatencyTracker } from '../web/latency.js';

test('학생 목소리가 마지막으로 들린 뒤 첫 AI 음성까지를 잰다', () => {
  const t = new LatencyTracker();
  t.onMic(0.1, 1000, false);
  t.onMic(0.1, 2000, false); // 말이 이어짐
  t.onMic(0.001, 2100, false); // 조용함
  assert.equal(t.onModelAudio(2700), 700);
  assert.equal(t.onModelAudio(2750), null, '같은 대답의 두 번째 조각은 세지 않는다');
});

test('AI가 말하는 중 들어온 소리(스피커 반향)는 세지 않는다', () => {
  const t = new LatencyTracker();
  t.onMic(0.5, 1000, true);
  assert.equal(t.onModelAudio(1200), null);
});

test('중앙값과 1초 이내 비율', () => {
  const t = new LatencyTracker();
  for (const [voice, audio] of [[0, 400], [0, 900], [0, 1500]]) {
    t.onMic(0.1, voice, false);
    t.onModelAudio(audio);
  }
  assert.equal(t.median(), 900);
  assert.equal(t.ratioUnder(1000), 2 / 3);
});
