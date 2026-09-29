"""Resume text/profile helpers and the screening entry point for the recruiting module."""

from __future__ import annotations

import hashlib
import json
import re
from collections import OrderedDict
from typing import Any, Awaitable, Callable

from app.services.ats_scoring_service import SKILL_TERMS, extract_keywords

_SCREENING_CACHE: "OrderedDict[str, dict[str, Any]]" = OrderedDict()

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
    r"(?<!\d)(?:(?:19|20)\d{2}\s*[./年-]\s*(?:\d{1,2})(?:\s*月)?|(?:19|20)\d{2})(?!\d)"
    r"(?:\s*[~～\-—–至到]\s*(?:(?:(?:19|20)\d{2}\s*[./年-]\s*(?:\d{1,2})(?:\s*月)?)|"
    r"(?:19|20)\d{2}|至今|现在|今))?"
)
_DEGREE_RE = re.compile(
    r"(博士后|博士|硕士|研究生|本科|学士|专科|PhD|Master|Bachelor)",
    re.IGNORECASE,
)
_BULLET_RE = re.compile(r"^\s*(?:[-*•●▪◦※⚫]|\d+[)、])\s*")
_NON_NAME_LINES = {"个人简历", "简历", "基本信息", "个人信息", "联系方式", "求职意向", "教育背景", "项目经历", "专业能力", "荣誉奖项", "技能证书"}
# OCR 按列读表格时“姓 名 ： 籍 贯 ：”这种行会把下一个标签误捕为姓名；
# 这些词永远不是姓名，命中即拒绝。
_NAME_LABEL_BLOCKLIST = {
    "籍贯", "年龄", "性别", "邮箱", "电话", "微信", "地址", "政治面貌",
    "出生年月", "生日", "民族", "学历", "学校", "专业", "求职意向", "现居",
}


def _is_plausible_name(value: str) -> bool:
    """Reject label words captured as names (OCR column-split tables)."""
    compact = value.replace(" ", "")
    if not compact or compact in _NAME_LABEL_BLOCKLIST:
        return False
    if re.search(r"[:：@＠]", value):
        return False
    return True


def _clean_name_candidate(value: str) -> str:
    """姓名候选清洗：剥离尾随的标签词（如「张三 籍贯」→「张三」），并做可信度校验。"""
    tokens = [token for token in value.split() if token]
    while tokens and tokens[-1] in _NAME_LABEL_BLOCKLIST:
        tokens.pop()
    cleaned = " ".join(tokens) if len(tokens) > 1 else (tokens[0] if tokens else "")
    if cleaned and re.fullmatch(r"(?:[\u4e00-\u9fff]\s)+[\u4e00-\u9fff]", cleaned):
        cleaned = cleaned.replace(" ", "")
    return cleaned if cleaned and _is_plausible_name(cleaned) else ""


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
    if manual and parsed_text:
        # The client usually echoes the previewed text back; avoid doubling it.
        if parsed_text in manual:
            parsed_text = ""
        elif manual in parsed_text:
            manual = ""
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


def _field_value(value: str) -> str:
    """Value of a `标签：值` field, cut before the next label; empty if it is itself just a label."""

    cleaned = re.split(r"\s+[\u4e00-\u9fff]{2,4}\s*[:：]", normalize_text(value), maxsplit=1)[0].strip(" |，,")
    if not cleaned or re.search(r"[:：]", cleaned):
        return ""
    if re.fullmatch(r"(?:[\u4e00-\u9fff]\s)+[\u4e00-\u9fff]", cleaned):
        cleaned = cleaned.replace(" ", "")
    return cleaned


