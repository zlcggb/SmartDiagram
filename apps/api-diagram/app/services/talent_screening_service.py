"""AI-assisted resume screening helpers for the recruiting demo module."""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.llm import create_llm, extract_text_content
from app.services.ats_scoring_service import (
    SKILL_TERMS,
    calculate_ats_scores,
    combine_scores,
    extract_keywords,
)

SCREENING_DIMENSIONS = [
    {
        "key": "education_fit",
        "label": "教育背景与专业基础",
        "max_score": 15,
        "keywords": [
            "本科",
            "硕士",
            "博士",
            "研究生",
            "计算机",
            "软件",
            "电子",
            "信息",
            "工程",
            "数学",
            "物理",
        ],
        "sections": ["education"],
    },
    {
        "key": "experience_fit",
        "label": "相关经历与岗位匹配",
        "max_score": 25,
        "keywords": [
            "工作",
            "实习",
            "业务",
            "系统",
            "交付",
            "上线",
            "开发",
            "工程",
            "需求",
        ],
        "sections": ["experience", "projects", "competitions"],
    },
    {
        "key": "technical_skills",
        "label": "技术技能与工具覆盖",
        "max_score": 25,
        "keywords": [
            "ai",
            "llm",
            "agent",
            "rag",
            "react",
            "vue",
            "typescript",
            "python",
            "c++",
            "fastapi",
            "sql",
            "linux",
            "docker",
            "自动化",
            "工作流",
        ],
        "sections": ["skills", "experience", "projects"],
    },
    {
        "key": "project_evidence",
        "label": "项目深度与可验证成果",
        "max_score": 20,
        "keywords": [
            "项目",
            "负责",
            "核心",
            "独立",
            "算法",
            "方案",
            "验证",
            "实现",
            "部署",
            "优化",
        ],
        "sections": ["projects", "experience", "competitions"],
    },
    {
        "key": "delivery_impact",
        "label": "交付结果与影响力",
        "max_score": 10,
        "keywords": [
            "提升",
            "降低",
            "减少",
            "增长",
            "加速",
            "达到",
            "完成",
            "落地",
            "上线",
            "倍",
            "%",
        ],
        "sections": ["experience", "projects", "competitions", "awards"],
    },
    {
        "key": "ownership_collaboration",
        "label": "主动性与协作能力",
        "max_score": 10,
        "keywords": [
            "沟通",
            "协作",
            "跨团队",
            "团队",
            "组织",
            "协调",
            "主导",
            "负责人",
            "lead",
            "owner",
            "管理",
        ],
        "sections": ["experience", "projects", "competitions", "awards"],
    },
]

PROFILE_SECTION_ALIASES = {
    "summary": (
        "个人简介",
        "个人概述",
        "自我评价",
        "求职目标",
        "summary",
        "profile",
        "objective",
    ),
    "education": (
        "教育背景",
        "教育经历",
        "教育",
        "学历",
        "education",
        "academic background",
    ),
    "experience": (
        "工作经历",
        "工作经验",
        "实习经历",
        "职业经历",
        "工作履历",
        "experience",
        "employment",
        "work history",
    ),
    "projects": (
        "项目经历",
        "项目经验",
        "个人项目",
        "项目",
        "projects",
        "project experience",
    ),
    "skills": (
        "专业能力",
        "专业技能",
        "相关技能",
        "技能",
        "技术栈",
        "相关技能与荣誉证书",
        "technical skills",
        "skills",
        "technologies",
    ),
    "awards": (
        "成果及奖励",
        "荣誉奖项",
        "获奖情况",
        "奖项",
        "证书",
        "相关技能与荣誉证书",
        "awards",
        "certifications",
    ),
    "competitions": (
        "竞赛经历",
        "竞赛",
        "competition",
        "competitions",
    ),
}
PROFILE_SECTION_NAMES = tuple(PROFILE_SECTION_ALIASES.keys())

