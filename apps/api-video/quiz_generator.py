"""基于视频总结与核心转写生成极速、有依据的互动学习卡片测验。"""
import re
from difflib import SequenceMatcher
from typing import Any

from llm_client import chat_json


QUESTION_TYPES = {
    "single": "single_choice",
    "single_choice": "single_choice",
    "choice": "single_choice",
    "multiple": "multiple_choice",
    "multiple_choice": "multiple_choice",
    "multi": "multiple_choice",
    "true_false": "true_false",
    "boolean": "true_false",
    "judgment": "true_false",
    "fill_blank": "fill_blank",
    "fill": "fill_blank",
    "单选题": "single_choice",
    "多选题": "multiple_choice",
    "选择题": "single_choice",
    "判断题": "true_false",
    "填空题": "fill_blank",
}


def _clean_text(value: Any, limit: int = 1000) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def _fmt_ts(seconds: float) -> str:
    s = max(0, int(seconds or 0))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def _truth(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _clean_text(value, 20).lower()
    return text in {"true", "正确", "对", "是", "1", "√"}


def _choice_answer(value: Any, options: list[str]) -> str:
    raw = _clean_text(value, 300)
    if len(raw) == 1 and raw.upper() in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        index = ord(raw.upper()) - ord("A")
        if 0 <= index < len(options):
            return options[index]
    for option in options:
        if raw == option:
            return option
    return raw


def _ground_reference(
    transcript: list[dict], seconds: float, reference_text: str = ""
) -> tuple[float, str]:
    if not transcript:
        return max(0, seconds), ""
    valid = [seg for seg in transcript if isinstance(seg, dict) and seg.get("text")]
    if not valid:
        return max(0, seconds), ""

    target = _clean_text(reference_text, 500)
    # 若模型已给出大致时间戳，优先在 ±50 秒窗口内快速对齐，避免 O(N*M) 全量慢扫描
    candidates = valid
    if seconds > 0:
        window = [
            seg for seg in valid if abs(float(seg.get("start") or 0) - seconds) <= 50
        ]
        if window:
            candidates = window

    if target:
        matched = max(
            candidates,
            key=lambda seg: SequenceMatcher(
                None, target, _clean_text(seg.get("text"), 500)
            ).ratio(),
        )
        similarity = SequenceMatcher(
            None, target, _clean_text(matched.get("text"), 500)
        ).ratio()
        if similarity >= 0.32:
            return (
                max(0, float(matched.get("start") or 0)),
                _clean_text(matched.get("text"), 500),
            )

    nearest = min(valid, key=lambda seg: abs(float(seg.get("start") or 0) - seconds))
    return max(0, float(nearest.get("start") or 0)), _clean_text(nearest.get("text"), 500)


def _build_fast_quiz_context(result: dict) -> str:
    """构建轻量高密度出题上下文（控制在 ~3500 字以内，比全量塞 12000 字字幕快 3 倍）。"""
    parts: list[str] = []
    title = (result.get("title") or "").strip()
    if title:
        parts.append(f"# 视频主题：{title}")
    tldr = (result.get("tldr") or "").strip()
    if tldr:
        parts.append(f"## 核心破局点 (TL;DR)\n{tldr}")
    kps = result.get("key_points") or []
    if kps:
        parts.append("## 核心知识要点\n" + "\n".join(f"- {p}" for p in kps))
    takeaways = result.get("actionable_takeaways") or []
    if takeaways:
        parts.append("## 实战行动指南\n" + "\n".join(f"- {a}" for a in takeaways))
    chs = result.get("chapters") or []
    if chs:
        clines = [
            f"[{c.get('time', '')} (约{int(c.get('seconds') or 0)}秒)] {c.get('title', '')}: {c.get('summary', '')}"
            for c in chs
        ]
        parts.append("## 章节时间轴\n" + "\n".join(clines))
    summary = (result.get("summary") or "").strip()
    if summary:
        parts.append(f"## 深度研报摘要\n{summary[:2200]}")

    transcript = [
        seg
        for seg in (result.get("transcript") or [])
        if isinstance(seg, dict) and len(str(seg.get("text") or "").strip()) >= 8
    ]
    if transcript:
        step = max(1, len(transcript) // 28)
        sampled = transcript[::step][:30]
        t_lines = [
            f"[{int(float(s.get('start') or 0))}s | {_fmt_ts(float(s.get('start') or 0))}] {s.get('text', '')}"
            for s in sampled
        ]
        parts.append("## 关键原话时间戳抽样\n" + "\n".join(t_lines))

    return "\n\n".join(parts)


def normalize_quiz(raw: dict, result: dict, requested_count: int = 6) -> list[dict]:
    items = raw.get("questions") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        raise ValueError("模型未返回有效的 questions 数组")

    transcript = result.get("transcript") or []
    questions: list[dict] = []
    seen_stems: set[str] = set()

    for item in items:
        if len(questions) >= requested_count:
            break
        if not isinstance(item, dict):
            continue
        question_type = QUESTION_TYPES.get(
            _clean_text(item.get("type"), 50).lower().replace("-", "_")
        )
        stem = _clean_text(item.get("stem") or item.get("question"), 500)
        if not question_type or not stem or stem in seen_stems:
            continue

        dimension = _clean_text(item.get("dimension") or item.get("category") or "", 30)
        options = [
            _clean_text(option, 300)
            for option in (item.get("options") or [])
            if _clean_text(option, 300)
        ]
        if question_type in {"single_choice", "multiple_choice"} and len(options) < 2:
            continue
        if question_type == "true_false":
            options = ["正确", "错误"]

        raw_correct = item.get("correct_answer", item.get("correct"))
        accepted = item.get("accepted_answers") or []
        if question_type == "multiple_choice":
            values = raw_correct if isinstance(raw_correct, list) else [raw_correct]
            correct_answer = [_choice_answer(value, options) for value in values]
            correct_answer = [value for value in correct_answer if value in options]
            if not correct_answer:
                continue
        elif question_type == "single_choice":
            correct_answer = _choice_answer(raw_correct, options)
            if correct_answer not in options:
                continue
        elif question_type == "true_false":
            correct_answer = _truth(raw_correct)
        else:
            correct_answer = _clean_text(raw_correct, 300)
            accepted = [
                _clean_text(value, 300)
                for value in (accepted if isinstance(accepted, list) else [accepted])
                if _clean_text(value, 300)
            ]
            if correct_answer and correct_answer not in accepted:
                accepted.insert(0, correct_answer)
            if not accepted:
                continue

        try:
            reference_time = max(0, float(item.get("reference_time") or 0))
        except (TypeError, ValueError):
            reference_time = 0
        model_reference = _clean_text(item.get("reference_text"), 500)
        reference_time, reference_text = _ground_reference(
            transcript, reference_time, model_reference
        )
        if not reference_text:
            reference_text = model_reference

        questions.append(
            {
                "id": f"q{len(questions) + 1}",
                "type": question_type,
                "dimension": dimension or "核心认知",
                "stem": stem,
                "options": options,
                "correct_answer": correct_answer,
                "accepted_answers": accepted if question_type == "fill_blank" else [],
                "explanation": _clean_text(item.get("explanation"), 800),
                "reference_time": reference_time,
                "reference_text": reference_text,
                "points": 1,
            }
        )
        seen_stems.add(stem)

    if len(questions) < min(3, requested_count):
        raise ValueError(f"有效题目不足：仅生成 {len(questions)} 道，请重试")
    return questions


def generate_quiz(result: dict, count: int = 6) -> dict:
    count = max(4, min(15, int(count or 6)))
    context = _build_fast_quiz_context(result)
    if not context.strip():
        raise ValueError("该视频总结没有可用于出题的内容")

    system = (
        "你是顶尖认知科学与实战培训专家。请根据视频资料设计一套高价值、启发思考的互动学习卡片测验。\n"
        "输出严格 JSON（不要 Markdown 代码块围栏）。根对象格式：\n"
        '{"title":"测验标题","questions":[{"type":"single_choice|true_false|multiple_choice",'
        '"dimension":"2~5字考察维度标签(如:底层逻辑/实战话术/避坑指南/核心方法)",'
        '"stem":"题干(优先结合实战场景或核心认知提问)",'
        '"options":["选项文本(不要带A/B/C/D前缀)"],'
        '"correct_answer":"单选填完整选项文本 / 判断填布尔值true或false / 多选填完整选项文本数组",'
        '"explanation":"一针见血点明为什么选该项，深化认知",'
        '"reference_time":120,'
        '"reference_text":"对应的视频核心原话或论据摘录"}]}\n'
        "设计准则：\n"
        f"1. 共生成 {count} 道精品题：以 `single_choice`（4选1情景单选）为主，搭配 1~2 道 `true_false`（认知误区判断）和 1 道 `multiple_choice`（多维要素多选）；不要出填空题。\n"
        "2. `options` 严禁带 A. / B. 等字母前缀；`correct_answer` 必须与 `options` 中的某一项文本完全一致（判断除外）。\n"
        "3. 每道题必须标注真实的 `reference_time`（秒数整数）与简短有力的 `explanation`。"
    )
    raw = chat_json(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": f"请为以下视频资料生成 {count} 道互动学习卡片题：\n\n{context}"},
        ],
        temperature=0.25,
        max_tokens=3600,
    )
    questions = normalize_quiz(raw, result, count)
    title = _clean_text(raw.get("title"), 100) or "视频核心认知闯关"
    return {
        "title": title,
        "estimated_minutes": max(3, min(15, round(len(questions) * 0.7))),
        "questions": questions,
    }
