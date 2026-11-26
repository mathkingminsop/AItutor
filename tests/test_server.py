import importlib
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("METRICS_PATH", str(tmp_path / "metrics.jsonl"))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    from server import app as app_module

    app_module = importlib.reload(app_module)
    monkeypatch.setattr(app_module, "create_ephemeral_token", lambda key: f"auth_tokens/fake-for-{key}")
    return app_module


def test_session_returns_token_model_and_prompt(server):
    client = TestClient(server.app)
    res = client.post("/api/session")
    assert res.status_code == 200
    body = res.json()
    assert body["token"] == "auth_tokens/fake-for-test-key"
    assert body["model"]
    assert "과외" in body["systemPrompt"]


def test_session_without_key_explains_problem(server, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    res = TestClient(server.app).post("/api/session")
    assert res.status_code == 500
    assert "GEMINI_API_KEY" in res.json()["detail"]


def test_api_key_never_sent_to_browser(server):
    res = TestClient(server.app).post("/api/session")
    assert "test-key" not in json.dumps({k: v for k, v in res.json().items() if k != "token"})


def test_metrics_summary_checks_phase1_gate(server):
    client = TestClient(server.app)
    for ms in [400, 600, 800, 1200]:
        assert client.post("/api/metrics", json={"session_id": "s1", "kind": "latency", "value": ms}).status_code == 204
    client.post("/api/metrics", json={"session_id": "s1", "kind": "reconnect", "detail": "goAway"})
    client.post("/api/metrics", json={"session_id": "s1", "kind": "session_end", "value": 5400})
    summary = client.get("/api/metrics/summary").json()
    assert summary["latency"]["count"] == 4
    assert summary["latency"]["p50_ms"] == 700
    assert summary["latency"]["under_goal_ratio"] == 0.75
    assert summary["sessions"]["s1"] == {"reconnects": 1, "errors": 0, "frames": 0, "minutes": 90.0}


def test_metrics_rejects_unknown_kind(server):
    res = TestClient(server.app).post("/api/metrics", json={"session_id": "s1", "kind": "hack"})
    assert res.status_code == 422


def test_index_page_is_served(server):
    res = TestClient(server.app).get("/")
    assert res.status_code == 200
    assert "AI 수학 과외" in res.text