_RESUME_DATE_RE = re.compile(
    r"(?<!\d)(?:(?:19|20)\d{2}\s*[./年-]\s*(?:\d{1,2})|(?:19|20)\d{2})(?!\d)"
    r"(?:\s*[~～\-—至到]\s*(?:(?:(?:19|20)\d{2}\s*[./年-]\s*(?:\d{1,2}))|"
    r"(?:19|20)\d{2}|至今|现在|今))?"
)
_DEGREE_RE = re.compile(
    r"(博士后|博士|硕士|研究生|本科|学士|专科|PhD|Master|Bachelor)",
    re.IGNORECASE,
)
_BULLET_RE = re.compile(r"^\s*(?:[-*•●▪◦※⚫]|\d+[)、])\s*")


def normalize_text(value: str | None) -> str:
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def compile_resume_text(parsed_document: dict[str, Any] | None, manual_text: str | None = None) -> str:
    manual = normalize_text(manual_text)
    parsed_parts: list[str] = []
    blocks = (parsed_document or {}).get("blocks") or []
    for block in blocks:
        text = normalize_text(str(block.get("text") or ""))
        if not text:
            continue
        locator = str(block.get("source_locator") or "").strip()
        parsed_parts.append(f"[{locator}]\n{text}" if locator else text)
    parsed_text = "\n\n".join(parsed_parts).strip()
    if manual and parsed_text and manual == parsed_text:
        return parsed_text[:18_000].rstrip() + ("\n\n[内容已截断]" if len(parsed_text) > 18_000 else "")
    parts = [item for item in (manual, parsed_text) if item]
    combined = "\n\n".join(parts).strip()
    if len(combined) > 18_000:
        return combined[:18_000].rstrip() + "\n\n[内容已截断]"
    return combined


def _resume_lines(resume_text: str) -> list[dict[str, Any]]:
    """Keep parsed resume lines and their PDF locator for later evidence citations."""

    lines: list[dict[str, Any]] = []
    current_locator = ""
    for raw_line in normalize_text(resume_text).splitlines():
        line = normalize_text(raw_line)
        if not line:
            continue
        locator_match = re.match(r"^\[([^\]]+)\]\s*", line)
        if locator_match:
            current_locator = locator_match.group(1).strip()
            line = line[locator_match.end() :].strip()
        if not line:
            continue
        is_bullet = bool(_BULLET_RE.match(line))
        is_record_marker = line.lstrip().startswith("※")
        cleaned = _BULLET_RE.sub("", line).strip(" |·")
        if cleaned:
            lines.append(
                {
                    "text": cleaned,
                    "source_locator": current_locator,
                    "is_bullet": is_bullet,
                    "is_record_marker": is_record_marker,
                }
            )
    return lines


def _compact_heading(value: str) -> str:
    return re.sub(r"[\s:：|/·•\-]+", "", value).casefold()


def _section_from_line(line: str) -> tuple[str | None, str]:
    """Return a known resume section and optional inline content."""

    stripped = line.strip()
    compact = _compact_heading(stripped)
    for section, aliases in PROFILE_SECTION_ALIASES.items():
        for alias in aliases:
            alias_compact = _compact_heading(alias)
            if compact == alias_compact:
                return section, ""
            match = re.match(rf"^{re.escape(alias)}\s*[:：]\s*(.+)$", stripped, re.IGNORECASE)
            if match:
                return section, match.group(1).strip()
    return None, ""


