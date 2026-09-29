"""Evidence-anchored talent evaluation (rubric-v3).

Pipeline: rubric (per JD) -> LLM rates each requirement on a 0-4 behaviourally anchored scale
with verbatim resume quotes -> quotes are verified against the resume text -> the score is
computed deterministically in code from levels x weights, with knockout caps. A rule-based
evaluator produces the same shape when the LLM is unavailable.
"""

from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.llm import create_llm, extract_text_content
from app.services.recruit_ai_usage import add_usage, record_usage, role_model, with_usage
from app.services.ats_scoring_service import calculate_ats_scores
from app.services.talent_rubric_service import CATEGORY_LABELS, DEGREE_RANK, RUBRIC_VERSION
from app.services.university_service import infer_education_facts

LEVEL_LABELS = {0: "无证据", 1: "仅提及", 2: "有实践", 3: "扎实", 4: "突出"}
LEVEL_ANCHORS = {
    0: "简历中没有任何相关信息",
    1: "只在技能列表/自我评价中出现关键词，没有具体经历支撑",
    2: "在课程、个人或实习项目中实际使用过，有基本描述",
    3: "有完整项目或多段经历支撑，能看出本人具体职责、技术细节或方法",
    4: "有可验证的突出成果：真实上线/有真实用户、量化业务结果、获奖、开源影响力等",
}
TIERS = [
    (80, "A", "强烈推荐", "进入面试", "high"),
    (70, "B", "建议面试", "人工复核", "review"),
    (60, "C", "待定储备", "进入人才库", "pool"),
    (0, "D", "暂不匹配", "暂不推进", "low"),
]
KNOCKOUT_FAIL_CAP = 59
_ROLE_LEVEL_LABELS = {"campus": "校招/应届", "junior": "初级", "mid": "中级", "senior": "资深"}
_QUANT_RE = re.compile(r"\d+(?:\.\d+)?\s*(?:%|％|倍|万|千|百|人|家|份|个|条|项|次|ms|秒|天|小时|star|stars|用户)", re.IGNORECASE)
_LINK_RE = re.compile(r"(?:https?://|www\.)[^\s，,；;）)]+|github\.com/[\w.-]+|gitee\.com/[\w.-]+", re.IGNORECASE)
_LOCATOR_RE = re.compile(r"^\[([a-z]+:[^\]]+)\]$")
_STRONG_WORDS = ("上线", "落地", "用户", "获奖", "一等奖", "金奖", "开源", "star", "日活", "投产", "中标", "提升", "降低", "缩短")
_ACTION_SECTIONS = {"experience", "projects", "competitions"}


# ── text helpers ──

def _clean(value: Any) -> str:
    return re.sub(r"[ \t]+", " ", str(value or "").replace("\r", "")).strip()


def _norm(value: str) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]", "", (value or "").lower())


def _contains(term: str, lowered: str) -> bool:
    if re.search(r"[\u4e00-\u9fff]", term):
        return term in lowered
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", lowered))


def _resume_lines(resume_text: str) -> list[dict[str, str]]:
    """Lines tagged with their source locator and a coarse section guess."""

    from app.services.talent_screening_service import _section_from_line

    lines: list[dict[str, str]] = []
    locator = ""
    section = "header"
    for raw in resume_text.split("\n"):
        text = raw.strip()
        if not text:
            continue
        marker = _LOCATOR_RE.match(text)
        if marker:
            locator = marker.group(1)
            continue
        detected, remainder = _section_from_line(text)
        if detected:
            section = detected
            if not remainder:
                continue
            text = remainder
        lines.append({"text": text, "locator": locator, "section": section})
    return lines


def verify_quote(quote: str, resume_norm: str) -> bool:
    q = _norm(quote)
    if len(q) < 4:
        return False
    if q in resume_norm:
        return True
    size = 8
    chunks = [q[i : i + size] for i in range(0, max(1, len(q) - size + 1), size)]
    found = sum(1 for chunk in chunks if chunk in resume_norm)
    return found / max(1, len(chunks)) >= 0.7


def _locate(quote: str, lines: list[dict[str, str]]) -> str:
    probe = _norm(quote)[:10]
    if not probe:
        return ""
    for line in lines:
        if probe in _norm(line["text"]):
            return line["locator"]
    return ""


# ── knockouts ──

def _degree_rank(text: str) -> int:
    lowered = text.lower()
    rank = 0
    for pattern, value in (
        (r"博士|ph\.?d|doctor", 4),
        (r"硕士|研究生|master|m\.s\.|mba", 3),
        (r"本科|学士|bachelor|b\.s\.|b\.e\.", 2),
        (r"大专|专科|高职|associate", 1),
    ):
        if re.search(pattern, lowered):
            rank = max(rank, value)
    return rank


