"""基于视频总结与转写的 AI 问答（方案 A：上下文直塞 + 关键词检索长转写）。

仅依赖 llm_client；总结结果中的 summary/key_points/chapters/transcript 作为上下文。
长转写按用户问题关键词检索相关片段，避免超出模型上下文窗口。
"""
import os
import re
import time
from datetime import datetime, timezone, timedelta

from llm_client import chat, chat_stream

_CN_TZ = timezone(timedelta(hours=8))


def _now_time_str() -> str:
    return datetime.now(_CN_TZ).strftime("%H:%M:%S")

# 注入上下文的转写摘录字符上限（可用 QA_TRANSCRIPT_CHARS 覆盖）
MAX_TRANSCRIPT_CHARS = int(os.environ.get("QA_TRANSCRIPT_CHARS", "12000"))
# 多轮对话保留最近几轮（user+assistant 各算一条）
MAX_HISTORY_MSGS = int(os.environ.get("QA_MAX_HISTORY", "12"))

_STOP = frozenset(
    "的了吗呢吧啊是在有和与及这那什么怎么为何如何哪谁个一了到把被让对".split()
)


def _fmt_ts(seconds: float) -> str:
    s = int(seconds or 0)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


def _keywords(question: str) -> list[str]:
    q = (question or "").strip().lower()
    parts = re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}", q)
    out = []
    for p in parts:
        if p in _STOP or len(p) < 2:
            continue
        if p not in out:
            out.append(p)
    return out[:24]


def _segment_line(seg: dict) -> str:
    return f"[{_fmt_ts(seg.get('start', 0))}] {seg.get('text', '')}"


def _pick_transcript_excerpt(transcript: list, question: str, max_chars: int) -> str:
    if not transcript:
        return ""
    lines = [_segment_line(s) for s in transcript]
    full = "\n".join(lines)
    if len(full) <= max_chars:
        return full

    kws = _keywords(question)
    if not kws:
        half = max_chars // 2
        return full[:half] + "\n\n...(中间内容已省略)...\n\n" + full[-half:]

    scored: list[tuple[int, int, dict]] = []
    for i, seg in enumerate(transcript):
        text = (seg.get("text") or "").lower()
        score = sum(1 for k in kws if k in text)
        if score:
            scored.append((score, i, seg))
    scored.sort(key=lambda x: (-x[0], x[1]))

    picked: list[tuple[float, str]] = []
    used_ids: set[int] = set()
    char_count = 0

    # 开头几句保留背景
    for seg in transcript[:2]:
        line = _segment_line(seg)
        if char_count + len(line) + 1 > max_chars:
            break
        picked.append((float(seg.get("start", 0)), line))
        used_ids.add(id(seg))
        char_count += len(line) + 1

    for _, _, seg in scored:
        if id(seg) in used_ids:
            continue
        line = _segment_line(seg)
        if char_count + len(line) + 1 > max_chars:
            break
        picked.append((float(seg.get("start", 0)), line))
        used_ids.add(id(seg))
        char_count += len(line) + 1

    if not picked:
        half = max_chars // 2
        return full[:half] + "\n\n...(中间内容已省略)...\n\n" + full[-half:]

    picked.sort(key=lambda x: x[0])
    return "\n".join(x[1] for x in picked)


def build_context(result: dict, question: str, include_transcript: bool = True) -> str:
    """构建问答上下文。若 include_transcript=False 则仅加载总结与章节要点，避免长字幕直塞。"""
    parts: list[str] = []
    title = (result.get("title") or "").strip()
    if title:
        parts.append(f"# 视频标题：{title}")
    tldr = (result.get("tldr") or "").strip()
    if tldr:
        parts.append(f"## 核心破局点 (TL;DR)\n{tldr}")
    summary = (result.get("summary") or "").strip()
    if summary:
        parts.append(f"## 视频深度总结\n{summary}")
    kps = result.get("key_points") or []
    if kps:
        parts.append("## 知识要点\n" + "\n".join(f"- {p}" for p in kps))
    takeaways = result.get("actionable_takeaways") or []
    if takeaways:
        parts.append("## 实战落地建议\n" + "\n".join(f"- {a}" for a in takeaways))
    chs = result.get("chapters") or []
    if chs:
        clines = [
            f"[{c.get('time', '')}] {c.get('title', '')}: {c.get('summary', '')}"
            for c in chs
        ]
        parts.append("## 章节\n" + "\n".join(clines))
    if include_transcript:
        excerpt = _pick_transcript_excerpt(
            result.get("transcript") or [], question, MAX_TRANSCRIPT_CHARS
        )
        if excerpt:
            parts.append("## 转写摘录\n" + excerpt)
    return "\n\n".join(parts)