def _group_profile_sections(lines: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    sections: dict[str, list[dict[str, Any]]] = {"header": []}
    current = "header"
    for line in lines:
        section, inline_content = _section_from_line(str(line["text"]))
        if section:
            current = section
            sections.setdefault(section, [])
            if inline_content:
                sections[section].append({**line, "text": inline_content})
            continue
        if line.get("is_record_marker") and current in {"header", "projects", "competitions"}:
            text = str(line.get("text") or "")
            current = "competitions" if re.search(r"挑战赛|竞赛|比赛", text) else "projects"
            sections.setdefault(current, []).append(line)
            continue
        if current == "header":
            text = str(line.get("text") or "")
            if _DEGREE_RE.search(text) and _has_resume_date(text):
                sections.setdefault("education", []).append(line)
                continue
        sections.setdefault(current, []).append(line)
    return sections


def _section_evidence(
    sections: dict[str, list[dict[str, Any]]],
    section: str,
    *,
    limit: int = 12,
) -> list[dict[str, str]]:
    return [
        {
            "text": normalize_text(str(item.get("text") or ""))[:420],
            "source_locator": normalize_text(str(item.get("source_locator") or "")),
        }
        for item in sections.get(section, [])[:limit]
        if normalize_text(str(item.get("text") or ""))
    ]


def _has_resume_date(value: str) -> bool:
    return bool(_RESUME_DATE_RE.search(value))


def _record_starts(
    item: dict[str, Any],
    current: list[dict[str, Any]],
    *,
    section: str,
) -> bool:
    if not current:
        return True
    text = str(item.get("text") or "")
    if item.get("is_record_marker") and text and section in {"experience", "projects", "competitions"}:
        return True
    if current[0].get("is_record_marker"):
        return False
    # A date starts a new row when the current row also starts with a date.
    # This preserves layouts where a project title is followed by its date.
    return _has_resume_date(text) and _has_resume_date(str(current[0].get("text") or ""))


def _split_profile_records(
    sections: dict[str, list[dict[str, Any]]],
    section: str,
) -> list[list[dict[str, Any]]]:
    if section == "education":
        records: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        for item in sections.get(section, []):
            text = str(item.get("text") or "")
            if _has_resume_date(text) and (_DEGREE_RE.search(text) or _extract_institution(text)):
                if current:
                    records.append(current)
                current = [item]
            elif current:
                current.append(item)
        if current:
            records.append(current)
        return [
            record
            for record in records
            if _DEGREE_RE.search(" ".join(str(item.get("text") or "") for item in record))
            or _extract_institution(" ".join(str(item.get("text") or "") for item in record))
        ]

    records: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for item in sections.get(section, []):
        if _record_starts(item, current, section=section):
            if current:
                records.append(current)
            current = [item]
        else:
            current.append(item)
    if current:
        records.append(current)
    return [record for record in records if any(str(item.get("text") or "").strip() for item in record)]


def _extract_institution(text: str) -> str:
    matches = re.findall(r"[\u4e00-\u9fffA-Za-z·]{2,30}(?:大学|学院|学校)", text)
    if not matches:
        matches = re.findall(
            r"[\u4e00-\u9fffA-Za-z0-9（）()·.&\-\s]{2,42}"
            r"(?:University|College)",
            text,
            re.IGNORECASE,
        )
    if not matches:
        return ""
    return re.sub(
        r"^\s*(?:(?:19|20)\d{2}(?:[./-]\d{1,2})?\s*)+",
        "",
        matches[-1],
    ).strip()


def _extract_company(text: str) -> str:
    cleaned = re.sub(
        r"^\s*(?:(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:\s*[-至到]\s*(?:19|20)?\d{0,2}(?:[./-]\d{1,2})?)?)\s*",
        "",
        text,
    ).strip(" |·-")
    if not cleaned:
        return ""
    return re.split(r"\s{2,}|[|｜]", cleaned, maxsplit=1)[0].strip()[:80]


def _extract_major(text: str) -> str:
    pipe_major = re.search(
        r"([\u4e00-\u9fffA-Za-z0-9]{2,24})\s*[|｜]\s*"
        r"(?:本科|硕士|博士|研究生|学士|专科)",
        text,
        re.IGNORECASE,
    )
    if pipe_major:
        return normalize_text(pipe_major.group(1))
    degree_in_parentheses = re.search(
        r"([\u4e00-\u9fffA-Za-z0-9]{2,24})\s*[（(]\s*"
        r"(?:本科|硕士|博士|研究生|学士|专科|免试硕士)",
        text,
        re.IGNORECASE,
    )
    if degree_in_parentheses:
        return normalize_text(degree_in_parentheses.group(1))
    labeled = re.search(r"(?:专业|方向|major)\s*[:：|]?\s*([^|，,；;]+)", text, re.IGNORECASE)
    if labeled:
        value = normalize_text(labeled.group(1)).strip("()（）")
        if len(value) >= 2:
            return value
    degree_match = _DEGREE_RE.search(text)
    if degree_match:
        tail = text[degree_match.end() :].strip(" ：:|，,")
        school_major = re.search(
            r"(?:大学|学院|学校)\s+([\u4e00-\u9fffA-Za-z]{2,24})",
            tail,
        )
        if school_major:
            return normalize_text(school_major.group(1))
        if tail:
            return normalize_text(re.split(r"\s{2,}|[|｜]", tail)[0])[:80]
    return ""


def _record_years(text: str) -> str:
    matches = list(_RESUME_DATE_RE.finditer(text))
    if not matches:
        return ""
    detailed = [
        match.group(0)
        for match in matches
        if any(separator in match.group(0) for separator in (".", "/", "-", "~", "至", "～"))
    ]
    return detailed[0] if detailed else matches[0].group(0)


def _record_payload(record: list[dict[str, Any]], section: str) -> dict[str, Any]:
    text = " ".join(str(item.get("text") or "") for item in record).strip()
    header = " ".join(str(item.get("text") or "") for item in record[:2]).strip()
    years = _record_years(text)
    evidence = normalize_text(" ".join(str(item.get("text") or "") for item in record[:5]))[:900]
    locator = next(
        (
            normalize_text(str(item.get("source_locator") or ""))
            for item in record
            if normalize_text(str(item.get("source_locator") or ""))
        ),
        "",
    )
    if section == "education":
        return {
            "institution": _extract_institution(header),
            "degree": (_DEGREE_RE.search(header).group(1) if _DEGREE_RE.search(header) else ""),
            "major": _extract_major(header),
            "years": years,
            "evidence": evidence,
            "source_locator": locator,
        }
    if section in {"projects", "competitions"}:
        name = re.sub(
            r"^\s*(?:"
            r"(?:19|20)\d{2}[./-]\d{1,2}"
            r"(?:\s*[-至到]\s*(?:19|20)?\d{2}[./-]\d{1,2})?"
            r")\s*",
            "",
            str(record[0].get("text") or ""),
        ).strip()
        name = re.sub(r"\s{2,}", " ", name)
        return {
            "name": name,
            "role": "",
            "years": years,
            "evidence": evidence,
            "source_locator": locator,
            "kind": section,
        }
    return {
        "company": _extract_company(header),
        "title": header[:140],
        "years": years,
        "evidence": evidence,
        "source_locator": locator,
    }


def _extract_skill_terms(skill_evidence: list[dict[str, str]], full_text: str) -> list[str]:
    source = "\n".join(item["text"] for item in skill_evidence)
    candidates = extract_keywords(source or full_text)
    terms: list[str] = []
    for candidate in candidates:
        if candidate in SKILL_TERMS or re.search(r"[+#./-]", candidate):
            if candidate not in terms:
                terms.append(candidate)
    for term in sorted(SKILL_TERMS, key=len, reverse=True):
        if term not in terms and _contains_term(term, full_text.lower()):
            terms.append(term)
    return terms[:32]


def extract_resume_profile(resume_text: str) -> dict[str, Any]:
    """Extract high-signal resume structure and keep source evidence local."""

    text = normalize_text(resume_text)
    lines = _resume_lines(text)
    sections = _group_profile_sections(lines)
    header_text = "\n".join(str(item["text"]) for item in sections.get("header", []))
    email_match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)
    phone_match = re.search(r"(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)", text)

    profile: dict[str, Any] = {
        "full_name": "",
        "email": email_match.group(0) if email_match else "",
        "phone": phone_match.group(0) if phone_match else "",
        "current_company": "",
        "location": "",
        "headline": "",
        "summary": "",
        "education": [
            _record_payload(record, "education")
            for record in _split_profile_records(sections, "education")
        ][:8],
        "experience": [
            _record_payload(record, "experience")
            for record in _split_profile_records(sections, "experience")
        ][:8],
        "projects": [
            _record_payload(record, "projects")
            for record in _split_profile_records(sections, "projects")
        ][:8],
        "competitions": [
            _record_payload(record, "competitions")
            for record in _split_profile_records(sections, "competitions")
        ][:6],
        "skills": [],
        "certifications": _section_evidence(sections, "awards", limit=8),
        "section_evidence": {
            section: _section_evidence(sections, section)
            for section in PROFILE_SECTION_NAMES
        },
        "section_presence": {
            section: bool(_section_evidence(sections, section, limit=1))
            for section in PROFILE_SECTION_NAMES
        },
    }

    labeled_name = re.search(
        r"(?:姓\s*名|name)\s*[:：]\s*"
        r"([^\n:：|]+?)(?=\s+(?:个人)?(?:邮箱|email)|\s+(?:联系电话|电话|phone)|\s+政治面貌|$)",
        text,
        re.IGNORECASE,
    )
    if labeled_name:
        profile["full_name"] = normalize_text(labeled_name.group(1))

    for line in lines[:40]:
        value = str(line["text"])
        labeled_name = re.match(r"^(?:姓\s*名|name)\s*[:：]\s*(.+)$", value, re.IGNORECASE)
        if labeled_name and not profile["full_name"]:
            profile["full_name"] = labeled_name.group(1).strip()
            break
        if not profile["full_name"] and re.fullmatch(r"[\u4e00-\u9fff]{2,4}", value):
            if value not in {"个人简历", "基本信息", "教育背景", "项目经历", "专业能力", "荣誉奖项"}:
                profile["full_name"] = value
                break
        if not profile["full_name"] and re.fullmatch(r"[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2}", value):
            if value.lower() not in {"resume", "curriculum vitae", "profile"}:
                profile["full_name"] = value
                break

    for key, labels in {
        "current_company": ("当前公司", "公司", "company", "employer"),
        "location": ("所在地", "城市", "地址", "location", "city", "籍\\s*贯"),
    }.items():
        for label in labels:
            match = re.search(rf"(?:{label})\s*[:：]\s*([^\n|]+)", text, re.IGNORECASE)
            if match:
                profile[key] = normalize_text(match.group(1))
                break

    profile["summary"] = normalize_text(
        "\n".join(item["text"] for item in sections.get("summary", [])[:4])
    )
    if not profile["summary"]:
        profile["headline"] = normalize_text(header_text.splitlines()[0] if header_text else "")
    profile["skills"] = _extract_skill_terms(profile["section_evidence"]["skills"], text.lower())
    if not profile["current_company"] and profile["experience"]:
        profile["current_company"] = normalize_text(str(profile["experience"][0].get("company") or ""))

    return profile


