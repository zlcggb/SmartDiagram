"""AI-assisted resume screening helpers for the recruiting demo module."""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.llm import create_llm, extract_text_content

SCREENING_DIMENSIONS = [
    {
        "key": "ai_practice",
        "label": "AI 应用与编程实践",
        "max_score": 25,
        "keywords": [
            "ai",
            "llm",
            "agent",
            "rag",
            "prompt",
            "copilot",
            "cursor",
            "自动化",
            "工作流",
        ],
    },
    {
        "key": "frontend_delivery",
        "label": "前端 / 全栈交付能力",
        "max_score": 20,
        "keywords": [
            "react",
            "vue",
            "typescript",
            "frontend",
            "full stack",
            "node",
            "fastapi",
            "接口",
        ],
    },
    {
        "key": "business_systems",
        "label": "业务系统经验",
        "max_score": 20,
        "keywords": [
            "crm",
            "erp",
            "saas",
            "workflow",
            "销售",
            "客服",
            "运营",
            "生产",
            "中台",
        ],
    },
    {
        "key": "product_thinking",
        "label": "需求理解与业务思维",
        "max_score": 15,
        "keywords": [
            "需求",
            "产品",
            "业务",
            "方案",
            "调研",
            "落地",
            "demo",
            "验证",
        ],
    },
    {
        "key": "self_drive",
        "label": "自驱与作品能力",
        "max_score": 10,
        "keywords": [
            "github",
            "个人网站",
            "portfolio",
            "side project",
            "博客",
            "开源",
            "独立",
            "创业",
        ],
    },
    {
        "key": "communication",
        "label": "沟通与协作稳定性",
        "max_score": 10,
        "keywords": [
            "沟通",
            "协作",
            "跨团队",
            "lead",
            "owner",
            "stakeholder",
            "面试",
            "管理",
        ],
    },
]


def normalize_text(value: str | None) -> str:
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def compile_resume_text(parsed_document: dict[str, Any] | None, manual_text: str | None = None) -> str:
    manual = normalize_text(manual_text)
    parts: list[str] = []
    if manual:
        parts.append(manual)
    blocks = (parsed_document or {}).get("blocks") or []
    for block in blocks:
        text = normalize_text(str(block.get("text") or ""))
        if not text:
            continue
        locator = str(block.get("source_locator") or "").strip()
        parts.append(f"[{locator}]\n{text}" if locator else text)
    combined = "\n\n".join(parts).strip()
    if len(combined) > 18_000:
        return combined[:18_000].rstrip() + "\n\n[内容已截断]"
    return combined


def _bucket_from_score(score: int) -> str:
    if score >= 85:
        return "进入面试"
    if score >= 70:
        return "人工复核"
    if score >= 60:
        return "进入人才库"
    return "暂不推进"


def _signal_ratio(text: str, keywords: list[str]) -> tuple[int, list[str]]:
    lowered = text.lower()
    hits: list[str] = []
    for keyword in keywords:
        if keyword.lower() in lowered:
            hits.append(keyword)
    return len(hits), hits


def build_fallback_screening(
    *,
    candidate_name: str,
    jd_text: str,
    resume_text: str,
    source_name: str | None = None,
) -> dict[str, Any]:
    full_text = normalize_text("\n\n".join([jd_text, resume_text]))
    dimension_scores: list[dict[str, Any]] = []
    matched_signals: list[str] = []

    for dimension in SCREENING_DIMENSIONS:
        match_count, hits = _signal_ratio(full_text, list(dimension["keywords"]))
        ratio = min(1.0, match_count / max(2, len(dimension["keywords"]) * 0.35))
        score = int(round(float(dimension["max_score"]) * ratio))
        dimension_scores.append(
            {
                "key": dimension["key"],
                "label": dimension["label"],
                "score": score,
                "max_score": dimension["max_score"],
                "reason": "命中信号：" + ("、".join(hits[:4]) if hits else "信息不足，建议面试追问。"),
            }
        )
        matched_signals.extend(hits[:3])

    total_score = sum(item["score"] for item in dimension_scores)
    recommendation = _bucket_from_score(total_score)
    strong_dimensions = [item["label"] for item in dimension_scores if item["score"] >= item["max_score"] * 0.7]
    weak_dimensions = [item["label"] for item in dimension_scores if item["score"] <= item["max_score"] * 0.35]

    return {
        "candidate_name": candidate_name or "候选人",
        "job_summary": normalize_text(jd_text)[:280],
        "total_score": total_score,
        "max_score": 100,
        "recommendation": recommendation,
        "overall_summary": (
            f"{candidate_name or '候选人'} 的经历与岗位要求存在 "
            f"{'较强' if total_score >= 75 else '部分'} 匹配，建议关注 {('、'.join(weak_dimensions[:3]) or '业务背景补充')}。"
        ),
        "dimension_scores": dimension_scores,
        "matched_signals": list(dict.fromkeys(matched_signals))[:8],
        "strengths": strong_dimensions[:4] or ["有一定相关经历，可继续人工复核。"],
        "risks": weak_dimensions[:4] or ["建议在面试中补充验证交付深度与稳定性。"],
        "interview_questions": [
            "请举一个你独立完成 AI 应用 demo 的案例，如何从需求到上线？",
            "你做过哪些销售、客服、运营或生产类系统？你承担了什么角色？",
            "如果让你两周内完成一个招聘筛选 demo，你会如何拆解优先级？",
        ],
        "evidence_excerpt": normalize_text(resume_text)[:600],
        "source_name": source_name or "",
        "evaluation_mode": "fallback",
    }