def extract_resume_profile(resume_text: str) -> dict[str, Any]:
    """Extract high-signal resume structure and keep source evidence local."""

    text = normalize_text(resume_text)
    lines = _resume_lines(text)
    sections = _group_profile_sections(lines)
    header_text = "\n".join(str(item["text"]) for item in sections.get("header", []))
    email_match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)
    phone_match = re.search(r"(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d{4}){2}(?!\d)", text)

    profile: dict[str, Any] = {
        "full_name": "",
        "email": email_match.group(0) if email_match else "",
        "phone": re.sub(r"[\s-]", "", phone_match.group(0)) if phone_match else "",
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
        r"(?:姓\s*名|name)[ \t]*[:：][ \t]*([^\n:：|]+)",
        text,
        re.IGNORECASE,
    )
    if labeled_name:
        candidate_name = _clean_name_candidate(_field_value(labeled_name.group(1)))
        if candidate_name:
            profile["full_name"] = candidate_name

    # OCR 把表格按列读出时，标签与值会分成相邻两行：
    #   “姓 名 ： 籍 贯 ：” → 下一行 “肖 雨 航 江 苏 扬 州”
    # 此时姓名是标签行下一行的第一个词（去除字间空格后 2-4 个汉字）。
    if not profile["full_name"]:
        raw_lines = [line.strip() for line in text.split("\n") if line.strip()]
        for index, raw in enumerate(raw_lines[:-1]):
            if not re.search(r"姓\s*名\s*[:：]", raw):
                continue
            # 同一行标签后已有可用值时跳过（交给上面的正则处理）
            inline = re.search(r"姓\s*名\s*[:：]\s*([^\n:：]+)", raw)
            if inline and _clean_name_candidate(_field_value(inline.group(1))):
                continue
            for following in raw_lines[index + 1 : index + 5]:
                # 跳过仍含标签冒号的行（如「年 龄 ： 邮 箱 ：」也是标签行）
                if re.search(r"[:：]", following):
                    continue
                # 值行可能是「肖雨航 江苏扬州」，也可能是 OCR 逐字分开的「肖 雨 航 江 苏 扬 州」。
                tokens = [token for token in following.split() if token]
                first = tokens[0].replace(" ", "") if tokens else ""
                if re.fullmatch(r"[\u4e00-\u9fff]{2,4}", first) and first not in _NAME_LABEL_BLOCKLIST and first not in _NON_NAME_LINES:
                    # 首个 token 本身就是完整姓名
                    profile["full_name"] = first
                    break
                # 逐字分隔：合并连续单字 token；2-4 字取全部，更长则取前 3 字（姓名最长见 3 字）
                if all(re.fullmatch(r"[\u4e00-\u9fff]", token) for token in tokens[:2]) and len(tokens) >= 2:
                    merged = ""
                    for token in tokens:
                        if not re.fullmatch(r"[\u4e00-\u9fff]", token):
                            break
                        merged += token
                    candidate = merged if 2 <= len(merged) <= 4 else (merged[:3] if len(merged) > 4 else "")
                    if candidate and candidate not in _NAME_LABEL_BLOCKLIST and candidate not in _NON_NAME_LINES:
                        profile["full_name"] = candidate
                        break
            if profile["full_name"]:
                break

    for line in lines[:40]:
        value = str(line["text"])
        labeled_name = re.match(r"^(?:姓\s*名|name)\s*[:：]\s*(.+)$", value, re.IGNORECASE)
        if labeled_name and not profile["full_name"]:
            candidate_name = _clean_name_candidate(_field_value(labeled_name.group(1)))
            if candidate_name:
                profile["full_name"] = candidate_name
                break
            continue
        if not profile["full_name"] and re.fullmatch(r"[\u4e00-\u9fff]{2,4}", value):
            if value not in _NON_NAME_LINES and value.replace(" ", "") not in _NAME_LABEL_BLOCKLIST and not _section_from_line(value)[0]:
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
            match = re.search(rf"(?:{label})[ \t]*[:：][ \t]*([^\n|]+)", text, re.IGNORECASE)
            value = _field_value(match.group(1)) if match else ""
            if value:
                profile[key] = value
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


def _contains_term(term: str, text_lower: str) -> bool:
    normalized = term.strip().lower()
    if not normalized:
        return False
    if any("\u4e00" <= character <= "\u9fff" for character in normalized):
        return normalized in text_lower
    return bool(re.search(rf"(?<!\w){re.escape(normalized)}(?!\w)", text_lower))