def _bucket_from_score(score: int) -> str:
    if score >= 85:
        return "进入面试"
    if score >= 70:
        return "人工复核"
    if score >= 60:
        return "进入人才库"
    return "暂不推进"


def _contains_term(term: str, text_lower: str) -> bool:
    normalized = term.strip().lower()
    if not normalized:
        return False
    if any("\u4e00" <= character <= "\u9fff" for character in normalized):
        return normalized in text_lower
    return bool(re.search(rf"(?<!\w){re.escape(normalized)}(?!\w)", text_lower))


def _keyword_hits(text: str, keywords: list[str]) -> list[str]:
    lowered = normalize_text(text).lower()
    return [keyword for keyword in keywords if _contains_term(keyword, lowered)]


def _profile_section_text(profile: dict[str, Any], sections: list[str]) -> str:
    evidence: list[str] = []
    for section in sections:
        evidence.extend(
            str(item.get("text") or "")
            for item in (profile.get("section_evidence") or {}).get(section, [])
        )
    return "\n".join(item for item in evidence if item)


def _dimension_evidence(
    profile: dict[str, Any],
    *,
    sections: list[str],
    terms: list[str],
    limit: int = 3,
) -> list[dict[str, str]]:
    evidence: list[dict[str, str]] = []
    for section in sections:
        for item in (profile.get("section_evidence") or {}).get(section, []):
            text = normalize_text(str(item.get("text") or ""))
            if not text:
                continue
            if _keyword_hits(text, terms) or not evidence:
                evidence.append(
                    {
                        "label": "简历证据",
                        "text": text[:360],
                        "source_locator": normalize_text(str(item.get("source_locator") or "")),
                        "kind": "resume",
                    }
                )
            if len(evidence) >= limit:
                return evidence
    return evidence


