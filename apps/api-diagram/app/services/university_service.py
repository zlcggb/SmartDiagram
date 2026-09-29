"""University library + education-fact inference used as a screening tool.

The library covers 985 / 211 / 双一流 institutions; other Chinese institutions are classified
by name rules (大学 / 学院 -> 本科院校, 职业 / 专科 -> 专科院校). School tier is informational
only and never scored; it is used to infer the degree level when the resume omits it.
"""

from __future__ import annotations

import re
from typing import Any

_985 = """
北京大学 清华大学 中国人民大学 北京航空航天大学 北京理工大学 中国农业大学 北京师范大学 中央民族大学
南开大学 天津大学 大连理工大学 东北大学 吉林大学 哈尔滨工业大学 复旦大学 同济大学 上海交通大学
华东师范大学 南京大学 东南大学 浙江大学 中国科学技术大学 厦门大学 山东大学 中国海洋大学 武汉大学
华中科技大学 湖南大学 中南大学 中山大学 华南理工大学 四川大学 电子科技大学 重庆大学 西安交通大学
西北工业大学 西北农林科技大学 兰州大学 国防科技大学
""".split()

_211 = """
北京交通大学 北京工业大学 北京科技大学 北京化工大学 北京邮电大学 北京林业大学 北京中医药大学
北京外国语大学 中国传媒大学 中央财经大学 对外经济贸易大学 北京体育大学 中央音乐学院 中国政法大学
华北电力大学 中国矿业大学 中国石油大学 中国地质大学 天津医科大学 河北工业大学 太原理工大学 内蒙古大学
辽宁大学 大连海事大学 延边大学 东北师范大学 哈尔滨工程大学 东北农业大学 东北林业大学 华东理工大学
东华大学 上海外国语大学 上海财经大学 上海大学 海军军医大学 第二军医大学 苏州大学 南京航空航天大学
南京理工大学 河海大学 江南大学 南京农业大学 中国药科大学 南京师范大学 安徽大学 合肥工业大学 福州大学
南昌大学 郑州大学 武汉理工大学 华中农业大学 华中师范大学 中南财经政法大学 湖南师范大学 暨南大学
华南师范大学 广西大学 海南大学 西南交通大学 西南财经大学 四川农业大学 西南大学 贵州大学 云南大学
西藏大学 西北大学 西安电子科技大学 长安大学 陕西师范大学 空军军医大学 第四军医大学 青海大学 宁夏大学
新疆大学 石河子大学
""".split()

_DOUBLE_FIRST_CLASS = """
南方科技大学 上海科技大学 首都师范大学 外交学院 中国人民公安大学 中国科学院大学 北京协和医学院
中国音乐学院 中央美术学院 中央戏剧学院 天津工业大学 天津中医药大学 山西大学 湘潭大学 南京邮电大学
南京信息工程大学 南京林业大学 南京医科大学 南京中医药大学 中国美术学院 上海海洋大学 上海中医药大学
上海体育大学 上海体育学院 上海音乐学院 宁波大学 河南大学 广州医科大学 广州中医药大学 华南农业大学
成都理工大学 西南石油大学 成都中医药大学 中国社会科学院大学
""".split()
_KNOWN = sorted({*_985, *_211, *_DOUBLE_FIRST_CLASS}, key=len, reverse=True)

_JUNIOR_RE = re.compile(r"职业|高等专科|专科学校|高职|技师学院|职业技术")
_SCHOOL_RE = re.compile(r"[\u4e00-\u9fff]{2,24}?(?:大学|学院|学校)")
_DEGREE_PATTERNS = (
    (r"博士|ph\.?d|doctor", 4, "博士"),
    (r"硕士|研究生|master|m\.s\.|mba", 3, "硕士"),
    (r"本科|学士|bachelor|b\.s\.|b\.e\.", 2, "本科"),
    (r"大专|专科|高职|associate", 1, "专科"),
)
_DEGREE_YEARS = {1: 3, 2: 4, 3: 3, 4: 4}
_RANGE_RE = re.compile(
    r"(20\d{2})\s*(?:[./年-]\s*(\d{1,2})\s*月?)?\s*[~～\-—–至到]+\s*(20\d{2}|至今|今|现在)"
)
_START_RE = re.compile(r"(20\d{2})\s*[./年-]\s*(\d{1,2})\s*月?")


