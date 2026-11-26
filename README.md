# AI 수학 과외 (시제품)

한국 고등학생이 웹 브라우저에서 화면을 공유하고 음성으로 대화하며 수학 과외를 받는 AI 튜터 시제품입니다.
설계 문서: [AI 수학 과외 시제품 설계](https://claude.ai/artifact/32x163cp8X3BjeTe9VpFXC)

## 지금 단계: 1단계 (음성과 화면 연결)

- 브라우저가 Gemini Live API에 직접 연결해 실시간 음성 대화를 합니다. 학생이 말하는 중에 끼어들 수 있고, AI가 말하는 중에 학생이 끼어들면 AI가 멈춥니다.
- 화면 공유는 1초마다 작은 썸네일로 변화를 재서, 화면이 크게 바뀌면 바로, 필기처럼 작게 바뀌면 5초마다 모아서 보냅니다. 바뀐 게 없으면 보내지 않습니다.
- 응답 지연(학생 말 끝 → AI 첫 음성)과 재연결 횟수를 기록해 1단계 관문을 확인합니다.
  - 관문: 응답 지연 1초 이내, 90분 수업 동안 끊김 없음
  - 확인: 수업 후 `http://localhost:8000/api/metrics/summary`
- 오래 수업해도 이어지도록 대화 기록 압축(sliding window)과 세션 재개(session resumption)를 켰습니다. 서버가 연결을 끊으면 자동으로 다시 연결합니다.

아직 없는 것: 필기 검증(추론 모델 + SymPy, 2단계), 단원표·진단·학부모 동의(3단계).

## 구조

```
server/app.py          FastAPI 서버: 1회용 토큰 발급, 측정 기록, 화면 서빙
prompts/tutor_system.md  튜터 지침 (질문과 힌트로 이끄는 방식)
web/live.js            Gemini Live WebSocket 클라이언트 (재연결 포함)
web/audio-worklets.js  마이크 16kHz 캡처, 24kHz 음성 재생
web/screen.js          화면 캡처와 변화 감지
web/latency.js         응답 지연 측정
```

API 키는 서버에만 있고, 브라우저는 연결할 때마다 서버에서 1회용 토큰을 받습니다.

## 실행 방법

1. Python 3.11 이상을 설치합니다.
2. [Google AI Studio](https://aistudio.google.com/apikey)에서 무료 API 키를 받습니다.
3. 이 폴더에서:
   ```bash
   pip install -r requirements.txt
   cp .env.example .env      # .env를 열어 GEMINI_API_KEY에 키를 넣습니다
   python -m uvicorn server.app:app --port 8000
   ```
4. Chrome에서 `http://localhost:8000`을 열고, 헤드폰을 낀 뒤 "수업 시작" → "화면 공유"를 누릅니다.

## 테스트

```bash
python -m pytest -q    # 서버
npm test               # 화면 변화 감지, 지연 측정 (Node 20 이상)
```

## 주의

- Gemini API 무료 등급에서는 입력 데이터가 Google 서비스 개선에 쓰일 수 있습니다. 혼자 테스트할 때만 쓰고, 실제 학생 수업은 유료 등급으로 바꿔서 진행합니다.
- Live API 모델 이름은 자주 바뀝니다. 연결이 거부되면 `.env`의 `GEMINI_LIVE_MODEL`을 AI Studio 문서의 최신 Live 모델로 바꿔 보세요.
- 스피커로 들으면 AI 목소리가 마이크로 다시 들어가 스스로 끊길 수 있습니다. 헤드폰을 권장합니다.
