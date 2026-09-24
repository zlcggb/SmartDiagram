"""Deterministic, explainable ATS scoring for resume/JD comparisons."""

from __future__ import annotations

import re
from typing import Any

ATS_SCORE_VERSION = "evidence-v2"

ATS_WEIGHTS = {
    "keyword_match": 0.55,
    "skills_coverage": 0.25,
    "section_completeness": 0.20,
}

STOP_WORDS = {
    "and",
    "are",
    "but",
    "can",
    "for",
    "from",
    "have",
    "into",
    "job",
    "looking",
    "must",
    "our",
    "role",
    "team",
    "the",
    "their",
    "this",
    "with",
    "work",
    "working",
    "years",
    "your",
    "经验",
    "岗位",
    "负责",
    "能力",
    "要求",
    "工作",
}

SKILL_TERMS = {
    "ai",
    "agent",
    "api",
    "aws",
    "azure",
    "c++",
    "css",
    "docker",
    "fastapi",
    "github",
    "gitlab",
    "javascript",
    "kubernetes",
    "langchain",
    "llm",
    "node",
    "openai",
    "python",
    "rag",
    "react",
    "redis",
    "sql",
    "typescript",
    "vue",
    "工作流",
    "全栈",
    "前端",
    "后端",
    "机器学习",
    "自动化",
    "计算机视觉",
    "自然语言处理",
}

SECTION_PATTERNS = {
    "summary": ("summary", "objective", "profile", "about", "简介", "个人概述"),
    "experience": (
        "experience",
        "work history",
        "employment",
        "实习经历",
        "工作经历",
        "工作经验",
    ),
    "education": ("education", "academic", "degree", "教育背景", "教育经历", "学历"),
    "skills": (
        "skills",
        "technologies",
        "competencies",
        "technical",
        "专业能力",
        "专业技能",
        "技能",
        "技术栈",
    ),
    "projects": ("projects", "project experience", "项目经历", "项目经验", "竞赛经历"),
}


def _normalize(value: str | None) -> str:
    return re.sub(r"\n{3,}", "\n\n", (value or "").replace("\r\n", "\n").replace("\r", "\n")).strip()


def _contains_term(term: str, text_lower: str) -> bool:
    if any("\u4e00" <= character <= "\u9fff" for character in term):
        return term in text_lower
    return bool(re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text_lower))


def extract_keywords(text: str) -> list[str]:
    """Extract meaningful English/Chinese terms without relying on an LLM."""

    normalized = _normalize(text).lower()
    candidates = re.findall(r"[a-z][a-z0-9+#./-]{1,}", normalized)
    keywords: list[str] = []
    for candidate in candidates:
        candidate = candidate.strip(".-/")
        if len(candidate) < 3 or candidate in STOP_WORDS or candidate.isdigit():
            continue
        if candidate not in keywords:
            keywords.append(candidate)

    for term in sorted(SKILL_TERMS, key=len, reverse=True):
        if _contains_term(term, normalized) and term not in keywords:
            keywords.append(term)
    return keywords


def _section_completeness(resume_text: str) -> float:
    normalized = _normalize(resume_text).lower()
    found = sum(
        1
        for patterns in SECTION_PATTERNS.values()
        if any(pattern in normalized for pattern in patterns)
    )
    if found == 0 and len(normalized) > 600:
        return 25.0
    return round(found / len(SECTION_PATTERNS) * 100, 1)


def _recommendations(
    *,
    keyword_match: float,
    skills_coverage: float,
    section_completeness: float,
    missing_keywords: list[str],
) -> list[str]:
    recommendations: list[str] = []
    if missing_keywords:
        recommendations.append(f"面试重点验证未在简历中出现的关键词：{'、'.join(missing_keywords[:5])}。")
    if keyword_match < 60:
        recommendations.append("JD 与简历的直接关键词证据偏少，建议要求候选人补充可验证的项目案例。")
    if skills_coverage < 60:
        recommendations.append("技能覆盖不足，面试时优先追问技术栈的实际使用深度，而不是只确认是否接触过。")
    if section_completeness < 75:
        recommendations.append("简历结构或经历信息不完整，建议在面试前补齐工作、教育和技能背景。")
    if not recommendations:
        recommendations.append("关键词和技能证据较完整，面试重点转向交付结果、协作方式和业务影响。")
    return recommendations[:5]


def calculate_ats_scores(jd_text: str, resume_text: str) -> dict[str, Any]:
    """Return explainable ATS metrics and evidence for a JD/resume pair."""

    jd_keywords = extract_keywords(jd_text)
    resume_lower = _normalize(resume_text).lower()
    matched_keywords = [keyword for keyword in jd_keywords if _contains_term(keyword, resume_lower)]
    missing_keywords = [keyword for keyword in jd_keywords if keyword not in matched_keywords]

    keyword_match = round(
        len(matched_keywords) / len(jd_keywords) * 100 if jd_keywords else 0.0,
        1,
    )
    jd_skills = [keyword for keyword in jd_keywords if keyword in SKILL_TERMS]
    matched_skills = [keyword for keyword in jd_skills if _contains_term(keyword, resume_lower)]
    skills_coverage = round(
        len(matched_skills) / len(jd_skills) * 100 if jd_skills else keyword_match,
        1,
    )
    section_completeness = _section_completeness(resume_text)

    return {
        "score_version": ATS_SCORE_VERSION,
        "score_breakdown": {
            "keyword_match": keyword_match,
            "skills_coverage": skills_coverage,
            "section_completeness": section_completeness,
        },
        "matched_keywords": matched_keywords[:20],
        "missing_keywords": missing_keywords[:20],
        "recommendations": _recommendations(
            keyword_match=keyword_match,
            skills_coverage=skills_coverage,
            section_completeness=section_completeness,
            missing_keywords=missing_keywords,
        ),
    }


def combine_scores(dimension_total: int, ats_scores: dict[str, Any]) -> int:
    """Blend AI rubric dimensions with deterministic ATS evidence."""

    breakdown = ats_scores.get("score_breakdown") or {}
    keyword_match = float(breakdown.get("keyword_match") or 0)
    skills_coverage = float(breakdown.get("skills_coverage") or 0)
    section_completeness = float(breakdown.get("section_completeness") or 0)
    composite = (
        max(0, min(dimension_total, 100)) * 0.65
        + keyword_match * ATS_WEIGHTS["keyword_match"] * 0.35
        + skills_coverage * ATS_WEIGHTS["skills_coverage"] * 0.35
        + section_completeness * ATS_WEIGHTS["section_completeness"] * 0.35
    )
    return max(0, min(round(composite), 100))