def _build_dimension_scores(
    *,
    profile: dict[str, Any],
    resume_text: str,
    jd_text: str,
    ats_scores: dict[str, Any],
) -> list[dict[str, Any]]:
    """Score only resume evidence; the JD is used to define the comparison terms."""

    jd_keywords = extract_keywords(jd_text)
    dimensions: list[dict[str, Any]] = []
    for dimension in SCREENING_DIMENSIONS:
        sections = list(dimension["sections"])
        section_text = _profile_section_text(profile, sections) or resume_text
        fixed_hits = _keyword_hits(section_text, list(dimension["keywords"]))
        jd_hits = _keyword_hits(section_text, jd_keywords)
        has_section = any(
            (profile.get("section_presence") or {}).get(section, False)
            for section in sections
        )
        signal_ratio = len(fixed_hits) / max(1, min(len(dimension["keywords"]), 8))
        jd_ratio = len(jd_hits) / max(1, min(len(jd_keywords), 6))
        if dimension["key"] == "technical_skills":
            ratio = float((ats_scores.get("score_breakdown") or {}).get("skills_coverage") or 0) / 100
        else:
            ratio = (0.35 if has_section else 0.0) + signal_ratio * 0.35 + jd_ratio * 0.30
        ratio = max(0.0, min(1.0, ratio))
        score = int(round(float(dimension["max_score"]) * ratio))

        evidence_terms = list(dict.fromkeys([*jd_keywords, *dimension["keywords"]]))
        evidence = _dimension_evidence(profile, sections=sections, terms=evidence_terms)
        gaps: list[str] = []
        if not has_section:
            gaps.append(f"未提取到{dimension['label']}对应的简历段落。")
        if not jd_hits:
            gaps.append("简历中没有找到与当前 JD 关键词直接对应的证据。")
        if score < dimension["max_score"] * 0.55 and has_section:
            gaps.append("有相关段落，但深度、结果或岗位关联度需要面试核实。")
        reason_parts = [
            f"简历信号 {', '.join(fixed_hits[:4]) or '无'}",
            f"与 JD 的直接交集 {', '.join(jd_hits[:4]) or '无'}",
        ]
        if evidence:
            reason_parts.append(f"引用 {len(evidence)} 条简历证据")
        dimensions.append(
            {
                "key": dimension["key"],
                "label": dimension["label"],
                "score": score,
                "max_score": int(dimension["max_score"]),
                "weight": int(dimension["max_score"]),
                "reason": "；".join(reason_parts) + "。",
                "evidence": evidence,
                "gaps": gaps[:3],
                "matched_signals": list(dict.fromkeys([*fixed_hits, *jd_hits]))[:8],
            }
        )
    return dimensions


