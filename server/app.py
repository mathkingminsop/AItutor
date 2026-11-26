"""1단계 수업 서버.

하는 일
- 브라우저가 Gemini Live에 직접 연결할 수 있도록 1회용 임시 토큰을 발급한다.
  (실제 API 키는 서버에만 있고 브라우저로 나가지 않는다.)
- 튜터 지침(prompts/tutor_system.md)을 내려준다.
- 브라우저가 잰 응답 지연과 재연결 기록을 받아 data/metrics.jsonl에 쌓고,
  1단계 관문(지연 1초 이내, 90분 끊김 없음)을 확인할 요약을 돌려준다.
- web/ 폴더의 화면을 그대로 서빙한다.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DEFAULT_MODEL = "gemini-3.1-flash-live-preview"
METRICS_PATH = Path(os.getenv("METRICS_PATH", ROOT / "data" / "metrics.jsonl"))
LATENCY_GOAL_MS = 1000

app = FastAPI(title="AI 수학 과외 1단계")


def live_model() -> str:
    return os.getenv("GEMINI_LIVE_MODEL", DEFAULT_MODEL)


def load_system_prompt() -> str:
    return (ROOT / "prompts" / "tutor_system.md").read_text(encoding="utf-8")


def create_ephemeral_token(api_key: str) -> str:
    """Gemini Live용 1회용 토큰을 만든다. 토큰은 1분 안에 연결을 시작해야 하고 30분 뒤 만료된다."""
    from google import genai

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})
    now = dt.datetime.now(tz=dt.timezone.utc)
    token = client.auth_tokens.create(
        config={
            "uses": 1,
            "expire_time": now + dt.timedelta(minutes=30),
            "new_session_expire_time": now + dt.timedelta(minutes=1),
            "http_options": {"api_version": "v1alpha"},
        }
    )
    return token.name


@app.post("/api/session")
def new_session() -> dict:
    """연결(또는 재연결)할 때마다 새 토큰을 받는다. 토큰은 1회용이다."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(500, "GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.")
    try:
        token = create_ephemeral_token(api_key)
    except Exception as exc:  # SDK/네트워크 오류를 화면에 보여주기 위해
        raise HTTPException(502, f"임시 토큰 발급 실패: {exc}") from exc
    return {"token": token, "model": live_model(), "systemPrompt": load_system_prompt()}


class MetricEvent(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    kind: Literal["latency", "reconnect", "session_start", "session_end", "frame", "error"]
    value: float | None = None
    detail: str | None = Field(default=None, max_length=500)


@app.post("/api/metrics", status_code=204)
def record_metric(event: MetricEvent) -> None:
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    row = event.model_dump() | {"at": dt.datetime.now(tz=dt.timezone.utc).isoformat()}
    with METRICS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_events() -> list[dict]:
    if not METRICS_PATH.exists():
        return []
    rows = []
    for line in METRICS_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def summarize(events: list[dict]) -> dict:
    """1단계 관문 확인용 요약: 응답 지연 분포와 수업별 재연결·길이."""
    latencies = [e["value"] for e in events if e.get("kind") == "latency" and e.get("value") is not None]
    sessions: dict[str, dict] = {}
    for e in events:
        s = sessions.setdefault(e["session_id"], {"reconnects": 0, "errors": 0, "frames": 0, "minutes": None})
        if e["kind"] == "reconnect":
            s["reconnects"] += 1
        elif e["kind"] == "error":
            s["errors"] += 1
        elif e["kind"] == "frame":
            s["frames"] += 1
        elif e["kind"] == "session_end" and e.get("value") is not None:
            s["minutes"] = round(e["value"] / 60, 1)

    latency = None
    if latencies:
        latency = {
            "count": len(latencies),
            "p50_ms": round(statistics.median(latencies)),
            "p90_ms": round(percentile(latencies, 0.9)),
            "under_goal_ratio": round(sum(v <= LATENCY_GOAL_MS for v in latencies) / len(latencies), 3),
            "goal_ms": LATENCY_GOAL_MS,
        }
    return {"latency": latency, "sessions": sessions}


@app.get("/api/metrics/summary")
def metrics_summary() -> dict:
    return summarize(read_events())


# 마지막에 마운트해야 /api 경로를 가리지 않는다.
app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
