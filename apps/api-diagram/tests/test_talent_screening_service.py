from app.services.talent_evaluation_service import (
    KNOCKOUT_FAIL_CAP,
    build_evaluation,
    compute_score,
    verify_quote,
)
from app.services.talent_rubric_service import build_fallback_rubric, normalize_rubric
from app.services.talent_screening_service import (
    build_fallback_screening,
    compile_resume_text,
    extract_resume_profile,
)

JD = """岗位名称：AI 解决方案工程师（校招）
我们希望你是
1. 本科及以上学历（2027 届应届生），更看重实际作品
2. 掌握至少一门编程语言和一个前端框架（Vue / React），独立完成过完整的项目
3. 自驱力强、沟通顺畅
加分项
1. 实习中接触过 CRM、ERP 等企业系统
2. 参加过黑客松、创新创业比赛
"""

RESUME = """张三
教育背景
某某大学 ｜ 软件工程 ｜ 本科 ｜ 2023.09 – 2027.06
项目经历
SalesBot 销售助手 ｜ 负责人 ｜ 2026.03 – 2026.06
• 使用 React + TypeScript 开发前端，FastAPI 提供接口，部署上线后服务 30 位销售用户
• 基于 RAG 知识库与 Agent 工具调用实现报价问答，响应时间降低 40%
• 与销售团队沟通需求，完成需求调研和原型验证
实习经历
某公司 ｜ 前端实习生 ｜ 2025.07 – 2025.09
• 参与 CRM 系统客户跟进模块开发，使用 Vue 实现列表与表单
专业技能
熟悉 Python、React、Vue、Cursor
荣誉奖项
校级黑客松一等奖
"""


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


def test_compile_resume_text_does_not_duplicate_previewed_pdf_text():
    parsed = {
        "blocks": [
            {"source_locator": "pdf:page=1", "text": "Ada React AI"},
        ]
    }
    previewed = compile_resume_text(parsed)

    assert compile_resume_text(parsed, previewed) == previewed


def test_fallback_screening_scores_candidate_and_recommends_bucket():
    result = build_fallback_screening(
        candidate_name="Ada",
        jd_text=JD,
        resume_text=RESUME,
        source_name="ada.pdf",
    )

    report = result["score_report"]
    assert result["candidate_name"] == "Ada"
    assert result["total_score"] > 0
    assert result["recommendation"] in {"进入面试", "人工复核", "进入人才库", "暂不推进"}
    assert result["source_name"] == "ada.pdf"
    assert report["model"] == "rubric-v3"
    assert {k["status"] for k in report["knockouts"]} == {"pass"}
    assert all(0 <= row["level"] <= 3 for row in report["requirements"])
    assert report["interview_plan"]


def test_fallback_rubric_extracts_knockouts_and_bonus_items():
    rubric = build_fallback_rubric("AI 解决方案工程师", JD)

    kinds = {item["kind"] for item in rubric["knockouts"]}
    assert kinds == {"degree", "graduation_year"}
    assert rubric["role_level"] == "campus"
    assert [r["category"] for r in rubric["requirements"]].count("bonus") == 2


def test_llm_evidence_that_is_not_in_resume_is_downgraded():
    rubric = build_fallback_rubric("AI 解决方案工程师", JD)
    key = rubric["requirements"][1]["key"]
    payload = {
        "assessments": [
            {"key": key, "level": 4, "evidence": ["主导百万级用户平台的微服务架构重构"], "rationale": "很强"},
        ],
    }
    result = build_evaluation(
        candidate_name="张三",
        jd_text=JD,
        resume_text=RESUME,
        rubric=rubric,
        profile=extract_resume_profile(RESUME),
        llm_payload=payload,
    )
    row = next(r for r in result["score_report"]["requirements"] if r["key"] == key)
    assert row["level"] == 1
    assert row["adjusted"] is True


def test_verify_quote_tolerates_whitespace_and_punctuation():
    resume_norm = "".join(ch for ch in RESUME.lower() if ch.isalnum())
    assert verify_quote("使用 React+TypeScript 开发前端", resume_norm)
    assert not verify_quote("主导百万级用户平台", resume_norm)


def test_compute_score_bonus_is_any_of_and_knockout_caps_total():
    rubric = normalize_rubric(
        {
            "requirements": [
                {"key": "a", "label": "全栈开发", "category": "core", "weight": 60},
                {"key": "b", "label": "自驱学习", "category": "potential", "weight": 40},
                {"key": "c", "label": "CRM 经验", "category": "bonus", "weight": 10},
                {"key": "d", "label": "黑客松比赛", "category": "bonus", "weight": 10},
            ]
        },
        jd_title="t",
        jd_text="t",
        source="custom",
    )
    levels = [{"key": k, "level": 4} for k in ("a", "b", "c", "d")]
    full = compute_score(rubric, levels, [])
    assert full["total_score"] == 100
    assert sum(1 for row in full["rows"] if row["category"] == "bonus" and row["counted"]) == 1

    capped = compute_score(rubric, levels, [{"key": "ko", "status": "fail"}])
    assert capped["total_score"] == KNOCKOUT_FAIL_CAP
    assert capped["capped"] is True