def _interview_questions(
    *,
    dimension_scores: list[dict[str, Any]],
    missing_keywords: list[str],
    profile: dict[str, Any],
) -> list[str]:
    questions: list[str] = []
    weak_dimensions = [
        item for item in dimension_scores if item["score"] < item["max_score"] * 0.6
    ]
    for item in weak_dimensions[:3]:
        evidence = (item.get("evidence") or [{}])[0].get("text")
        if evidence:
            questions.append(
                f"请围绕简历中的“{str(evidence)[:80]}”说明你本人负责的部分、技术取舍和最终结果。"
            )
        else:
            questions.append(
                f"简历对“{item['label']}”证据不足，请提供一个可复盘的真实案例和量化结果。"
            )
    for keyword in missing_keywords[:3]:
        questions.append(
            f"当前 JD 关注“{keyword}”，简历没有直接证据；你是否实际使用过？请说明场景、个人贡献和产出。"
        )
    if not questions and profile.get("projects"):
        questions.append("请挑选一个最能代表你的项目，从目标、个人贡献、难点和结果四步复盘。")
    if not questions:
        questions.append("请说明你最近一次从需求澄清到交付上线的完整经历，以及如何验证结果。")
    return list(dict.fromkeys(questions))[:6]


def _build_score_report(
    *,
    candidate_name: str,
    jd_text: str,
    resume_text: str,
    profile: dict[str, Any],
    ats_scores: dict[str, Any],
    dimension_scores: list[dict[str, Any]],
) -> dict[str, Any]:
    dimension_total = sum(int(item["score"]) for item in dimension_scores)
    breakdown = ats_scores.get("score_breakdown") or {}
    ats_score = round(
        float(breakdown.get("keyword_match") or 0) * 0.55
        + float(breakdown.get("skills_coverage") or 0) * 0.25
        + float(breakdown.get("section_completeness") or 0) * 0.20,
        1,
    )
    total_score = combine_scores(dimension_total, ats_scores)
    recommendation = _bucket_from_score(total_score)
    should_interview = total_score >= 70
    priority = "high" if total_score >= 85 else "review" if total_score >= 70 else "pool" if total_score >= 60 else "low"
    core_sections = ("education", "experience", "projects", "skills")
    evidence_coverage = round(
        sum(
            1
            for section in core_sections
            if (profile.get("section_presence") or {}).get(section, False)
        )
        / len(core_sections)
        * 100,
        1,
    )
    confidence = round(min(100.0, evidence_coverage * 0.7 + min(len(resume_text) / 1800, 1.0) * 30), 1)
    missing_keywords = list(ats_scores.get("missing_keywords") or [])
    strengths = [
        item["label"]
        for item in dimension_scores
        if item["score"] >= item["max_score"] * 0.7
    ][:4]
    if not strengths and profile.get("education"):
        strengths.append("简历至少包含可核验的教育背景")
    gaps = list(
        dict.fromkeys(
            [
                *missing_keywords[:5],
                *[
                    gap
                    for item in dimension_scores
                    for gap in item.get("gaps") or []
                ],
            ]
        )
    )[:6]
    risks = [
        item["label"]
        for item in dimension_scores
        if item["score"] < item["max_score"] * 0.55
    ][:4]
    if not risks:
        risks.append("核心经历仍需通过面试核验真实性、个人贡献和交付深度。")
    interview_questions = _interview_questions(
        dimension_scores=dimension_scores,
        missing_keywords=missing_keywords,
        profile=profile,
    )
    decision_reason = (
        "建议优先安排面试，重点确认简历证据对应的个人贡献和交付结果。"
        if priority == "high"
        else "有可用匹配证据，建议先人工复核重点经历后安排面试。"
        if priority == "review"
        else "证据不足以优先安排面试，建议补充材料或暂存人才库。"
    )
    component_scores = [
        {
            "key": "capability_dimensions",
            "label": "能力与经历证据",
            "score": dimension_total,
            "max_score": 100,
            "weight": 65,
            "contribution": round(dimension_total * 0.65, 1),
        },
        {
            "key": "jd_evidence",
            "label": "JD 直接证据",
            "score": ats_score,
            "max_score": 100,
            "weight": 35,
            "contribution": round(ats_score * 0.35, 1),
        },
    ]
    score_explanation = (
        "总分 = 能力与经历证据 × 65% + JD 直接证据 × 35%。"
        "邮箱、电话只用于联系和去重，不参与评分；教育背景、经历、技能、项目和可验证结果才是主要证据。"
    )
    return {
        "title": "证据优先评分报告",
        "model": ats_scores.get("score_version") or "evidence-v2",
        "score_explanation": score_explanation,
        "component_scores": component_scores,
        "evidence_coverage": evidence_coverage,
        "confidence": confidence,
        "decision": {
            "recommendation": recommendation,
            "should_interview": should_interview,
            "priority": priority,
            "reason": decision_reason,
        },
        "strengths": strengths or ["暂未发现足够强的直接匹配证据。"],
        "gaps": gaps or ["暂无明确缺口，但仍需面试核实。"],
        "risks": risks,
        "interview_focus": interview_questions,
        "dimension_scores": dimension_scores,
        "ats_metrics": [
            {
                "key": "keyword_match",
                "label": "JD 关键词匹配",
                "score": float(breakdown.get("keyword_match") or 0),
                "weight": 55,
            },
            {
                "key": "skills_coverage",
                "label": "技能覆盖",
                "score": float(breakdown.get("skills_coverage") or 0),
                "weight": 25,
            },
            {
                "key": "section_completeness",
                "label": "简历结构完整度",
                "score": float(breakdown.get("section_completeness") or 0),
                "weight": 20,
            },
        ],
        "matched_keywords": ats_scores.get("matched_keywords") or [],
        "missing_keywords": missing_keywords,
        "evidence_excerpt": "\n".join(
            item["text"]
            for dimension in dimension_scores
            for item in (dimension.get("evidence") or [])
        )[:1800],
        "jd_summary": normalize_text(jd_text)[:600],
        "candidate_name": candidate_name or "候选人",
    }