def _handle_download_intent(summary_task_id: str, result: dict) -> dict:
    title = result.get("title") or "当前视频"
    return {
        "answer": (
            f"已为您定位到本视频下载通道：\n\n"
            f"- **视频标题**：{title}\n"
            f"- **任务标识**：`{summary_task_id or '就绪'}`\n\n"
            f"您可以点击下方「立即下载」卡片直接保存视频到本地。"
        ),
        "action": {
            "type": "download",
            "summary_task_id": summary_task_id,
            "title": title,
        },
    }


def _handle_quiz_intent(summary_task_id: str, result: dict) -> dict:
    title = result.get("title") or "本视频"
    return {
        "answer": (
            f"已为您准备好《{title}》的专属互动测验！\n\n"
            f"包含单选、多选与视频时间戳溯源解析，您可以点击下方「进入测验」或切换至测验面板立即答题。"
        ),
        "action": {
            "type": "switch_tab",
            "tab": "quiz",
            "summary_task_id": summary_task_id,
        },
    }


def _build_translate_messages(result: dict, question: str, history: list | None = None) -> list[dict]:
    target_text = ""
    if history:
        for h in reversed(history):
            if isinstance(h, dict) and h.get("role") == "assistant" and h.get("content"):
                target_text = str(h["content"]).strip()
                break
    if not target_text:
        target_text = (result.get("summary") or "").strip()

    if not target_text:
        target_text = "视频总结内容暂时为空。"

    system_prompt = (
        "你是一位专业中英及多语言翻译专家。\n"
        "任务：根据用户的具体要求，将给定的文本准确、自然、流畅地翻译为目标语言。\n"
        "要求：保持原意与术语严谨，直接输出翻译结果，无需寒暄或额外解释。"
    )
    return [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": f"【用户翻译指令】：{question}\n\n【待翻译源文本】：\n{target_text[:3000]}",
        },
    ]


def _handle_translate_intent(result: dict, question: str, history: list | None = None) -> dict:
    messages = _build_translate_messages(result, question, history)
    translated = chat(messages, temperature=0.2, max_tokens=1500)
    return {
        "answer": translated,
        "action": None,
    }


def _parse_time_str_to_seconds(t_str: str) -> float | None:
    parts = t_str.strip().split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except (ValueError, IndexError):
        pass
    return None


def _handle_seek_intent(result: dict, question: str) -> dict:
    # 尝试在章节中检索匹配的时间戳与关键词
    chapters = result.get("chapters") or []
    kws = _keywords(question)
    best_chapter = None
    best_score = 0

    for ch in chapters:
        text = f"{ch.get('title', '')} {ch.get('summary', '')}".lower()
        score = sum(1 for k in kws if k in text)
        if score > best_score:
            best_score = score
            best_chapter = ch

    # 若正则直接包含时间 (如 03:20 或 5分钟)
    time_match = re.search(r"(\d{1,2}):(\d{2})", question)
    if time_match:
        target_ts = time_match.group(0)
        target_sec = _parse_time_str_to_seconds(target_ts) or 0.0
        return {
            "answer": f"已为您定位到指定时间点 **[{target_ts}]**，点击时间戳或卡片即可直接跳转播放。",
            "action": {"type": "seek", "seconds": target_sec, "time_str": target_ts},
        }

    min_match = re.search(r"(\d+)\s*分", question)
    if min_match:
        mins = int(min_match.group(1))
        target_sec = mins * 60.0
        target_ts = _fmt_ts(target_sec)
        return {
            "answer": f"已为您定位到视频第 {mins} 分钟 **[{target_ts}]**，点击时间戳或卡片即可跳转播放。",
            "action": {"type": "seek", "seconds": target_sec, "time_str": target_ts},
        }

    if best_chapter and best_chapter.get("time"):
        target_ts = best_chapter["time"]
        sec = _parse_time_str_to_seconds(target_ts) or 0.0
        return {
            "answer": (
                f"已为您找到对应章节：**[{target_ts}] {best_chapter.get('title', '')}**\n\n"
                f"章节要点：{best_chapter.get('summary', '')}\n\n"
                f"点击时间戳即可直接让播放器跳转至该节点。"
            ),
            "action": {"type": "seek", "seconds": sec, "time_str": target_ts},
        }

    # 兜底返回章节列表
    ch_list = "\n".join([f"- [{c.get('time')}] {c.get('title')}" for c in chapters[:5]])
    return {
        "answer": f"以下是视频的主要章节节点，您可以点击任意时间戳直接跳转：\n\n{ch_list}",
        "action": None,
    }


