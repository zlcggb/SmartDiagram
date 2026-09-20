from app.services.talent_screening_service import (
    build_fallback_screening,
    compile_resume_text,
    coerce_screening_result,
)


def test_compile_resume_text_merges_manual_and_parsed_blocks():
    combined = compile_resume_text(
        {
            "blocks": [
                {"source_locator": "pdf:page=1", "text": "React + AI agent 实战"},
                {"source_locator": "pdf:page=2", "text": "做过 CRM 和销售支持系统"},
            ]
        },
        "个人网站：https://example.com",
    )

    assert "个人网站" in combined
    assert "[pdf:page=1]" in combined
    assert "销售支持系统" in combined


def test_fallback_screening_scores_candidate_and_recommends_bucket():
    result = build_fallback_screening(
        candidate_name="Ada",
        jd_text="需要 AI、前端、CRM、需求拆解与 demo 落地能力",
        resume_text="Ada 做过 React CRM、AI agent、Side Project 和个人网站。",
        source_name="ada.pdf",
    )

    assert result["candidate_name"] == "Ada"
    assert result["total_score"] > 0
    assert result["recommendation"] in {"进入面试", "人工复核", "进入人才库", "暂不推进"}
    assert result["source_name"] == "ada.pdf"


def test_coerce_screening_result_preserves_dimension_shape():
    fallback = build_fallback_screening(
        candidate_name="Ada",
        jd_text="需要 AI + 前端",
        resume_text="React + AI",
    )
    coerced = coerce_screening_result(
        {
            "candidate_name": "Ada",
            "recommendation": "进入面试",
            "dimension_scores": [
                {"key": "ai_practice", "label": "AI 应用与编程实践", "score": 22, "reason": "命中 AI 经验"}
            ],
        },
        fallback,
    )

    assert coerced["evaluation_mode"] == "ai"
    assert coerced["dimension_scores"][0]["key"] == "ai_practice"
    assert coerced["total_score"] <= 100
