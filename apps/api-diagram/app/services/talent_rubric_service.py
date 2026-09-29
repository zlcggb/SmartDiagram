"""JD -> structured hiring rubric (scorecard) used by the talent evaluation engine.

A rubric is generated once per JD (LLM first, deterministic parser as fallback) so every
candidate for the same role is measured against the same requirements and weights.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import OrderedDict
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.llm import create_llm, extract_text_content
from app.services.recruit_ai_usage import record_usage, role_model, with_usage
from app.services.ats_scoring_service import extract_keywords

RUBRIC_VERSION = "rubric-v3"

CATEGORY_LABELS = {
    "core": "核心能力",
    "potential": "潜力与素质",
    "bonus": "加分项",
}
KNOCKOUT_KINDS = {"degree", "graduation_year", "custom"}
DEGREE_RANK = {"associate": 1, "bachelor": 2, "master": 3, "doctor": 4}
ROLE_LEVELS = {"campus", "junior", "mid", "senior"}

# Concept -> synonyms (lower-case). Used to expand rubric signals so that Chinese/English
# variants, product names and frameworks all count as evidence for the same requirement.
CONCEPT_SYNONYMS: dict[str, list[str]] = {
    "大模型": ["大模型", "llm", "大语言模型", "gpt", "chatgpt", "deepseek", "qwen", "通义", "文心", "glm", "claude", "gemini", "openai", "模型微调", "lora"],
    "prompt": ["prompt", "提示词", "提示工程", "prompt工程", "few-shot", "思维链", "cot"],
    "rag": ["rag", "检索增强", "知识库", "向量数据库", "向量检索", "embedding", "milvus", "faiss", "chroma", "elasticsearch", "llamaindex"],
    "agent": ["agent", "智能体", "langchain", "langgraph", "autogen", "crewai", "function calling", "工具调用", "mcp", "多智能体"],
    "工作流": ["工作流", "workflow", "自动化", "dify", "coze", "扣子", "n8n", "zapier", "rpa", "fastgpt"],
    "ai编程": ["cursor", "claude code", "codex", "copilot", "windsurf", "trae", "ai编程", "ai 编程", "vibe coding", "通义灵码"],
    "前端": ["前端", "vue", "react", "next.js", "nextjs", "nuxt", "typescript", "javascript", "html", "css", "小程序", "uniapp", "tailwind", "vite", "element", "antd"],
    "后端": ["后端", "python", "java", "go", "golang", "node", "node.js", "fastapi", "django", "flask", "spring", "springboot", "express", "nestjs", "sql", "mysql", "postgresql", "redis", "mongodb", "接口", "api"],
    "全栈": ["全栈", "前后端", "前端", "后端", "部署", "docker", "linux", "nginx", "上线", "云服务"],
    "编程语言": ["python", "java", "c++", "c语言", "javascript", "typescript", "go", "golang", "rust", "c#", "php", "kotlin"],
    "需求": ["需求", "调研", "痛点", "prd", "需求文档", "用户访谈", "原型", "mvp", "方案设计", "业务流程", "拆解"],
    "业务系统": ["crm", "erp", "mes", "oa", "scm", "wms", "运营后台", "管理后台", "管理系统", "销售", "客服", "报价", "订单", "客户管理", "salesforce", "用友", "金蝶", "sap"],
    "制造业": ["制造", "工厂", "生产", "供应链", "质检", "工业", "led", "数字化转型", "智能制造"],
    "比赛": ["黑客松", "hackathon", "挑战杯", "互联网+", "创新创业", "大创", "数学建模", "蓝桥杯", "acm", "icpc", "竞赛", "比赛", "一等奖", "二等奖", "三等奖", "金奖", "银奖", "铜奖"],
    "交付": ["独立交付", "上线", "落地", "交付", "部署", "用户", "日活", "投产", "上架", "开源", "github", "star"],
    "沟通": ["沟通", "协作", "跨部门", "对接", "团队", "汇报", "演示", "路演", "答辩", "客户"],
    "自驱": ["自学", "自驱", "独立", "主动", "发起", "个人项目", "side project", "开源", "博客", "技术文章", "从0到1"],
}

_CONCEPT_TRIGGERS: dict[str, list[str]] = {
    "大模型": ["大模型", "llm", "ai 应用", "ai应用", "人工智能", "ai 能力"],
    "prompt": ["prompt"],
    "rag": ["rag", "检索", "知识库"],
    "agent": ["agent", "智能体"],
    "工作流": ["工作流", "workflow"],
    "ai编程": ["ai 编程", "ai编程", "cursor", "claude code", "codex", "copilot"],
    "前端": ["前端", "vue", "react"],
    "后端": ["后端", "服务", "接口", "数据接口"],
    "全栈": ["全栈"],
    "编程语言": ["编程语言", "编程"],
    "需求": ["需求", "调研", "痛点", "原型", "方案"],
    "业务系统": ["crm", "erp", "运营后台", "销售", "客服", "运营", "企业系统"],
    "制造业": ["制造", "生产"],
    "比赛": ["黑客松", "比赛", "竞赛", "创新创业"],
    "交付": ["交付", "上线", "落地", "完整项目", "完整的项目"],
    "沟通": ["沟通", "协作"],
    "自驱": ["自驱", "主动", "作品"],
}

_MAJOR_SIGNALS = ["计算机", "软件", "自动化", "电子", "信息", "通信", "数学", "人工智能", "数据科学", "github", "作品", "个人项目", "开源"]
_POTENTIAL_TERMS = ("自驱", "沟通", "好奇", "学习", "主动", "责任心", "抗压", "协作", "热情", "态度")
_SECTION_HEADINGS = {
    "responsibilities": ("你将做什么", "岗位职责", "工作职责", "职责描述", "工作内容", "职位描述", "岗位描述", "responsibilities"),
    "requirements": ("我们希望你是", "任职要求", "岗位要求", "任职资格", "职位要求", "我们希望", "requirements", "qualifications"),
    "bonus": ("加分项", "优先条件", "加分", "nice to have", "bonus"),
    "ignore": ("我们提供", "福利待遇", "薪资福利", "公司介绍", "关于我们", "岗位定位", "工作地点", "福利"),
}
_ITEM_RE = re.compile(r"^\s*(?:\d+[.、)）]|[-*•●▪◦]|[（(]\d+[)）])\s*")

_RUBRIC_CACHE: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
_RUBRIC_CACHE_LIMIT = 64


def _clean(value: Any) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return re.sub(r"[ \t]+", " ", text)


def jd_fingerprint(jd_title: str, jd_text: str) -> str:
    payload = f"{_clean(jd_title)}\n{_clean(jd_text)}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def expand_signals(text: str, seed: list[str] | None = None) -> list[str]:
    """Return lower-case evidence signals for a requirement text."""

    lowered = _clean(text).lower()
    signals: list[str] = [s.strip().lower() for s in (seed or []) if str(s).strip()]
    for concept, triggers in _CONCEPT_TRIGGERS.items():
        if any(trigger in lowered for trigger in triggers):
            signals.extend(CONCEPT_SYNONYMS[concept])
    for seed_term in list(signals):
        for concept, synonyms in CONCEPT_SYNONYMS.items():
            if seed_term == concept.lower() or seed_term in synonyms[:3]:
                signals.extend(synonyms)
    for keyword in extract_keywords(text):
        if len(keyword) >= 2:
            signals.append(keyword)
    # Stray two-letter tokens like "ai" match nearly every modern resume, keep them out.
    return [s for s in dict.fromkeys(signals) if s and s not in {"ai", "的", "和"}][:28]


def _heading_kind(line: str) -> str | None:
    compact = re.sub(r"[\s*#:：【】\[\]]", "", line).lower()
    if len(compact) > 16:
        return None
    for kind, headings in _SECTION_HEADINGS.items():
        if any(compact.startswith(re.sub(r"\s", "", heading).lower()) for heading in headings):
            return kind
    return None


def _split_jd_sections(jd_text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {"responsibilities": [], "requirements": [], "bonus": [], "ignore": [], "other": []}
    current = "other"
    for raw in _clean(jd_text).split("\n"):
        line = raw.strip().strip("*").strip()
        if not line or set(line) <= {"-", "—", "_", "="}:
            continue
        kind = _heading_kind(line)
        if kind:
            current = kind
            continue
        if _ITEM_RE.match(line) or current != "other":
            item = _ITEM_RE.sub("", line).replace("**", "").strip()
            if len(item) >= 4:
                sections[current].append(item)
    return sections


def _short_label(text: str, limit: int = 22) -> str:
    clauses = [c.strip() for c in re.split(r"[，,；;。：:（(）)]", text) if len(c.strip()) >= 4]
    triggers = [t for values in _CONCEPT_TRIGGERS.values() for t in values if t != "ai"]
    head = next((c for c in clauses if any(t in c.lower() for t in triggers)), clauses[0] if clauses else text)
    head = re.sub(r"^(?:逐步|能够|可以|需要|熟练|负责)", "", head).strip() or head
    return head[:limit] + ("…" if len(head) > limit else "")


def _detect_knockouts(text: str) -> list[dict[str, Any]]:
    knockouts: list[dict[str, Any]] = []
    lowered = text.lower()
    degree_match = re.search(r"(本科|硕士|博士|大专|专科)(?:及以上|以上)", text)
    if degree_match:
        degree = {"大专": "associate", "专科": "associate", "本科": "bachelor", "硕士": "master", "博士": "doctor"}[degree_match.group(1)]
        knockouts.append({
            "key": "ko_degree",
            "label": f"{degree_match.group(1)}及以上学历",
            "kind": "degree",
            "params": {"min_degree": degree},
        })
    years = sorted({int(y) for y in re.findall(r"(20\d{2})\s*届", text)})
    if years:
        knockouts.append({
            "key": "ko_graduation",
            "label": f"{'/'.join(str(y) for y in years)} 届毕业生",
            "kind": "graduation_year",
            "params": {"years": years},
        })
    elif "应届" in lowered:
        knockouts.append({"key": "ko_graduation", "label": "应届毕业生", "kind": "custom", "params": {}})
    return knockouts


def _role_level(text: str) -> str:
    if re.search(r"校招|应届|实习|20\d{2}\s*届|在校", text):
        return "campus"
    if re.search(r"([5-9]|十)\s*年(?:以上)?(?:工作)?经验|资深|专家|高级", text):
        return "senior"
    if re.search(r"[3-4]\s*年(?:以上)?(?:工作)?经验", text):
        return "mid"
    return "junior"


def build_fallback_rubric(jd_title: str, jd_text: str) -> dict[str, Any]:
    """Deterministic rubric parsed from JD structure; used when the LLM is unavailable."""

    sections = _split_jd_sections(jd_text)
    core_source = sections["requirements"] or sections["responsibilities"] or sections["other"]
    requirements: list[dict[str, Any]] = []

    def add(text: str, category: str, weight: int, label: str = "", seed: list[str] | None = None) -> None:
        signals = expand_signals("" if seed else text, seed)
        if not signals:
            return
        requirements.append({
            "key": f"r{len(requirements) + 1}",
            "label": label or _short_label(text),
            "description": text[:200],
            "category": category,
            "weight": weight,
            "signals": signals,
            "excellent": "",
            "interview_probe": "",
        })

    for item in core_source[:8]:
        if re.search(r"(本科|硕士|博士|大专)(?:及以上|以上)|20\d{2}\s*届", item):
            # Degree/cohort are knockouts; what remains is the major/portfolio preference.
            add(item, "core", 8, "专业背景与实际作品", _MAJOR_SIGNALS)
            continue
        is_potential = any(term in item for term in _POTENTIAL_TERMS)
        add(item, "potential" if is_potential else "core", 10 if is_potential else 20)
    if sections["requirements"]:
        # Responsibilities describe what the role actually builds; score them as applied skills.
        applied = [
            item for item in sections["responsibilities"]
            if any(term in item.lower() for term in ("ai", "大模型", "agent", "rag", "prompt", "全栈", "开发"))
        ]
        for item in applied[:4]:
            add(item, "core", 12)
    for item in sections["bonus"][:4]:
        add(item, "bonus", 10)

    if not requirements:
        add(jd_text[:200] or jd_title, "core", 100)

    return normalize_rubric(
        {
            "role_title": jd_title,
            "role_level": _role_level(jd_text),
            "role_summary": _clean(jd_text)[:120],
            "knockouts": _detect_knockouts(jd_text),
            "requirements": requirements,
        },
        jd_title=jd_title,
        jd_text=jd_text,
        source="fallback",
    )


def normalize_rubric(
    payload: dict[str, Any],
    *,
    jd_title: str,
    jd_text: str,
    source: str,
) -> dict[str, Any]:
    """Validate and clamp a rubric from any source (LLM, user edits, parser)."""

    requirements: list[dict[str, Any]] = []
    used_keys: set[str] = set()
    for index, item in enumerate(payload.get("requirements") or [], start=1):
        if not isinstance(item, dict):
            continue
        label = _clean(item.get("label"))[:40]
        description = _clean(item.get("description"))[:300]
        if not label and not description:
            continue
        category = str(item.get("category") or "core").strip().lower()
        if category not in CATEGORY_LABELS:
            category = "core"
        key = re.sub(r"[^a-z0-9_]", "", str(item.get("key") or "").lower()) or f"r{index}"
        while key in used_keys:
            key = f"{key}_{index}"
        used_keys.add(key)
        try:
            weight = int(round(float(item.get("weight") or 0)))
        except (TypeError, ValueError):
            weight = 10
        seed_signals = item.get("signals") if isinstance(item.get("signals"), list) else []
        requirements.append({
            "key": key,
            "label": label or _short_label(description),
            "description": description or label,
            "category": category,
            "weight": max(0, min(weight, 60)),
            "signals": expand_signals(f"{label} {description}", [str(s) for s in seed_signals]),
            "excellent": _clean(item.get("excellent"))[:200],
            "interview_probe": _clean(item.get("interview_probe"))[:200],
        })
    requirements = requirements[:12]
    if requirements and not any(r["weight"] for r in requirements if r["category"] != "bonus"):
        for item in requirements:
            item["weight"] = 10

    knockouts: list[dict[str, Any]] = []
    for index, item in enumerate(payload.get("knockouts") or [], start=1):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "custom").strip().lower()
        kind = kind if kind in KNOCKOUT_KINDS else "custom"
        params = item.get("params") if isinstance(item.get("params"), dict) else {}
        if kind == "degree" and params.get("min_degree") not in DEGREE_RANK:
            params = {"min_degree": "bachelor"}
        if kind == "graduation_year":
            years = [int(y) for y in params.get("years") or [] if str(y).isdigit()]
            if not years:
                kind, params = "custom", {}
            else:
                params = {"years": years}
        label = _clean(item.get("label"))[:40]
        if not label:
            continue
        knockouts.append({
            "key": re.sub(r"[^a-z0-9_]", "", str(item.get("key") or "").lower()) or f"ko_{index}",
            "label": label,
            "kind": kind,
            "params": params,
        })

    role_level = str(payload.get("role_level") or "").strip().lower()
    return {
        "version": RUBRIC_VERSION,
        "fingerprint": jd_fingerprint(jd_title, jd_text),
        "source": source,
        "role_title": _clean(payload.get("role_title") or jd_title)[:60],
        "role_level": role_level if role_level in ROLE_LEVELS else _role_level(jd_text),
        "role_summary": _clean(payload.get("role_summary"))[:200],
        "knockouts": knockouts[:4],
        "requirements": requirements,
    }


def _rubric_messages(jd_title: str, jd_text: str) -> list[Any]:
    schema = {
        "role_title": "岗位名称",
        "role_level": "campus|junior|mid|senior",
        "role_summary": "一句话岗位画像：这个人要解决什么问题",
        "knockouts": [
            {"key": "ko_degree", "label": "本科及以上学历", "kind": "degree", "params": {"min_degree": "bachelor"}},
            {"key": "ko_graduation", "label": "2027 届毕业生", "kind": "graduation_year", "params": {"years": [2027]}},
        ],
        "requirements": [
            {
                "key": "r1",
                "label": "≤16 字的能力名称",
                "description": "从 JD 提炼的可被简历证据验证的具体要求",
                "category": "core|potential|bonus",
                "weight": 20,
                "signals": ["简历里可能出现的关键词/同义词/具体技术或产品名，中英文，8-15 个"],
                "excellent": "该岗位级别下“突出”的简历证据长什么样",
                "interview_probe": "针对这项能力的一道行为面试追问",
            }
        ],
    }
    return [
        SystemMessage(content=(
            "你是资深招聘负责人与结构化面试专家（熟悉 Google 结构化招聘、Lou Adler 绩效画像、Greenhouse 评分卡）。"
            "任务：把岗位 JD 转成可复用、可解释、可被简历证据验证的评分卡。只输出 JSON。"
        )),
        HumanMessage(content=(
            "规则：\n"
            "1. knockouts 只放硬性门槛（学历下限、届别/毕业年份、必需证书等），不要把“优先”条件放进去；工作地点、福利不算。\n"
            "2. requirements 6-9 项：core 为岗位必须具备的能力（4-6 项），potential 为软素质/潜力（1-2 项），bonus 为加分项（1-3 项，任一满足即加分）。\n"
            "3. core+potential 的 weight 总和 = 100，按对岗位成败的重要性分配；bonus 的 weight 表示单项加分上限（通常 10-15）。\n"
            "4. 合并重复要求；“专业不限但看重作品”这类表述应体现为对作品/项目证据的要求，而不是专业门槛。\n"
            "5. 校招岗位按校招标准定义 excellent（课程/个人/实习项目的完整交付即可），不要用社招资深标准。\n"
            "6. 不得包含性别、年龄、婚育、籍贯、外貌、学校名气等与岗位无关或有歧视风险的条件。\n\n"
            f"输出 JSON 结构示例：\n{json.dumps(schema, ensure_ascii=False)}\n\n"
            f"岗位名称：{jd_title}\n\n岗位 JD：\n{jd_text[:6000]}"
        )),
    ]


def _extract_json(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
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


async def generate_rubric(jd_title: str, jd_text: str, *, use_cache: bool = True) -> dict[str, Any]:
    fingerprint = jd_fingerprint(jd_title, jd_text)
    if use_cache and fingerprint in _RUBRIC_CACHE:
        _RUBRIC_CACHE.move_to_end(fingerprint)
        return json.loads(json.dumps(_RUBRIC_CACHE[fingerprint]))

    rubric: dict[str, Any] | None = None
    try:
        llm = with_usage(create_llm(model=role_model("rubric"), temperature=0.1))
        messages = _rubric_messages(jd_title, jd_text)
        response = await llm.ainvoke(messages)
        output = extract_text_content(response.content)
        record_usage(
            "rubric", llm, response.usage_metadata,
            prompt_text="\n".join(extract_text_content(message.content) for message in messages), output_text=output,
        )
        payload = _extract_json(output)
        candidate = normalize_rubric(payload, jd_title=jd_title, jd_text=jd_text, source="ai")
        if len([r for r in candidate["requirements"] if r["category"] != "bonus"]) >= 2:
            rubric = candidate
    except Exception:
        rubric = None
    if rubric is None:
        rubric = build_fallback_rubric(jd_title, jd_text)
    if rubric["source"] == "ai":
        _RUBRIC_CACHE[fingerprint] = rubric
        while len(_RUBRIC_CACHE) > _RUBRIC_CACHE_LIMIT:
            _RUBRIC_CACHE.popitem(last=False)
    return json.loads(json.dumps(rubric))


def parse_rubric_json(raw: str | None, *, jd_title: str, jd_text: str) -> dict[str, Any] | None:
    """Parse a client-supplied rubric (possibly weight-edited); None if absent/invalid."""

    if not raw or not raw.strip():
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    rubric = normalize_rubric(
        payload,
        jd_title=jd_title,
        jd_text=jd_text,
        source=str(payload.get("source") or "custom")[:16],
    )
    return rubric if rubric["requirements"] else None