def _handle_chitchat_intent(question: str) -> dict:
    return {
        "answer": (
            "您好！我是您的 AI 视频研报与学习助手。\n\n"
            "针对当前视频，我可以为您提供：\n"
            "- 🔍 **深入问答**：基于视频事实、论据与长字幕精准溯源；\n"
            "- ⏱️ **秒级跳转**：定位任意时间点或核心章节片段；\n"
            "- 📝 **考题测验**：针对关键知识要点生成互动测验；\n"
            "- 📥 **视频导出**：协助快速下载并离线保存；\n"
            "- 🌐 **多语翻译**：将摘要或问答结论一键翻译为外语。\n\n"
            "请问今天想从视频的哪个知识点开始探讨？"
        ),
        "action": None,
    }


def ask(result: dict, question: str, history: list | None = None) -> str:
    """传统向后兼容问答接口（直接返回字符串答案）。"""
    routed = ask_routed(result, question, history)
    return routed["answer"]


def ask_routed(
    result: dict,
    question: str,
    history: list | None = None,
    summary_task_id: str = "",
) -> dict:
    """根据视频总结与系统 1 前置意图路由回答问题，实现毫秒级分流。"""
    question = (question or "").strip()
    if not question:
        raise ValueError("问题不能为空")

    # 提取上一轮历史摘要作为辅助判别上下文
    history_context = ""
    if history:
        for h in reversed(history):
            if isinstance(h, dict) and h.get("content"):
                history_context = str(h["content"])[:200]
                break

    # 1. 系统 1 毫秒级意图路由
    t_start = time.perf_counter()
    from intent_router import route_user_intent
    decision = route_user_intent(question, history_context)

    router_meta = {
        "intent": decision.intent,
        "confidence": decision.confidence,
        "latency_ms": decision.latency_ms,
        "jeff_ms": decision.latency_ms,
        "llm_ms": 0.0,
        "ttft_ms": 0.0,
        "total_ms": decision.latency_ms,
        "needs_transcript": decision.needs_transcript,
        "complexity": decision.complexity,
        "fallback": decision.fallback,
        "reason": decision.reason,
    }

    # 2. 多分支流水分流
    if decision.intent == "download":
        res = _handle_download_intent(summary_task_id, result)
        res["intent"] = "download"
        res["router"] = router_meta
        res["created_at"] = _now_time_str()
        return res

    if decision.intent == "make_quiz":
        res = _handle_quiz_intent(summary_task_id, result)
        res["intent"] = "make_quiz"
        res["router"] = router_meta
        res["created_at"] = _now_time_str()
        return res

    if decision.intent == "translate":
        t_llm = time.perf_counter()
        res = _handle_translate_intent(result, question, history)
        llm_ms = round((time.perf_counter() - t_llm) * 1000, 1)
        router_meta["llm_ms"] = llm_ms
        router_meta["total_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
        res["intent"] = "translate"
        res["router"] = router_meta
        res["created_at"] = _now_time_str()
        return res

    if decision.intent == "seek_player":
        res = _handle_seek_intent(result, question)
        res["intent"] = "seek_player"
        res["router"] = router_meta
        res["created_at"] = _now_time_str()
        return res

    if decision.intent == "chitchat":
        res = _handle_chitchat_intent(question)
        res["intent"] = "chitchat"
        res["router"] = router_meta
        res["created_at"] = _now_time_str()
        return res

    # 3. 核心 video_qa 分支：根据 needs_transcript 动态控制是否包含数万字长转写
    messages = _build_video_qa_messages(result, question, history, decision.needs_transcript)
    t_llm = time.perf_counter()
    answer = chat(messages, temperature=0.3, max_tokens=2048)
    llm_ms = round((time.perf_counter() - t_llm) * 1000, 1)
    router_meta["llm_ms"] = llm_ms
    router_meta["total_ms"] = round((time.perf_counter() - t_start) * 1000, 1)

    return {
        "answer": answer,
        "intent": "video_qa",
        "action": None,
        "router": router_meta,
        "created_at": _now_time_str(),
    }


def _build_video_qa_messages(
    result: dict,
    question: str,
    history: list | None,
    needs_transcript: bool,
) -> list[dict]:
    context = build_context(result, question, include_transcript=needs_transcript)
    if not context.strip():
        raise ValueError("该总结没有可用上下文，无法问答。")

    system = (
        "你是首席视频学习与深度总结顾问。请基于用户提供的视频总结、知识要点、章节与转写内容回答问题。\n"
        "核心准则：\n"
        "1. **主动包容模糊表达**：即使提问简短、口语化或不够清晰（如“说的啥”、“重点呢”、“有哪些值得记住的要点”），也要敏锐洞察其求知意图，结合视频核心内容给出条理分明、重点突出的总结性解答。\n"
        "2. **结构化与时间戳溯源**：善用 `**加粗**` 与要点列表组织答案；在引述关键论据、方法或案例时，请附带对应的时间戳 `[mm:ss]`，方便用户点击跳转回看。\n"
        "3. **事实为本**：严格忠于视频资料，若视频完全未涉及某无关领域，再礼貌说明视频未提及。"
    )
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": f"以下是与本视频相关的资料：\n\n{context}",
        },
        {
            "role": "assistant",
            "content": "好的，我会仅根据上述视频资料回答你的问题。",
        },
    ]

    hist = list(history or [])
    if len(hist) > MAX_HISTORY_MSGS:
        hist = hist[-MAX_HISTORY_MSGS:]
    for h in hist:
        role = h.get("role") if isinstance(h, dict) else None
        content = (h.get("content") if isinstance(h, dict) else "") or ""
        content = str(content).strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": question})
    return messages


