import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from '../web/friendly.js';

const err = (name, message = '') => Object.assign(new Error(message), { name });

test('마이크 권한 거부를 안내한다', () => {
  assert.match(friendlyError(err('NotAllowedError')).title, /마이크/);
});

test('화면 공유 취소는 화면 공유 안내를 준다', () => {
  assert.match(friendlyError(err('NotAllowedError'), 'screen').title, /화면 공유/);
});

test('API 키 누락을 안내한다', () => {
  const f = friendlyError(new Error('GEMINI_API_KEY가 설정되지 않았습니다.'));
  assert.match(f.hint, /\.env/);
});

test('서버가 꺼져 있으면 서버 실행을 안내한다', () => {
  const f = friendlyError(new TypeError('Failed to fetch'));
  assert.match(f.hint, /uvicorn/);
});

test('모델 설정 거부는 모델 이름을 안내한다', () => {
  assert.match(friendlyError('연결 거부 (1008): bad model').hint, /GEMINI_LIVE_MODEL/);
});

test('모르는 오류는 원래 메시지를 보여 준다', () => {
  assert.equal(friendlyError(new Error('이상한 일')).hint, '이상한 일');
});