def _graduation_years(text: str) -> list[int]:
    years = [int(m.group(2)) for m in re.finditer(
        r"(20\d{2})\s*(?:[./年-]\s*\d{1,2}\s*月?)?\s*[~～\-—–至到]+\s*(20\d{2})", text)]
    years += [int(y) for y in re.findall(r"(20\d{2})\s*届", text)]
    years += [int(y) for y in re.findall(r"(?:预计|将于)?\s*(20\d{2})\s*年?\s*\d{0,2}\s*月?\s*毕业", text)]
    return sorted(set(years))


def _education_text(profile: dict[str, Any], resume_text: str) -> str:
    evidence = (profile.get("section_evidence") or {}).get("education") or []
    text = "\n".join(str(item.get("text") or "") for item in evidence)
    return text or resume_text[:1500]


def _school_label(fact: dict[str, Any]) -> str:
    tags = "/".join(fact.get("school_tags") or [])
    return f"{fact['school']}（{fact['school_level']}{'·' + tags if tags else ''}）" if fact.get("school") else ""


def check_knockouts_by_rule(
    rubric: dict[str, Any],
    profile: dict[str, Any],
    resume_text: str,
    education_facts: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    edu_text = _education_text(profile, resume_text)
    facts = education_facts if education_facts is not None else infer_education_facts(profile, resume_text)
    top = max(facts, key=lambda f: (f["degree_rank"], f["graduation_year"] or 0), default=None)
    results: list[dict[str, Any]] = []
    for knockout in rubric.get("knockouts") or []:
        status, evidence, note = "unknown", "", ""
        if knockout["kind"] == "degree":
            rank = _degree_rank(edu_text)
            need = DEGREE_RANK.get(knockout["params"].get("min_degree"), 2)
            if rank:
                status = "pass" if rank >= need else "fail"
                evidence = next((line for line in edu_text.split("\n") if _degree_rank(line)), "")[:120]
            elif top and top["degree_rank"]:
                # Inferred from the school library: only a pass is safe, a shortfall stays for humans.
                if top["degree_rank"] >= need:
                    status = "pass"
                note = f"简历未写学历层次；据院校库 {_school_label(top)} 推断为{top['degree']}，建议面试核实。"
                evidence = top["school"]
            else:
                note = "简历未写明学历层次。"
        elif knockout["kind"] == "graduation_year":
            wanted = knockout["params"].get("years") or []
            found = _graduation_years(edu_text)
            if found:
                latest = max(found)
                status = "pass" if latest in wanted else "fail"
                evidence = next((line for line in edu_text.split("\n") if str(latest) in line), "")[:120]
                note = f"推断毕业年份 {latest}。"
            elif top and top["graduation_year"]:
                year = top["graduation_year"]
                if year in wanted:
                    status = "pass"
                    note = f"推断 {year} 届（{top['graduation_source']}）。"
                else:
                    note = f"推断 {year} 届（{top['graduation_source']}），与要求不符，需人工确认。"
                evidence = f"{top['school']} {top['start_year'] or ''}".strip()
            else:
                note = "简历未写明毕业时间。"
        else:
            note = "该条件需人工确认。"
        results.append({"key": knockout["key"], "label": knockout["label"], "status": status, "evidence": evidence, "note": note})
    return results


# ── rule-based assessment (fallback) ──

def assess_by_rule(rubric: dict[str, Any], resume_text: str) -> list[dict[str, Any]]:
    lines = _resume_lines(resume_text)
    assessments: list[dict[str, Any]] = []
    for requirement in rubric.get("requirements") or []:
        signals = requirement.get("signals") or []
        matched_lines: list[tuple[dict[str, str], list[str]]] = []
        for line in lines:
            lowered = line["text"].lower()
            hits = [s for s in signals if _contains(s, lowered)]
            if hits:
                matched_lines.append((line, hits))
        action_lines = [(l, h) for l, h in matched_lines if l["section"] in _ACTION_SECTIONS]
        distinct = {s for _, hits in matched_lines for s in hits}
        strong = [l for l, _ in action_lines if _QUANT_RE.search(l["text"]) or any(w in l["text"] for w in _STRONG_WORDS)]
        # Keyword rules cannot judge depth, so they never award level 4.
        if not matched_lines:
            level = 0
        elif not action_lines:
            level = 1
        elif len(action_lines) >= 2 and len(distinct) >= 3 and strong:
            level = 3
        else:
            level = 2
        ranked = sorted(action_lines or matched_lines, key=lambda item: -len(item[1]))
        evidence = [item[0]["text"][:140] for item in ranked[:2]]
        assessments.append({
            "key": requirement["key"],
            "level": level,
            "evidence": evidence,
            "rationale": (
                f"命中信号：{'、'.join(sorted(distinct)[:5])}；其中 {len(action_lines)} 处出现在经历/项目描述中。"
                if matched_lines else "简历中未找到与该要求相关的描述。"
            ),
            "gap": "" if level >= 3 else "缺少能体现本人职责与结果的具体经历。" if level else "无相关证据。",
            "source": "rule",
        })
    return assessments


# ── LLM assessment ──

def _evaluation_messages(
    rubric: dict[str, Any],
    resume_text: str,
    jd_text: str,
    education_facts: list[dict[str, Any]] | None = None,
) -> list[Any]:
    rubric_view = {
        "role_title": rubric.get("role_title"),
        "role_level": _ROLE_LEVEL_LABELS.get(rubric.get("role_level"), rubric.get("role_level")),
        "role_summary": rubric.get("role_summary"),
        "knockouts": [{"key": k["key"], "label": k["label"]} for k in rubric.get("knockouts") or []],
        "requirements": [
            {
                "key": r["key"],
                "label": r["label"],
                "category": CATEGORY_LABELS.get(r["category"], r["category"]),
                "description": r["description"],
                "excellent": r.get("excellent") or "",
            }
            for r in rubric.get("requirements") or []
        ],
    }
    output_schema = {
        "candidate": {
            "name": "", "school": "", "degree": "", "major": "", "graduation": "如 2027-06",
            "links": ["GitHub/作品/博客链接"],
            "internship_count": 0, "project_count": 0,
            "skill_groups": {"编程语言": [], "前端": [], "后端/数据": [], "AI/大模型": [], "工具/平台": []},
            "timeline": [{"period": "2026.02-2026.06", "org": "", "role": "", "type": "internship|project|education|competition|work"}],
        },
        "knockouts": [{"key": "", "status": "pass|fail|unknown", "evidence": "原文", "note": ""}],
        "assessments": [{"key": "", "level": 0, "evidence": ["逐字摘自简历的原文片段"], "rationale": "为什么是这个等级", "gap": "距离更高一级还缺什么"}],
        "highlights": ["3-5 条最能打动用人经理的具体亮点，引用事实"],
        "concerns": ["2-4 条与岗位要求的差距"],
        "red_flags": [{"type": "timeline|vague|inflation|mismatch|other", "detail": ""}],
        "evidence_quality": {"specificity": "high|medium|low", "note": "简历描述是否具体、可验证"},
        "summary": "100-160 字的综合结论：人岗匹配判断 + 最大亮点 + 最大风险",
        "interview_plan": [{"target_key": "对应 requirement key", "question": "", "purpose": "考察点", "good_signals": [""], "red_signals": [""]}],
    }
    anchors = "\n".join(f"- {level} {LEVEL_LABELS[level]}：{text}" for level, text in LEVEL_ANCHORS.items())
    return [
        SystemMessage(content=(
            "你是资深技术招聘官与结构化面试专家。你只依据简历中明确写出的事实做评估，"
            "不脑补、不因措辞华丽加分，也不因排版简陋减分。只输出 JSON。"
        )),
        HumanMessage(content=(
            "评估规则：\n"
            "1. 对 requirements 中每一项给出 level（0-4 整数），等级锚点如下：\n"
            f"{anchors}\n"
            f"2. 按「{rubric_view['role_level']}」标准校准：校招候选人的课程设计、个人项目、实习项目都是有效证据。\n"
            "3. evidence 必须是简历原文的逐字片段（每条 ≤80 字，1-2 条），不得改写；level≥2 必须给出 evidence。系统会逐条核验原文，无法核验的等级会被下调。\n"
            "4. 同一段经历可以支撑多项要求，但不要把“熟悉 X”这类技能罗列当作实践证据。\n"
            "5. knockouts 逐条判断 pass/fail/unknown，简历没写就是 unknown，不要猜测。\n"
            "6. red_flags 只写有依据的问题（时间线冲突/空窗、描述空泛无细节、职责夸大可疑、经历与届别不符等）；没有就返回空数组。\n"
            "7. interview_plan 4-6 题：优先针对高权重但证据不足的要求，以及需要核实真实性的亮点；用行为面试（STAR）方式提问。\n"
            "8. 忽略性别、年龄、民族、婚育、籍贯、照片、学校名气等与岗位无关的信息，不得据此评价。\n"
            "9. 「院校库工具结果」是系统调用院校库得到的学校层次与推断的学历/毕业年份；简历未明写时可据此判断 knockouts，"
            "并在 note 中注明“推断”及依据；学校层次只用于推断学历，不得用于评分。\n\n"
            f"院校库工具结果：\n{json.dumps(education_facts or [], ensure_ascii=False)}\n\n"
            f"输出 JSON 结构：\n{json.dumps(output_schema, ensure_ascii=False)}\n\n"
            f"评分卡：\n{json.dumps(rubric_view, ensure_ascii=False)}\n\n"
            f"岗位 JD（供理解业务场景）：\n{jd_text[:2500]}\n\n"
            f"简历原文（[] 内为来源位置标记）：\n{resume_text[:14000]}"
        )),
    ]


def _extract_json(raw_text: str) -> dict[str, Any]:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw_text or "").strip())
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("json_not_found")
    return json.loads(text[start : end + 1])