def ask_routed_stream(
    result: dict,
    question: str,
    history: list | None = None,
    summary_task_id: str = "",
):
    """流式问答生成器：先输出系统 1 (Jev) 意图路由结果，再流式输出系统 2 (大模型) 回答与完整耗时。"""
    question = (question or "").strip()
    if not question:
        raise ValueError("问题不能为空")

    t_start = time.perf_counter()
    history_context = ""
    if history:
        for h in reversed(history):
            if isinstance(h, dict) and h.get("content"):
                history_context = str(h["content"])[:100]
                break

    from intent_router import route_user_intent
    decision = route_user_intent(question, history_context)

    router_meta = {
        "intent": decision.intent,
        "confidence": decision.confidence,
        "latency_ms": decision.latency_ms,
        "jeff_ms": decision.latency_ms,
        "llm_ms": 0.0,
        "ttft_ms": 0.0,
        "total_ms": decision.latency_ms,
        "needs_transcript": decision.needs_transcript,
        "complexity": decision.complexity,
        "fallback": decision.fallback,
        "reason": decision.reason,
    }

    # 第一帧：立即通知前端系统 1 (Jev) 路由决策完成
    yield {
        "event": "router",
        "router": dict(router_meta),
        "created_at": _now_time_str(),
    }

    # 非 LLM 瞬时分支
    if decision.intent in ("download", "make_quiz", "seek_player", "chitchat"):
        if decision.intent == "download":
            res = _handle_download_intent(summary_task_id, result)
        elif decision.intent == "make_quiz":
            res = _handle_quiz_intent(summary_task_id, result)
        elif decision.intent == "seek_player":
            res = _handle_seek_intent(result, question)
        else:
            res = _handle_chitchat_intent(question)

        ans = res.get("answer") or ""
        router_meta["total_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
        yield {"event": "delta", "delta": ans}
        yield {
            "event": "done",
            "answer": ans,
            "intent": decision.intent,
            "action": res.get("action"),
            "router": router_meta,
            "created_at": _now_time_str(),
        }
        return

    # LLM 流式生成分支 (translate 或 video_qa)
    if decision.intent == "translate":
        messages = _build_translate_messages(result, question, history)
        temp, max_tok = 0.2, 1500
    else:
        messages = _build_video_qa_messages(result, question, history, decision.needs_transcript)
        temp, max_tok = 0.3, 2048

    t_llm = time.perf_counter()
    ttft_ms = 0.0
    chunks: list[str] = []

    for delta in chat_stream(messages, temperature=temp, max_tokens=max_tok):
        if not ttft_ms:
            ttft_ms = round((time.perf_counter() - t_llm) * 1000, 1)
        chunks.append(delta)
        yield {"event": "delta", "delta": delta}

    llm_ms = round((time.perf_counter() - t_llm) * 1000, 1)
    total_ms = round((time.perf_counter() - t_start) * 1000, 1)
    router_meta["ttft_ms"] = ttft_ms or llm_ms
    router_meta["llm_ms"] = llm_ms
    router_meta["total_ms"] = total_ms
    full_answer = "".join(chunks).strip()

    yield {
        "event": "done",
        "answer": full_answer,
        "intent": decision.intent,
        "action": None,
        "router": router_meta,
        "created_at": _now_time_str(),
    }

