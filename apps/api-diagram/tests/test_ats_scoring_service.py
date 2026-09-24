from app.services.ats_scoring_service import calculate_ats_scores, combine_scores


def test_calculate_ats_scores_returns_keyword_evidence_and_breakdown():
    result = calculate_ats_scores(
        "需要 React、TypeScript、AI agent、RAG 和业务系统经验",
        "工作经历\n使用 React 和 TypeScript 构建 AI agent，完成 CRM 项目。",
    )

    assert result["score_version"] == "evidence-v2"
    assert result["score_breakdown"]["keyword_match"] > 0
    assert "react" in result["matched_keywords"]
    assert "rag" in result["missing_keywords"]


def test_combine_scores_is_bounded_and_rewards_evidence():
    strong = calculate_ats_scores(
        "React TypeScript AI agent",
        "工作经历\n教育经历\n技能\nReact TypeScript AI agent",
    )

    assert combine_scores(90, strong) <= 100
    assert combine_scores(90, strong) > combine_scores(45, strong)