def extract_json_object(raw_text: str) -> dict[str, Any]:
    text = normalize_text(raw_text)
    if not text:
        raise ValueError("empty_llm_response")

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("json_not_found")
    return json.loads(text[start : end + 1])


def coerce_screening_result(payload: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    raw_dimensions = payload.get("dimension_scores")
    normalized_dimensions: list[dict[str, Any]] = []
    fallback_dimensions = {item["key"]: item for item in fallback["dimension_scores"]}

    if isinstance(raw_dimensions, list):
        for item in raw_dimensions:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            fallback_item = fallback_dimensions.get(key)
            if not fallback_item:
                continue
            score = item.get("score", fallback_item["score"])
            try:
                score_value = max(0, min(int(score), int(fallback_item["max_score"])))
            except (TypeError, ValueError):
                score_value = fallback_item["score"]
            normalized_dimensions.append(
                {
                    "key": key,
                    "label": str(item.get("label") or fallback_item["label"]),
                    "score": score_value,
                    "max_score": int(fallback_item["max_score"]),
                    "reason": normalize_text(str(item.get("reason") or fallback_item["reason"])),
                }
            )

    if not normalized_dimensions:
        normalized_dimensions = fallback["dimension_scores"]

    total_score = sum(item["score"] for item in normalized_dimensions)
    return {
        **fallback,
        "candidate_name": normalize_text(str(payload.get("candidate_name") or fallback["candidate_name"])),
        "job_summary": normalize_text(str(payload.get("job_summary") or fallback["job_summary"]))[:280],
        "total_score": max(0, min(total_score, 100)),
        "recommendation": normalize_text(str(payload.get("recommendation") or _bucket_from_score(total_score))),
        "overall_summary": normalize_text(str(payload.get("overall_summary") or fallback["overall_summary"])),
        "dimension_scores": normalized_dimensions,
        "matched_signals": [
            normalize_text(str(item))
            for item in (payload.get("matched_signals") or fallback["matched_signals"])
            if normalize_text(str(item))
        ][:8],
        "strengths": [
            normalize_text(str(item))
            for item in (payload.get("strengths") or fallback["strengths"])
            if normalize_text(str(item))
        ][:5],
        "risks": [
            normalize_text(str(item))
            for item in (payload.get("risks") or fallback["risks"])
            if normalize_text(str(item))
        ][:5],
        "interview_questions": [
            normalize_text(str(item))
            for item in (payload.get("interview_questions") or fallback["interview_questions"])
            if normalize_text(str(item))
        ][:5],
        "evidence_excerpt": fallback["evidence_excerpt"],
        "source_name": fallback["source_name"],
        "evaluation_mode": "ai",
    }


def _screening_messages(candidate_name: str, jd_text: str, resume_text: str) -> list[Any]:
    rubric_lines = "\n".join(
        f"- {item['label']}：{item['max_score']} 分" for item in SCREENING_DIMENSIONS
    )
    return [
        SystemMessage(
            content=(
                "你是一名招聘评估助手。请根据岗位 JD 与候选人简历做 100 分制初筛，"
                "输出严格 JSON，不要输出 markdown，不要补充解释。"
            )
        ),
        HumanMessage(
            content=(
                "评分维度：\n"
                f"{rubric_lines}\n\n"
                "请返回 JSON，字段包含：candidate_name, job_summary, overall_summary, "
                "recommendation, matched_signals, strengths, risks, interview_questions, dimension_scores。\n"
                "其中 dimension_scores 是数组，每项包含 key, label, score, reason。\n\n"
                f"候选人：{candidate_name or '候选人'}\n\n"
                f"岗位 JD：\n{jd_text}\n\n"
                f"简历内容：\n{resume_text}"
            )
        ),
    ]


async def screen_candidate_profile(
    *,
    candidate_name: str,
    jd_text: str,
    resume_text: str,
    source_name: str | None = None,
) -> dict[str, Any]:
    fallback = build_fallback_screening(
        candidate_name=candidate_name,
        jd_text=jd_text,
        resume_text=resume_text,
        source_name=source_name,
    )
    try:
        llm = create_llm()
        response = await llm.ainvoke(_screening_messages(candidate_name, jd_text, resume_text))
        payload = extract_json_object(extract_text_content(response.content))
        return coerce_screening_result(payload, fallback)
    except Exception:
        return fallback
