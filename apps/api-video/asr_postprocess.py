"""ASR 字幕后处理管线：确定性繁转简、保护小数点智能断句、口语赘词清洗与跨分片残句缝合。"""
from __future__ import annotations

import re
from _t2s_chars import SIMP_CHARS, TRAD_CHARS

# 构建零依赖 C 级字符转换表
_T2S_TABLE = str.maketrans(TRAD_CHARS, SIMP_CHARS)

# 需要保护不被单字误转的词组（如「著名」不可变成「着名」，「乾坤」不可变成「干坤」）
_PROTECTED_WORDS = (
    "著名",
    "著作",
    "显著",
    "原著",
    "名著",
    "专著",
    "编著",
    "卓著",
    "昭著",
    "执著",
    "乾坤",
    "乾隆",
    "狼藉",
    "慰藉",
    "蕴藉",
    "宫商角徵羽",
)

# 智能断句正则：
# 1. 在中文句末标点（。！？；）或英文感叹号/问号/分号/换行符后切分；
# 2. 半角句点 `.` 仅在「左侧非数字且非字母」且「右侧非数字且非字母」时切分，
#    从而 100% 保护小数点（0.5、9.0）、版本号（3.11）与技术名词（Node.js、Vue.js）。
_SMART_SENT_SPLIT = re.compile(
    r"(?<=[。！？!?；;\n])\s*|(?<!\d)(?<![a-zA-Z])\.(?!\d)(?![a-zA-Z])\s*"
)

# 纯语气词独立成句判定（如单独一句「啊。」、「呃。」、「嗯。」）
_PURE_FILLER_RE = re.compile(r"^[啊呃嗯哦噢呀啦哈嘿唔唉]+[。！？!?.，,、\s]*$")

# 句首无意义口语叹词（如「啊我看很多人」->「我看很多人」，「啊人家面试官」->「人家面试官」）
_LEADING_FILLER_RE = re.compile(
    r"(^|(?<=[，,。！？!?；;\s]))[啊呃嗯]+[，,、\s]*(?=[我你他她它这那人大家其但所因不真其])"
)

# 口语结巴单字重复（如「我我找个人」->「我找个人」，「这这个」->「这个」）
_STUTTER_RE = re.compile(r"(?<![a-zA-Z0-9])([我你他她它这那])\1+")

# 小数点两侧被意外插入空格或换行的修复（如 `9. \n 0` -> `9.0`）
_BROKEN_DECIMAL_RE = re.compile(r"(\d)\s*\.\s*(\d)")

# 跨片开头助词匹配（如后一片开头为「吧，你肯定...」）
_LEADING_PARTICLE_RE = re.compile(
    r"^([吧呢吗啊呀啦呗嘛的了着过])[，,。！？!?\s]+(.+)$"
)


def to_simplified_chinese(text: str) -> str:
    """将文本中的繁体中文确定性地转换为规范简体中文（耗时 < 0.05ms，零外部依赖）。"""
    if not text:
        return ""
    # 1. 临时占位保护多音特例词
    placeholders: list[tuple[str, str]] = []
    for idx, word in enumerate(_PROTECTED_WORDS):
        if word in text:
            ph = f"\x00P{idx}\x00"
            text = text.replace(word, ph)
            placeholders.append((ph, word))

    # 2. 执行全表繁转简
    res = text.translate(_T2S_TABLE)

    # 3. 还原受保护词组
    for ph, word in placeholders:
        res = res.replace(ph, word)
    return res


def clean_spoken_text(text: str) -> str:
    """对 ASR 识别出的原始文本执行简繁归一、小数点修复与口语冗余清洗。"""
    if not text:
        return ""
    # 1. 强制转为简体中文
    s = to_simplified_chinese(text.strip())

    # 2. 修复被空格或换行拆散的小数点（如 `9.\n0` 或 `0. 5` -> `9.0`、`0.5`）
    s = _BROKEN_DECIMAL_RE.sub(r"\1.\2", s)

    # 3. 修正高频口语叠字笔误
    s = s.replace("不仅仅仅", "不仅仅")
    s = _STUTTER_RE.sub(r"\1", s)

    # 4. 去除句首或分句首无意义的「啊/呃/嗯」起音词
    s = _LEADING_FILLER_RE.sub(r"\1", s)

    return s.strip()