def build_fallback_screening(
    *,
    candidate_name: str,
    jd_text: str,
    resume_text: str,
    source_name: str | None = None,
    rubric: dict[str, Any] | None = None,
    jd_title: str = "",
    extraction: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Rule-only evaluation with the same report shape as the AI path."""

    from app.services.talent_evaluation_service import build_evaluation
    from app.services.talent_rubric_service import build_fallback_rubric

    return build_evaluation(
        candidate_name=candidate_name,
        jd_text=jd_text,
        resume_text=resume_text,
        rubric=rubric or build_fallback_rubric(jd_title, jd_text),
        profile=extract_resume_profile(resume_text),
        llm_payload=None,
        extraction=extraction,
        source_name=source_name or "",
    )


async def screen_candidate_profile(
    *,
    candidate_name: str,
    jd_text: str,
    resume_text: str,
    source_name: str | None = None,
    rubric: dict[str, Any] | None = None,
    jd_title: str = "",
    extraction: dict[str, Any] | None = None,
    model: str | None = None,
    progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    from app.services.talent_evaluation_service import assess_by_llm, build_evaluation
    from app.services.talent_rubric_service import generate_rubric
    from app.services.university_service import infer_education_facts

    async def emit(event: dict[str, Any]) -> None:
        if progress is not None:
            await progress(event)

    profile = extract_resume_profile(resume_text)
    await emit({"type": "step", "key": "tool", "status": "running", "label": "调用院校库识别学校层次与毕业年份"})
    education_facts = infer_education_facts(profile, resume_text)
    await emit({"type": "tool", "name": "university_lookup", "output": education_facts})
    await emit({"type": "step", "key": "tool", "status": "done", "label": "院校库查询完成"})

    await emit({"type": "step", "key": "rubric", "status": "running", "label": "加载岗位评分卡"})
    active_rubric = rubric or await generate_rubric(jd_title, jd_text)
    await emit({"type": "step", "key": "rubric", "status": "done", "label": "评分卡就绪"})
    # Saving a previewed screening must not re-run the LLM and silently change the score.
    rubric_identity = [
        [r.get("key"), r.get("label"), r.get("description"), r.get("category"), r.get("weight")]
        for r in active_rubric.get("requirements") or []
    ]
    cache_key = hashlib.sha256(
        json.dumps([rubric_identity, active_rubric.get("knockouts"), jd_text, resume_text, model or ""],
                   ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    payload = _SCREENING_CACHE.get(cache_key)
    await emit({"type": "step", "key": "llm", "status": "running", "label": f"AI 逐项评估{f'（{model}）' if model else ''}"})
    if payload is None:
        try:
            payload = await assess_by_llm(
                active_rubric,
                resume_text,
                jd_text,
                model=model,
                education_facts=education_facts,
                on_token=(lambda text: emit({"type": "token", "text": text})) if progress else None,
            )
        except Exception as exc:
            payload = None
            await emit({"type": "step", "key": "llm", "status": "error", "label": f"AI 评估失败，改用规则评估：{str(exc)[:120]}"})
        if payload:
            _SCREENING_CACHE[cache_key] = payload
            while len(_SCREENING_CACHE) > 64:
                _SCREENING_CACHE.popitem(last=False)
    if payload:
        await emit({"type": "step", "key": "llm", "status": "done", "label": "AI 评估完成"})
    await emit({"type": "step", "key": "score", "status": "running", "label": "核验证据并计算得分"})
    result = build_evaluation(
        candidate_name=candidate_name,
        jd_text=jd_text,
        resume_text=resume_text,
        rubric=active_rubric,
        profile=profile,
        llm_payload=payload,
        extraction=extraction,
        source_name=source_name or "",
    )
    await emit({"type": "step", "key": "score", "status": "done", "label": f"总分 {result['total_score']} · {result['recommendation']}"})
    return result
