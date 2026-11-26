// 기술적인 오류를 처음 쓰는 사람도 알아듣는 한국어 안내로 바꾼다.
// 반환: { title, hint } — title은 무슨 일인지, hint는 무엇을 하면 되는지.

export function friendlyError(err, context = '') {
  const name = err?.name || '';
  const msg = String(err?.message ?? err ?? '');

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return context === 'screen'
      ? { title: '화면 공유가 취소되었어요.', hint: '"화면 공유"를 다시 누르고, 공유할 창이나 화면을 고른 뒤 "공유"를 눌러 주세요.' }
      : {
          title: '마이크 사용이 허용되지 않았어요.',
          hint: '주소창 왼쪽의 자물쇠(또는 설정) 아이콘을 눌러 마이크를 "허용"으로 바꾼 뒤 페이지를 새로고침하세요.',
        };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { title: '마이크를 찾지 못했어요.', hint: '헤드셋이나 마이크가 꽂혀 있는지 확인하고 다시 시도해 주세요.' };
  }
  if (name === 'NotReadableError') {
    return { title: '마이크를 다른 프로그램이 쓰고 있어요.', hint: 'Zoom, Discord 같은 프로그램을 끄고 다시 시도해 주세요.' };
  }
  if (msg.includes('GEMINI_API_KEY')) {
    return {
      title: 'API 키가 설정되지 않았어요.',
      hint: '.env 파일의 GEMINI_API_KEY= 뒤에 AI Studio 키를 넣고 저장한 뒤, 서버를 껐다(Ctrl+C) 다시 켜 주세요.',
    };
  }
  if (msg.includes('임시 토큰') || /API key not valid|PERMISSION_DENIED|401|403/.test(msg)) {
    return {
      title: 'Google이 API 키를 받아들이지 않았어요.',
      hint: 'AI Studio에서 키를 다시 복사해 .env에 붙여 넣었는지(앞뒤 공백 없이) 확인하고 서버를 다시 켜 주세요.',
    };
  }
  if (name === 'TypeError' && /fetch|network|Failed/i.test(msg)) {
    return {
      title: '과외 서버에 연결할 수 없어요.',
      hint: '검은 명령어 창에서 서버가 켜져 있는지 확인하세요. 꺼졌다면 python -m uvicorn server.app:app --port 8000 을 다시 실행하세요.',
    };
  }
  if (/연결 거부 \(100[78]\)/.test(msg)) {
    return {
      title: 'Google이 연결 설정을 거부했어요.',
      hint: '음성 모델 이름이 바뀌었을 수 있어요. .env의 GEMINI_LIVE_MODEL을 최신 Live 모델 이름으로 바꾸고 서버를 다시 켜 주세요.',
    };
  }
  if (msg.includes('WebSocket')) {
    return { title: '인터넷 연결이 불안정해요.', hint: '잠시 기다리면 자동으로 다시 연결해요. 계속되면 와이파이를 확인해 주세요.' };
  }
  return { title: '문제가 생겼어요.', hint: msg || '페이지를 새로고침하고 다시 시도해 주세요.' };
}