def split_sentences_smart(text: str) -> list[str]:
    """智能分句：保护小数点与版本号，剔除纯语气词废句，合并断裂数字。"""
    cleaned = clean_spoken_text(text)
    if not cleaned:
        return []

    raw_parts = [p.strip() for p in _SMART_SENT_SPLIT.split(cleaned) if p and p.strip()]
    if not raw_parts:
        return []

    merged: list[str] = []
    for part in raw_parts:
        # 过滤纯语气词独立成句（如「啊。」、「呃。」）
        if _PURE_FILLER_RE.match(part):
            continue

        # 若上一句以 `数字.` 结尾且当前句以 `数字` 开头（如 `9.` + `0的整个体系`），直接合并
        if merged and re.search(r"\d\.$", merged[-1]) and re.match(r"^\d", part):
            merged[-1] = merged[-1] + part
            continue

        # 若上一句仅为纯序号（如 `1.`、`2.`），与当前句合并
        if merged and re.match(r"^\d+\.$", merged[-1]):
            merged[-1] = merged[-1] + " " + part
            continue

        merged.append(part)

    return merged


def repair_segments_list(segments: list[dict]) -> list[dict]:
    """对分段列表执行全量后处理：繁转简、过滤纯语气词废句、缝合断裂小数与跨片残句。"""
    if not segments:
        return []

    out: list[dict] = []
    for seg in segments:
        raw_text = (seg.get("text") or "").strip()
        if not raw_text:
            continue
        text = clean_spoken_text(raw_text)
        if not text or _PURE_FILLER_RE.match(text):
            continue

        start = float(seg.get("start", 0.0) or 0.0)
        end = float(seg.get("end", start) or start)

        if out:
            prev = out[-1]
            prev_text = prev["text"]

            # 1) 缝合被切碎的小数/版本号：如 prev="...这也是我们的9." + curr="0的整个体系..."
            if re.search(r"\d\.$", prev_text) and re.match(r"^\d", text):
                prev["text"] = clean_spoken_text(prev_text + text)
                prev["end"] = max(prev["end"], end)
                continue

            # 2) 缝合跨分片句尾助词：如 prev="...问你搞过高并发" + curr="吧，你肯定不能说..."
            m_part = _LEADING_PARTICLE_RE.match(text)
            if m_part and not re.search(r"[。！？!?；;]$", prev_text):
                particle, rest_text = m_part.group(1), m_part.group(2).strip()
                punct = "？" if particle in ("吗", "呢") or "问" in prev_text[-12:] else "。"
                prev["text"] = prev_text.rstrip("，,、 ") + particle + punct
                text = clean_spoken_text(rest_text)
                if not text or _PURE_FILLER_RE.match(text):
                    continue

            # 3) 缝合跨分片未说完的短尾分句：
            # 如 prev="首先基础设施我们要学AI研发效能提升，用AI一天" + curr="可以写1万行代码..."
            if not re.search(r"[。！？!?；;.”\"'）)]$", prev["text"]):
                last_comma_Match = re.search(r"^(.*)[，,、]\s*([^，,、。！？!?；;]{1,8})$", prev["text"])
                if last_comma_Match and not re.match(r"^(第[一二三四五六七八九十\d]+|首先|其次|接下来|然后|所以|但是|因为|好[，,])", text):
                    head_clause = last_comma_Match.group(1).strip()
                    tail_Stub = last_comma_Match.group(2).strip()
                    prev["text"] = head_clause + "。"
                    text = clean_spoken_text(tail_Stub + text)
                elif len(prev["text"]) <= 10 and not re.search(r"[，,。！？!?]", prev["text"]):
                    # 若前一句整体就是极短的半句话（<=10字且无标点），直接并入当前句开头
                    text = clean_spoken_text(prev["text"] + text)
                    start = prev["start"]
                    out.pop()

        out.append({"start": start, "end": end, "text": text})

    return out