def _str_list(value: Any, limit: int, max_len: int = 200) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text[:max_len] for item in value if (text := _clean(item))][:limit]


async def assess_by_llm(
    rubric: dict[str, Any],
    resume_text: str,
    jd_text: str,
    *,
    model: str | None = None,
    education_facts: list[dict[str, Any]] | None = None,
    on_token: Callable[[str], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    llm = with_usage(create_llm(model=model or role_model("screening"), temperature=0.1))
    messages = _evaluation_messages(rubric, resume_text, jd_text, education_facts)
    prompt_text = "\n".join(extract_text_content(message.content) for message in messages)
    if on_token is None:
        response = await llm.ainvoke(messages)
        output = extract_text_content(response.content)
        record_usage("screening", llm, response.usage_metadata, prompt_text=prompt_text, output_text=output)
        return _extract_json(output)
    parts: list[str] = []
    usage = None
    async for chunk in llm.astream(messages):
        usage = add_usage(usage, chunk.usage_metadata)
        delta = extract_text_content(chunk.content)
        if delta:
            parts.append(delta)
            await on_token(delta)
    record_usage("screening", llm, usage, prompt_text=prompt_text, output_text="".join(parts))
    return _extract_json("".join(parts))


# ── scoring & report ──

def _tier(score: int) -> dict[str, str]:
    for threshold, grade, label, recommendation, priority in TIERS:
        if score >= threshold:
            return {"grade": grade, "label": label, "recommendation": recommendation, "priority": priority}
    return {"grade": "D", "label": "暂不匹配", "recommendation": "暂不推进", "priority": "low"}


def _merge_assessments(
    rubric: dict[str, Any],
    llm_items: list[Any],
    rule_items: list[dict[str, Any]],
    resume_text: str,
) -> list[dict[str, Any]]:
    resume_norm = _norm(resume_text)
    lines = _resume_lines(resume_text)
    by_key = {str(item.get("key")): item for item in llm_items if isinstance(item, dict)}
    rules = {item["key"]: item for item in rule_items}
    merged: list[dict[str, Any]] = []
    for requirement in rubric.get("requirements") or []:
        key = requirement["key"]
        raw = by_key.get(key)
        source = "ai" if raw else "rule"
        raw = raw or rules[key]
        try:
            level = max(0, min(4, int(raw.get("level") or 0)))
        except (TypeError, ValueError):
            level = rules[key]["level"]
        quotes = raw.get("evidence") if isinstance(raw.get("evidence"), list) else [raw.get("evidence")]
        evidence = []
        for quote in quotes[:3]:
            text = _clean(quote)[:160]
            if text:
                evidence.append({"text": text, "verified": verify_quote(text, resume_norm), "source_locator": _locate(text, lines)})
        rationale = _clean(raw.get("rationale"))[:240]
        adjusted = False
        if level >= 2 and not any(item["verified"] for item in evidence):
            level, adjusted = 1, True
            rationale = (rationale + " " if rationale else "") + "（AI 引用的证据未能在简历原文中定位，已按“仅提及”处理。）"
        merged.append({
            "key": key,
            "level": level,
            "evidence": evidence,
            "rationale": rationale,
            "gap": _clean(raw.get("gap"))[:200],
            "source": source,
            "adjusted": adjusted,
        })
    return merged


def compute_score(rubric: dict[str, Any], assessments: list[dict[str, Any]], knockouts: list[dict[str, Any]]) -> dict[str, Any]:
    levels = {item["key"]: item["level"] for item in assessments}
    requirements = rubric.get("requirements") or []
    rows: list[dict[str, Any]] = []
    for requirement in requirements:
        level = levels.get(requirement["key"], 0)
        rows.append({
            **requirement,
            "level": level,
            "contribution": round(requirement["weight"] * level / 4, 2),
            "max_contribution": float(requirement["weight"]),
        })

    bonus_rows = [row for row in rows if row["category"] == "bonus"]
    best_bonus = max(bonus_rows, key=lambda row: row["contribution"], default=None)
    for row in bonus_rows:
        row["counted"] = row is best_bonus and row["contribution"] > 0
    for row in rows:
        row.setdefault("counted", True)

    categories: list[dict[str, Any]] = []
    raw_total = 0.0
    raw_max = 0.0
    for category in ("core", "potential", "bonus"):
        members = [row for row in rows if row["category"] == category]
        if not members:
            continue
        if category == "bonus":
            earned = best_bonus["contribution"] if best_bonus else 0.0
            possible = max(row["max_contribution"] for row in members)
        else:
            earned = sum(row["contribution"] for row in members)
            possible = sum(row["max_contribution"] for row in members)
        raw_total += earned
        raw_max += possible
        categories.append({
            "key": category,
            "label": CATEGORY_LABELS[category],
            "earned": round(earned, 1),
            "possible": round(possible, 1),
            "rule": "任一满足即计分，取最高一项" if category == "bonus" else "各项得分累加",
        })
    scale = 100 / raw_max if raw_max else 0
    for category in categories:
        category["score"] = round(category["earned"] * scale, 1)
        category["max_score"] = round(category["possible"] * scale, 1)
        category["ratio"] = round(category["earned"] / category["possible"] * 100, 1) if category["possible"] else 0.0
    for row in rows:
        row["points"] = round(row["contribution"] * scale, 1) if row["counted"] else 0.0
        row["max_points"] = round(row["max_contribution"] * scale, 1)

    uncapped = int(round(raw_total * scale))
    failed = [item for item in knockouts if item["status"] == "fail"]
    total = min(uncapped, KNOCKOUT_FAIL_CAP) if failed else uncapped
    return {
        "total_score": max(0, min(100, total)),
        "uncapped_score": uncapped,
        "capped": bool(failed) and uncapped > KNOCKOUT_FAIL_CAP,
        "rows": rows,
        "categories": categories,
    }


def _evidence_quality(resume_text: str, merged: list[dict[str, Any]], llm_quality: dict[str, Any]) -> dict[str, Any]:
    lines = _resume_lines(resume_text)
    action = [line["text"] for line in lines if line["section"] in _ACTION_SECTIONS]
    quantified = sum(1 for text in action if _QUANT_RE.search(text))
    links = sorted(set(_LINK_RE.findall(resume_text)))
    quotes = [e for item in merged for e in item["evidence"]]
    verified_ratio = round(sum(1 for e in quotes if e["verified"]) / len(quotes) * 100, 1) if quotes else 0.0
    specificity = str(llm_quality.get("specificity") or "").lower()
    if specificity not in {"high", "medium", "low"}:
        ratio = quantified / max(1, len(action))
        specificity = "high" if ratio >= 0.3 else "medium" if ratio >= 0.12 else "low"
    return {
        "quantified_results": quantified,
        "action_lines": len(action),
        "verifiable_links": links[:6],
        "verified_ratio": verified_ratio,
        "specificity": specificity,
        "note": _clean(llm_quality.get("note"))[:200],
    }


def _confidence(
    *,
    resume_text: str,
    extraction: dict[str, Any] | None,
    quality: dict[str, Any],
    knockouts: list[dict[str, Any]],
    mode: str,
) -> tuple[float, list[dict[str, Any]]]:
    text_factor = min(1.0, len(resume_text) / 1500)
    if (extraction or {}).get("method") in {"ocr", "mixed"}:
        text_factor *= 0.88
    verify_factor = quality["verified_ratio"] / 100 if quality["verified_ratio"] else 0.5
    unknown = sum(1 for k in knockouts if k["status"] == "unknown")
    coverage_factor = 1 - (unknown / len(knockouts) * 0.6 if knockouts else 0)
    mode_factor = 0.95 if mode == "ai" else 0.8
    value = round(100 * (0.35 * text_factor + 0.4 * verify_factor + 0.25 * coverage_factor) * mode_factor, 1)
    factors = [
        {"label": "简历信息量", "value": round(text_factor * 100)},
        {"label": "证据可核验率", "value": round(verify_factor * 100)},
        {"label": "硬性条件可判定", "value": round(coverage_factor * 100)},
        {"label": "评估方式", "value": round(mode_factor * 100)},
    ]
    return value, factors


def _rule_candidate(profile: dict[str, Any], resume_text: str) -> dict[str, Any]:
    education = (profile.get("education") or [{}])[0] if profile.get("education") else {}
    years = _graduation_years(_education_text(profile, resume_text))
    return {
        "name": profile.get("full_name") or "",
        "school": education.get("institution") or "",
        "degree": education.get("degree") or "",
        "major": education.get("major") or "",
        "graduation": str(max(years)) if years else "",
        "links": sorted(set(_LINK_RE.findall(resume_text)))[:4],
        "internship_count": len(profile.get("experience") or []),
        "project_count": len(profile.get("projects") or []),
        "skill_groups": {"技能": list(profile.get("skills") or [])[:16]} if profile.get("skills") else {},
        "timeline": [
            {"period": item.get("years") or "", "org": item.get("company") or "", "role": item.get("title") or "", "type": "internship"}
            for item in (profile.get("experience") or [])[:5]
        ] + [
            {"period": item.get("years") or "", "org": item.get("name") or "", "role": item.get("role") or "", "type": "project"}
            for item in (profile.get("projects") or [])[:5]
        ],
    }


def _clean_candidate(raw: Any, fallback: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return fallback
    groups: dict[str, list[str]] = {}
    if isinstance(raw.get("skill_groups"), dict):
        for name, items in raw["skill_groups"].items():
            values = _str_list(items, 12, 40)
            if values:
                groups[_clean(name)[:16]] = values
    timeline = []
    for item in raw.get("timeline") or []:
        if isinstance(item, dict) and (item.get("org") or item.get("role")):
            timeline.append({k: _clean(item.get(k))[:60] for k in ("period", "org", "role", "type")})

    def count(value: Any, default: int) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return default

    return {
        "name": _clean(raw.get("name"))[:30] or fallback["name"],
        "school": _clean(raw.get("school"))[:40] or fallback["school"],
        "degree": _clean(raw.get("degree"))[:20] or fallback["degree"],
        "major": _clean(raw.get("major"))[:40] or fallback["major"],
        "graduation": _clean(raw.get("graduation"))[:20] or fallback["graduation"],
        "links": _str_list(raw.get("links"), 6, 120) or fallback["links"],
        "internship_count": count(raw.get("internship_count"), fallback["internship_count"]),
        "project_count": count(raw.get("project_count"), fallback["project_count"]),
        "skill_groups": groups or fallback["skill_groups"],
        "timeline": timeline[:10] or fallback["timeline"],
    }


def _merge_knockouts(rule_results: list[dict[str, Any]], llm_items: Any) -> list[dict[str, Any]]:
    by_key = {str(item.get("key")): item for item in llm_items or [] if isinstance(item, dict)}
    merged = []
    for rule in rule_results:
        raw = by_key.get(rule["key"])
        status = str((raw or {}).get("status") or "").lower()
        if status not in {"pass", "fail", "unknown"} or rule["status"] != "unknown" and status == "unknown":
            merged.append(rule)
            continue
        merged.append({
            **rule,
            "status": status,
            "evidence": _clean(raw.get("evidence"))[:160] or rule["evidence"],
            "note": _clean(raw.get("note"))[:160] or rule["note"],
        })
    return merged


def _rule_interview_plan(rows: list[dict[str, Any]], merged: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    plan: list[dict[str, Any]] = []
    weak = sorted((r for r in rows if r["level"] <= 2 and r["category"] != "bonus"), key=lambda r: -r["weight"])
    for row in weak[:4]:
        plan.append({
            "target_key": row["key"],
            "question": row.get("interview_probe") or (
                f"请讲一个最能体现「{row['label']}」的真实经历：当时的目标是什么？你本人具体做了哪些事？"
                "遇到的最大难点是什么、怎么解决的？结果如何衡量？"
            ),
            "purpose": f"验证「{row['label']}」（当前证据：{LEVEL_LABELS[row['level']]}）",
            "good_signals": ["能清楚区分个人贡献与团队工作", "能讲出技术取舍或方案对比", "有可演示或可量化的结果"],
            "red_signals": ["只停留在概念和工具名称", "说不清自己负责的部分", "结果无法衡量或前后矛盾"],
        })
    strong = sorted((r for r in rows if r["level"] >= 3), key=lambda r: -r["weight"])
    for row in strong[:2]:
        quote = next((e["text"] for e in merged[row["key"]]["evidence"]), "")
        plan.append({
            "target_key": row["key"],
            "question": f"简历中提到“{quote[:60]}”，请现场画出整体架构/流程，并说明其中最难的一个决策。" if quote
            else f"请深入讲讲你在「{row['label']}」方面最有代表性的项目细节。",
            "purpose": f"核实亮点「{row['label']}」的真实性与深度",
            "good_signals": ["细节具体、前后一致", "能回答追问的边界情况"],
            "red_signals": ["细节模糊", "与简历描述不一致"],
        })
    return plan[:6]


def _clean_interview_plan(raw: Any, rows_by_key: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    plan = []
    for item in raw or []:
        if not isinstance(item, dict) or not _clean(item.get("question")):
            continue
        key = str(item.get("target_key") or "")
        plan.append({
            "target_key": key if key in rows_by_key else "",
            "question": _clean(item.get("question"))[:300],
            "purpose": _clean(item.get("purpose"))[:120],
            "good_signals": _str_list(item.get("good_signals"), 4, 80),
            "red_signals": _str_list(item.get("red_signals"), 4, 80),
        })
    return plan[:6]


def _rule_flags(resume_text: str, profile: dict[str, Any], knockouts: list[dict[str, Any]]) -> list[dict[str, str]]:
    flags: list[dict[str, str]] = []
    if len(resume_text) < 400:
        flags.append({"type": "other", "detail": "简历信息量过少，难以做出可靠判断。"})
    if not profile.get("experience") and not profile.get("projects"):
        flags.append({"type": "vague", "detail": "未识别到实习或项目经历段落。"})
    for knockout in knockouts:
        if knockout["status"] == "fail":
            flags.append({"type": "mismatch", "detail": f"不满足硬性条件：{knockout['label']}。{knockout['note']}".strip()})
    return flags


def _clean_flags(raw: Any) -> list[dict[str, str]]:
    flags = []
    for item in raw or []:
        if isinstance(item, dict) and _clean(item.get("detail")):
            kind = str(item.get("type") or "other").lower()
            flags.append({"type": kind if kind in {"timeline", "vague", "inflation", "mismatch", "other"} else "other",
                          "detail": _clean(item.get("detail"))[:200]})
        elif isinstance(item, str) and _clean(item):
            flags.append({"type": "other", "detail": _clean(item)[:200]})
    return flags[:6]


def build_evaluation(
    *,
    candidate_name: str,
    jd_text: str,
    resume_text: str,
    rubric: dict[str, Any],
    profile: dict[str, Any],
    llm_payload: dict[str, Any] | None,
    extraction: dict[str, Any] | None = None,
    source_name: str = "",
) -> dict[str, Any]:
    mode = "ai" if llm_payload else "fallback"
    payload = llm_payload or {}
    rule_items = assess_by_rule(rubric, resume_text)
    merged = _merge_assessments(rubric, payload.get("assessments") or [], rule_items, resume_text)
    merged_by_key = {item["key"]: item for item in merged}
    education_facts = infer_education_facts(profile, resume_text)
    knockouts = _merge_knockouts(
        check_knockouts_by_rule(rubric, profile, resume_text, education_facts), payload.get("knockouts"))
    scoring = compute_score(rubric, merged, knockouts)
    rows = scoring["rows"]
    rows_by_key = {row["key"]: row for row in rows}
    total = scoring["total_score"]
    tier = _tier(total)
    quality = _evidence_quality(resume_text, merged, payload.get("evidence_quality") or {})
    confidence, confidence_factors = _confidence(
        resume_text=resume_text, extraction=extraction, quality=quality, knockouts=knockouts, mode=mode)
    candidate = _clean_candidate(payload.get("candidate"), _rule_candidate(profile, resume_text))
    top_fact = max(education_facts, key=lambda f: (f["degree_rank"], f["graduation_year"] or 0), default=None)
    if top_fact:
        candidate["school"] = candidate["school"] or top_fact["school"]
        candidate["degree"] = candidate["degree"] or (f"{top_fact['degree']}（推断）" if top_fact["degree"] else "")
        candidate["graduation"] = candidate["graduation"] or (str(top_fact["graduation_year"] or ""))
        candidate["school_level"] = top_fact["school_level"]
        candidate["school_tags"] = top_fact["school_tags"]
    ats = calculate_ats_scores(jd_text, resume_text)

    requirement_rows = []
    for row in rows:
        assessment = merged_by_key[row["key"]]
        requirement_rows.append({
            "key": row["key"],
            "label": row["label"],
            "description": row["description"],
            "category": row["category"],
            "category_label": CATEGORY_LABELS[row["category"]],
            "weight": row["weight"],
            "level": row["level"],
            "level_label": LEVEL_LABELS[row["level"]],
            "points": row["points"],
            "max_points": row["max_points"],
            "counted": row["counted"],
            "evidence": assessment["evidence"],
            "rationale": assessment["rationale"],
            "gap": assessment["gap"],
            "source": assessment["source"],
            "adjusted": assessment["adjusted"],
        })

    highlights = _str_list(payload.get("highlights"), 5) or [
        f"{row['label']}：{LEVEL_LABELS[row['level']]}" for row in sorted(rows, key=lambda r: -r["contribution"]) if row["level"] >= 3
    ][:4]
    concerns = _str_list(payload.get("concerns"), 4) or [
        f"{row['label']}：{LEVEL_LABELS[row['level']]}，{merged_by_key[row['key']]['gap'] or '需要补充证据'}"
        for row in sorted(rows, key=lambda r: -r["weight"]) if row["level"] <= 1 and row["category"] != "bonus"
    ][:4]
    red_flags = _clean_flags(payload.get("red_flags"))
    for flag in _rule_flags(resume_text, profile, knockouts):
        if not any(flag["detail"][:10] in existing["detail"] for existing in red_flags):
            red_flags.append(flag)
    interview_plan = _clean_interview_plan(payload.get("interview_plan"), rows_by_key) or _rule_interview_plan(rows, merged_by_key)

    failed = [k for k in knockouts if k["status"] == "fail"]
    if failed:
        reason = f"不满足硬性条件（{'、'.join(k['label'] for k in failed)}），总分封顶 {KNOCKOUT_FAIL_CAP} 分；如属误判请人工核实后重评。"
    elif tier["priority"] == "high":
        reason = "核心能力证据充分，建议优先安排面试，重点核实亮点项目的个人贡献与深度。"
    elif tier["priority"] == "review":
        reason = "主要要求有证据支撑但深度不一，建议面试重点追问证据不足的高权重项。"
    elif tier["priority"] == "pool":
        reason = "部分要求有相关经历，但关键能力证据偏弱，建议进入人才库或补充作品后再评估。"
    else:
        reason = "与岗位核心要求的直接证据不足，暂不建议推进。"

    summary = _clean(payload.get("summary"))[:400] or (
        f"{candidate_name or '候选人'}总分 {total}（{tier['grade']} · {tier['label']}）。"
        + (f"主要亮点：{highlights[0]}。" if highlights else "")
        + (f"主要差距：{concerns[0]}。" if concerns else "")
    )

    score_explanation = (
        "总分 = Σ(各项权重 × 等级/4)，加分项取最高一项，再换算为百分制；"
        "等级由 AI 依据简历原文证据按 0-4 行为锚定量表评定，引用证据逐条核验原文，无法核验则下调；"
        f"不满足硬性条件时总分封顶 {KNOCKOUT_FAIL_CAP}。联系方式、性别、年龄、籍贯、照片、学校名气不参与评分。"
    )

    report = {
        "model": RUBRIC_VERSION,
        "title": "人岗匹配评估报告",
        "score_explanation": score_explanation,
        "total_score": total,
        "uncapped_score": scoring["uncapped_score"],
        "capped": scoring["capped"],
        "tier": tier,
        "confidence": confidence,
        "confidence_factors": confidence_factors,
        "decision": {
            "recommendation": tier["recommendation"],
            "should_interview": tier["priority"] in {"high", "review"} and not failed,
            "priority": tier["priority"],
            "reason": reason,
        },
        "summary": summary,
        "rubric": {
            "role_title": rubric.get("role_title"),
            "role_level": rubric.get("role_level"),
            "role_level_label": _ROLE_LEVEL_LABELS.get(rubric.get("role_level"), ""),
            "role_summary": rubric.get("role_summary"),
            "source": rubric.get("source"),
            "fingerprint": rubric.get("fingerprint"),
        },
        "level_scale": [{"level": level, "label": LEVEL_LABELS[level], "anchor": LEVEL_ANCHORS[level]} for level in LEVEL_LABELS],
        "knockouts": knockouts,
        "education_facts": education_facts,
        "categories": scoring["categories"],
        "requirements": requirement_rows,
        "candidate": candidate,
        "highlights": highlights,
        "concerns": concerns,
        "red_flags": red_flags,
        "evidence_quality": quality,
        "interview_plan": interview_plan,
        "ats_reference": {
            "keyword_match": ats["score_breakdown"]["keyword_match"],
            "skills_coverage": ats["score_breakdown"]["skills_coverage"],
            "section_completeness": ats["score_breakdown"]["section_completeness"],
            "matched_keywords": ats["matched_keywords"],
            "missing_keywords": ats["missing_keywords"],
        },
        "extraction": extraction or {},
        "evaluation_mode": mode,
        # Legacy fields kept for older consumers.
        "component_scores": [
            {"key": c["key"], "label": c["label"], "score": c["score"], "max_score": c["max_score"],
             "weight": round(c["max_score"]), "contribution": c["score"]}
            for c in scoring["categories"]
        ],
        "evidence_coverage": quality["verified_ratio"],
        "strengths": highlights,
        "gaps": concerns,
        "risks": [flag["detail"] for flag in red_flags],
        "interview_focus": [item["question"] for item in interview_plan],
        "matched_keywords": ats["matched_keywords"],
        "missing_keywords": ats["missing_keywords"],
        "jd_summary": _clean(jd_text)[:600],
        "candidate_name": candidate_name or candidate["name"] or "候选人",
    }

    dimension_scores = [
        {
            "key": row["key"],
            "label": row["label"],
            "score": row["points"],
            "max_score": row["max_points"],
            "weight": row["weight"],
            "level": row["level"],
            "reason": f"{row['level_label']}：{row['rationale']}".strip("："),
            "evidence": [{"label": "简历证据", "text": e["text"], "source_locator": e["source_locator"], "kind": "resume"} for e in row["evidence"]],
            "gaps": [row["gap"]] if row["gap"] else [],
            "matched_signals": [],
        }
        for row in requirement_rows
    ]
    report["dimension_scores"] = dimension_scores
    report["ats_metrics"] = [
        {"key": key, "label": label, "score": ats["score_breakdown"][key], "weight": 0}
        for key, label in (("keyword_match", "JD 关键词覆盖"), ("skills_coverage", "技能词覆盖"), ("section_completeness", "简历结构完整度"))
    ]
    evidence_excerpt = "\n".join(e["text"] for row in requirement_rows for e in row["evidence"] if e["verified"])[:1800]
    report["evidence_excerpt"] = evidence_excerpt

    return {
        "candidate_name": candidate_name or candidate["name"] or "候选人",
        "job_summary": _clean(jd_text)[:280],
        "total_score": total,
        "max_score": 100,
        "recommendation": tier["recommendation"],
        "overall_summary": summary,
        "dimension_scores": dimension_scores,
        "matched_signals": [row["label"] for row in requirement_rows if row["level"] >= 3][:8],
        "strengths": highlights,
        "risks": [flag["detail"] for flag in red_flags] or ["核心经历仍需通过面试核验真实性与个人贡献。"],
        "interview_questions": [item["question"] for item in interview_plan],
        "evidence_excerpt": evidence_excerpt,
        "score_version": RUBRIC_VERSION,
        "score_breakdown": ats["score_breakdown"],
        "matched_keywords": ats["matched_keywords"],
        "missing_keywords": ats["missing_keywords"],
        "recommendations": [reason, *concerns[:3]],
        "score_report": report,
        "resume_profile": profile,
        "rubric": rubric,
        "source_name": source_name or "",
        "evaluation_mode": mode,
    }
