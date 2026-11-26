import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameDiff, toGray, shouldSend, DEFAULTS } from '../web/screen.js';

test('frameDiff: 같은 화면은 0, 처음 프레임은 무한대', () => {
  const a = new Uint8Array([10, 20, 30]);
  assert.equal(frameDiff(a, a), 0);
  assert.equal(frameDiff(a, new Uint8Array([20, 20, 20])), (10 + 0 + 10) / 3);
  assert.equal(frameDiff(a, null), Infinity);
});

test('toGray: RGBA를 밝기로 바꾼다', () => {
  const g = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]));
  assert.ok(g[0] >= 254);
  assert.equal(g[1], 0);
});

test('shouldSend: 첫 프레임은 바로 보낸다', () => {
  assert.equal(shouldSend({ diff: Infinity, sinceLastSentMs: 0, hasSent: false }), 'first');
});

test('shouldSend: 화면 전환은 5초를 기다리지 않는다', () => {
  assert.equal(shouldSend({ diff: 30, sinceLastSentMs: 1500, hasSent: true }), 'big-change');
});

test('shouldSend: 1초 안에는 아무리 바뀌어도 보내지 않는다', () => {
  assert.equal(shouldSend({ diff: 30, sinceLastSentMs: 500, hasSent: true }), null);
});

test('shouldSend: 필기처럼 작은 변화는 5초마다 모아서 보낸다', () => {
  assert.equal(shouldSend({ diff: 3, sinceLastSentMs: 3000, hasSent: true }), null);
  assert.equal(shouldSend({ diff: 3, sinceLastSentMs: DEFAULTS.periodMs, hasSent: true }), 'periodic');
});

test('shouldSend: 바뀐 게 없으면 보내지 않는다', () => {
  assert.equal(shouldSend({ diff: 0.5, sinceLastSentMs: 60000, hasSent: true }), null);
});