def _tier_tags(name: str) -> list[str]:
    tags = []
    if name in _985:
        tags.append("985")
    if name in _985 or name in _211:
        tags.append("211")
    if name in _985 or name in _211 or name in _DOUBLE_FIRST_CLASS:
        tags.append("双一流")
    return tags


def lookup_university(name: str) -> dict[str, Any] | None:
    """Return {name, level, tags, source} for one institution name, or None if not a school."""

    cleaned = re.sub(r"(?:19|20)\d{2}\s*年?|\d{1,2}\s*月", " ", name or "")
    tokens = [token for token in re.split(r"[^\u4e00-\u9fff]+", cleaned) if token]
    if not tokens:
        return None
    known = next((item for item in _KNOWN if any(item in token for token in tokens)), None)
    if known:
        return {"name": known, "level": "本科院校", "tags": _tier_tags(known), "source": "院校库"}
    match = next((m for token in tokens if (m := _SCHOOL_RE.search(token))), None)
    if not match:
        return None
    school = match.group(0)
    if _JUNIOR_RE.search(school):
        return {"name": school, "level": "专科院校", "tags": [], "source": "名称规则"}
    return {"name": school, "level": "本科院校", "tags": [], "source": "名称规则"}


def _degree(text: str) -> tuple[int, str]:
    lowered = text.lower()
    for pattern, rank, label in _DEGREE_PATTERNS:
        if re.search(pattern, lowered):
            return rank, label
    return 0, ""


def infer_education_facts(profile: dict[str, Any], resume_text: str) -> list[dict[str, Any]]:
    """Tool: per education record -> school lookup, degree and graduation year (explicit or inferred)."""

    records = list(profile.get("education") or [])
    if not records:
        evidence = (profile.get("section_evidence") or {}).get("education") or []
        records = [{"institution": "", "evidence": str(item.get("text") or "")} for item in evidence[:3]]
    facts: list[dict[str, Any]] = []
    for record in records[:4]:
        school_name = str(record.get("institution") or "")
        text = " ".join(str(record.get(key) or "") for key in ("institution", "degree", "major", "years", "evidence"))
        if school_name:
            # The record evidence can be cut short by layout; pull the school's own lines from the resume.
            text += " " + " ".join(line for line in resume_text.split("\n") if school_name in line)[:600]
        school = lookup_university(school_name or text)
        rank, degree = _degree(str(record.get("degree") or "") or text)
        degree_source = "简历明示" if rank else ""
        if not rank and school:
            rank, degree, degree_source = (1, "专科", "院校库推断") if school["level"] == "专科院校" else (2, "本科", "院校库推断")

        start_year = end_year = None
        range_match = _RANGE_RE.search(text)
        if range_match:
            start_year = int(range_match.group(1))
            if range_match.group(3).isdigit():
                end_year = int(range_match.group(3))
        explicit_grad = re.search(r"(20\d{2})\s*届|(20\d{2})\s*年?\s*\d{0,2}\s*月?\s*毕业", text)
        if explicit_grad:
            end_year = int(explicit_grad.group(1) or explicit_grad.group(2))
        if start_year is None:
            start_match = _START_RE.search(text)
            if start_match:
                start_year = int(start_match.group(1))
        graduation_source = "简历明示" if end_year else ""
        if end_year is None and start_year and rank:
            end_year = start_year + _DEGREE_YEARS[rank]
            graduation_source = f"入学 {start_year} + {degree}学制 {_DEGREE_YEARS[rank]} 年推断"

        facts.append({
            "school": school["name"] if school else school_name,
            "school_level": school["level"] if school else "",
            "school_tags": school["tags"] if school else [],
            "school_source": school["source"] if school else "",
            "degree": degree,
            "degree_rank": rank,
            "degree_source": degree_source,
            "start_year": start_year,
            "graduation_year": end_year,
            "graduation_source": graduation_source,
        })
    return facts
