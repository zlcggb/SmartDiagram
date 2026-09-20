from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import routes_talent


def _client():
    app = FastAPI()
    app.include_router(routes_talent.router, prefix="/api")
    return TestClient(app)


def test_screen_route_uses_existing_ai_service(monkeypatch):
    async def fake_screen_candidate_profile(*, candidate_name, jd_text, resume_text, source_name):
        return {
            "candidate_name": candidate_name,
            "job_summary": jd_text[:20],
            "total_score": 86,
            "max_score": 100,
            "recommendation": "进入面试",
            "overall_summary": "匹配度较高",
            "dimension_scores": [],
            "matched_signals": ["AI"],
            "strengths": ["AI demo"],
            "risks": ["需要验证业务深度"],
            "interview_questions": ["请介绍 demo"],
            "evidence_excerpt": resume_text[:40],
            "source_name": source_name,
            "evaluation_mode": "ai",
        }

    monkeypatch.setattr(routes_talent, "screen_candidate_profile", fake_screen_candidate_profile)
    client = _client()

    response = client.post(
        "/api/talent/screen",
        data={
            "candidate_name": "Ada",
            "channel": "Boss",
            "jd_text": "需要 AI 与前端交付能力",
            "resume_text": "Ada 做过 React、Agent、CRM",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["candidate_name"] == "Ada"
    assert body["channel"] == "Boss"
    assert body["resume_filename"] == ""
    assert body["parsed_blocks"] == 0


def test_screen_route_requires_jd_text():
    client = _client()
    response = client.post(
        "/api/talent/screen",
        data={"candidate_name": "Ada", "resume_text": "React"},
    )

    assert response.status_code == 422