def build_fallback_screening(
    *,
    candidate_name: str,
    jd_text: str,
    resume_text: str,
    source_name: str | None = None,
) -> dict[str, Any]:
    profile = extract_resume_profile(resume_text)
    ats_scores = calculate_ats_scores(jd_text, resume_text)
    dimension_scores = _build_dimension_scores(
        profile=profile,
        resume_text=resume_text,
        jd_text=jd_text,
        ats_scores=ats_scores,
    )
    report = _build_score_report(
        candidate_name=candidate_name,
        jd_text=jd_text,
        resume_text=resume_text,
        profile=profile,
        ats_scores=ats_scores,
        dimension_scores=dimension_scores,
    )
    dimension_total = sum(item["score"] for item in dimension_scores)
    total_score = combine_scores(dimension_total, ats_scores)
    recommendation = _bucket_from_score(total_score)
    matched_signals = list(
        dict.fromkeys(
            signal
            for item in dimension_scores
            for signal in item.get("matched_signals") or []
        )
    )

    return {
        "candidate_name": candidate_name or "候选人",
        "job_summary": normalize_text(jd_text)[:280],
        "total_score": total_score,
        "max_score": 100,
        "recommendation": recommendation,
        "overall_summary": (
            f"{candidate_name or '候选人'} 的评分基于 "
            f"{report['evidence_coverage']}% 核心简历段落证据。"
            f"{report['decision']['reason']}"
        ),
        "dimension_scores": dimension_scores,
        "matched_signals": list(dict.fromkeys(matched_signals))[:8],
        "strengths": report["strengths"],
        "risks": report["risks"],
        "interview_questions": report["interview_focus"],
        "evidence_excerpt": report["evidence_excerpt"],
        "score_version": ats_scores["score_version"],
        "score_breakdown": ats_scores["score_breakdown"],
        "matched_keywords": ats_scores["matched_keywords"],
        "missing_keywords": ats_scores["missing_keywords"],
        "recommendations": list(
            dict.fromkeys(
                [
                    *ats_scores["recommendations"],
                    *report["gaps"][:3],
                ]
            )
        )[:6],
        "score_report": report,
        "resume_profile": profile,
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
    legacy_aliases = {
        "ai_practice": "technical_skills",
        "frontend_delivery": "experience_fit",
        "business_systems": "experience_fit",
        "product_thinking": "project_evidence",
        "self_drive": "delivery_impact",
        "communication": "ownership_collaboration",
    }

    if isinstance(raw_dimensions, list):
        for item in raw_dimensions:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            fallback_item = fallback_dimensions.get(key) or fallback_dimensions.get(legacy_aliases.get(key, ""))
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
                    "weight": int(fallback_item.get("weight") or fallback_item["max_score"]),
                    "reason": normalize_text(str(item.get("reason") or fallback_item["reason"])),
                    "evidence": fallback_item.get("evidence") or [],
                    "gaps": fallback_item.get("gaps") or [],
                    "matched_signals": fallback_item.get("matched_signals") or [],
                }
            )

    if not normalized_dimensions:
        normalized_dimensions = fallback["dimension_scores"]

    total_score = combine_scores(
        sum(item["score"] for item in normalized_dimensions),
        {"score_breakdown": fallback["score_breakdown"]},
    )
    report = dict(fallback.get("score_report") or {})
    capability_score = sum(item["score"] for item in normalized_dimensions)
    report["dimension_scores"] = normalized_dimensions
    report["component_scores"] = [
        {
            "key": "capability_dimensions",
            "label": "能力与经历证据",
            "score": capability_score,
            "max_score": 100,
            "weight": 65,
            "contribution": round(capability_score * 0.65, 1),
        },
        *(report.get("component_scores") or [])[1:2],
    ]
    report["decision"] = {
        **(report.get("decision") or {}),
        "recommendation": _bucket_from_score(total_score),
        "should_interview": total_score >= 70,
    }
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
        "matched_keywords": fallback["matched_keywords"],
        "missing_keywords": fallback["missing_keywords"],
        "recommendations": fallback["recommendations"],
        "score_version": fallback["score_version"],
        "score_breakdown": fallback["score_breakdown"],
        "score_report": report,
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
