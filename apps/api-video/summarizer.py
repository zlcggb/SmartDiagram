"""AI 总结编排：转写 → (分块 map-reduce) → 双路并发（结构化脑图/章节 JSON + 流式深度研报 Markdown）。

输出语言由 target_lang 控制（实现「跨语言总结/翻译」：英文视频也能出中文总结）。
"""
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from llm_client import chat, chat_json, chat_stream
from summary_tasks import ensure_not_cancelled
from transcript import get_transcript, get_transcript_from_file

# 单次直接总结的转写字符上限；超过则走分块 map-reduce
MAX_CHARS_SINGLE = 16000
CHUNK_CHARS = 6500
SUMMARY_MAP_PARALLEL = max(1, int(os.environ.get("SUMMARY_MAP_PARALLEL", "4")))

LANG_NAMES = {
    "zh": "中文（简体）",
    "zh-Hant": "中文（繁体）",
    "en": "English",
    "ja": "日本語",
    "ko": "한국어",
}


def _lang_name(target_lang: str) -> str:
    return LANG_NAMES.get(target_lang, target_lang or "中文（简体）")


def _fmt_ts(seconds: float) -> str:
    s = int(seconds or 0)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


def _parse_ts(text: str) -> int:
    """把 "mm:ss" / "hh:mm:ss" 解析为秒。"""
    if isinstance(text, (int, float)):
        return int(text)
    if not text:
        return 0
    parts = str(text).strip().split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return 0
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    return nums[0] if nums else 0


def _segments_to_text(segments: list) -> str:
    return "\n".join(f"[{_fmt_ts(s['start'])}] {s['text']}" for s in segments)


def _chunk_segments(segments: list) -> list:
    """按累计字符数把分段切块，保留时间戳。"""
    chunks = []
    cur = []
    cur_len = 0
    for seg in segments:
        line_len = len(seg["text"]) + 8
        if cur and cur_len + line_len > CHUNK_CHARS:
            chunks.append(cur)
            cur = []
            cur_len = 0
        cur.append(seg)
        cur_len += line_len
    if cur:
        chunks.append(cur)
    return chunks


def _map_chunk(text: str, lang: str, idx: int, total: int, *, source: str = "asr") -> str:
    """对单个分块产出带时间戳的要点笔记（map 阶段）。"""
    if source == "vision":
        hint = (
            f"你是专业的视频内容分析助手。请用{lang}对下面这段**画面描述**（第 {idx}/{total} 段，"
            "该视频几乎无旁白，每行以 [时间戳] 开头）提炼要点：场景、动作、主体、可见文字等，"
            "保留关键时间戳，输出简洁分点笔记，不要寒暄。"
        )
    elif source == "multimodal":
        hint = (
            f"你是专业的视频内容分析助手。请用{lang}对下面这段**语音转写与【画面】标记的画面描述**"
            f"（第 {idx}/{total} 段，每行以 [时间戳] 开头）提炼要点，区分旁白与画面信息，"
            "保留关键时间戳，输出简洁分点笔记，不要寒暄。"
        )
    else:
        hint = (
            f"你是专业的视频内容分析助手。请用{lang}对下面这段视频转写（第 {idx}/{total} 段，"
            "每行以 [时间戳] 开头）提炼要点，保留关键时间戳，输出简洁的分点笔记，不要寒暄。"
        )
    messages = [
        {"role": "system", "content": hint},
        {"role": "user", "content": text},
    ]
    return chat(messages, temperature=0.2, max_tokens=2048)


# 快路 Schema：仅包含结构化元数据、章节与思维导图（不含长文 summary，体积小、无引号转义风险，8~12s 极速返回）
_META_SCHEMA = (
    '{\n'
    '  "title": "视频核心主题标题（精炼有力）",\n'
    '  "tldr": "核心破局点 / 核心结论（150-250字高密度精炼，点明本质逻辑与颠覆性洞见）",\n'
    '  "key_points": [\n'
    '    "【维度一·底层认知】深度剖析核心观点与认知跃迁...",\n'
    '    "【维度二·架构体系】系统论述框架设计与选型哲学...",\n'
    '    "【维度三·工程实战】阐述关键落地路径与攻防细节..."\n'
    '  ],\n'
    '  "actionable_takeaways": [\n'
    '    "行动项1：针对核心诉求的可落地方案与实施步骤",\n'
    '    "行动项2：高频踩坑点与防御预案"\n'
    '  ],\n'
    '  "chapters": [\n'
    '    {"time": "mm:ss", "title": "章节标题", "summary": "本章节的核心要点阐释与关键洞察"}\n'
    '  ],\n'
    '  "mindmap": "# 完整知识体系树\\n## 一、核心破局\\n- 要点1\\n- 要点2\\n## 二、方法论全景\\n- 要点1"\n'
    '}'
)


def _normalize_result(data: dict) -> dict:
    chapters = []
    for ch in data.get("chapters") or []:
        if not isinstance(ch, dict):
            continue
        chapters.append(
            {
                "time": ch.get("time") or _fmt_ts(_parse_ts(ch.get("time"))),
                "seconds": _parse_ts(ch.get("time")),
                "title": (ch.get("title") or "").strip(),
                "summary": (ch.get("summary") or "").strip(),
            }
        )
    chapters.sort(key=lambda c: c["seconds"])
    key_points = [
        str(p).strip() for p in (data.get("key_points") or []) if str(p).strip()
    ]
    actionable_takeaways = [
        str(a).strip()
        for a in (data.get("actionable_takeaways") or [])
        if str(a).strip()
    ]
    return {
        "title": (data.get("title") or "").strip(),
        "tldr": (data.get("tldr") or "").strip(),
        "summary": (data.get("summary") or "").strip(),
        "key_points": key_points,
        "actionable_takeaways": actionable_takeaways,
        "chapters": chapters,
        "mindmap": (data.get("mindmap") or "").strip(),
    }


_STYLE_REPORT_SPECS: dict[str, dict[str, str]] = {
    "deep_report": {
        "label": "智库深度研报",
        "persona": "你是顶级商业智库与技术战略架构师。请深入剖析所提供的视频素材",
        "guidelines": (
            "1. 结构清晰，包含以下核心板块（可根据视频主题灵活命名二级标题）：\n"
            "   - `## 一、现状痛点与认知破局`\n"
            "   - `## 二、核心方法论与体系全景拆解`\n"
            "   - `## 三、实战演练与关键细节剖析`\n"
            "   - `## 四、深层洞见与终局思考`\n"
            "2. 深度剖析底层逻辑、方法论与因果链条，善用 `**加粗**`、要点列表与标准 Markdown 对比表格，篇幅充实（800-2200字）；\n"
        ),
    },
    "executive_brief": {
        "label": "极简高管速读",
        "persona": "你是麦肯锡首席顾问与高管简报专家。请以「结论先行（BLUF）+ 极高信息密度」的方式提炼视频精华",
        "guidelines": (
            "1. 采用 3 分钟电梯汇报结构，包含以下板块：\n"
            "   - `## 一、一句话核心结论与战略价值`\n"
            "   - `## 二、五大黄金法则与核心洞察（高密度清单）`\n"
            "   - `## 三、关键数据 / 方案对比速查表`\n"
            "   - `## 四、立即执行的 3 个关键动作`\n"
            "2. 拒绝冗长铺垫，每一条都用「**核心短语**：一针见血解释」呈现，并提炼原视频最具启发性的金句（500-1100字）；\n"
        ),
    },
    "tutorial_sop": {
        "label": "教程实操手册",
        "persona": "你是资深实战工程师与 SOP 流程架构师。请将视频内容转化为一份可直接照着落地执行的「标准作业程序（SOP）与避坑手册」",
        "guidelines": (
            "1. 严格按实操落地顺序组织章节：\n"
            "   - `## 一、前置条件、核心概念与环境准备`\n"
            "   - `## 二、分步实操指南（Step-by-Step SOP）`\n"
            "   - `## 三、关键参数、公式或指令速查表`\n"
            "   - `## 四、高频踩坑点与故障排查清单（Checklist）`\n"
            "2. 每个操作步骤都需写清「做什么 → 怎么做 → 预期效果/验收标准」，最大化实操复用价值（800-2000字）；\n"
        ),
    },
    "critical_review": {
        "label": "批判性深度思辨",
        "persona": "你是独立学者与第一性原理思想家。请对视频内容进行「解构式、思辨式、跨学科」的深度审视",
        "guidelines": (
            "1. 按认知深度递进组织章节：\n"
            "   - `## 一、核心命题重构与论证链条拆解`\n"
            "   - `## 二、隐含前提假设与适用边界审视`\n"
            "   - `## 三、正反视角碰撞与潜在盲区剖析`\n"
            "   - `## 四、第一性原理推演与跨领域迁移启发`\n"
            "2. 不仅总结作者说了什么，更要指出其成立的前提条件、局限性以及更高维度的认知启发（800-2000字）；\n"
        ),
    },
}


def _final_summary(
    content: str,
    lang: str,
    is_notes: bool,
    *,
    source: str = "asr",
    report_style: str = "deep_report",
    custom_prompt: str | None = None,
    on_partial=None,
) -> dict:
    """双路并发生成：
    - 快路（_task_meta）：生成结构化 JSON（title, tldr, key_points, actionable_takeaways, chapters, mindmap）
    - 流式路（_task_report）：按所选风格流式生成深度研报长文 Markdown（summary），实时回调 on_partial
    """
    if source == "vision":
        src_desc = "下面是从视频各场景抽取的画面描述（该视频几乎无旁白/字幕）"
    elif source == "multimodal":
        src_desc = "下面是视频的语音转写与【画面】标记的画面描述（音画融合）"
    elif is_notes:
        src_desc = "下面是从视频各段提炼的要点笔记"
    else:
        src_desc = "下面是视频的带时间戳逐字转写"

    style_key = report_style if report_style in _STYLE_REPORT_SPECS else "deep_report"
    style_spec = _STYLE_REPORT_SPECS[style_key]

    extra = ""
    if source in ("vision", "multimodal"):
        extra = "若素材以画面描述为主，请侧重场景、动作与视觉信息；"
    if custom_prompt and custom_prompt.strip():
        extra += f"\n用户特别关注与定制要求：{custom_prompt.strip()}；"

    state_lock = threading.Lock()
    shared_state: dict = {
        "title": "",
        "tldr": "",
        "summary": "",
        "key_points": [],
        "actionable_takeaways": [],
        "chapters": [],
        "mindmap": "",
        "report_style": style_key,
    }

    def _emit_partial(pct: float, msg: str):
        if not on_partial:
            return
        with state_lock:
            snapshot = dict(shared_state)
        try:
            on_partial(pct, msg, snapshot)
        except Exception:
            pass

    def _task_meta() -> dict:
        messages = [
            {
                "role": "system",
                "content": (
                    f"{style_spec['persona']}，用{lang}输出严格 JSON（不要代码块围栏，直接输出合法 JSON）。\n\n"
                    f"数据格式严格遵循：\n{_META_SCHEMA}\n\n"
                    f"核心质量标准（当前风格：【{style_spec['label']}】）：\n"
                    f"1. tldr 必须契合【{style_spec['label']}】定位，一针见血点明本质逻辑与核心结论（150-250字）；\n"
                    f"2. key_points 需包含 6-10 条带维度标签的深度要点；\n"
                    f"3. actionable_takeaways 提供 3-6 条即学即用的落地行动步骤；\n"
                    f"4. chapters 必须按时间先后提取真实时间戳（mm:ss），给出高质量章节小结；\n"
                    f"5. mindmap 必须是层级清晰、多维展开的 Markdown 标题/列表语法（# 根节点 / ## 一级分支 / ### 二级分支 / - 叶子节点）。\n"
                    f"{extra}"
                ),
            },
            {"role": "user", "content": f"{src_desc}：\n\n{content}"},
        ]
        raw = chat_json(messages, temperature=0.35, max_tokens=4096)
        norm = _normalize_result(raw)
        with state_lock:
            shared_state["title"] = norm["title"]
            shared_state["tldr"] = norm["tldr"]
            shared_state["key_points"] = norm["key_points"]
            shared_state["actionable_takeaways"] = norm["actionable_takeaways"]
            shared_state["chapters"] = norm["chapters"]
            shared_state["mindmap"] = norm["mindmap"]
        _emit_partial(78, f"核心结论、章节与思维导图已就绪，正在流式输出【{style_spec['label']}】…")
        return norm

    def _task_report() -> str:
        messages = [
            {
                "role": "system",
                "content": (
                    f"{style_spec['persona']}，用{lang}直接撰写一篇**【{style_spec['label']}】风格的结构化分析长文**（纯 Markdown 格式，不要输出 JSON 外层包裹）。\n\n"
                    f"写作与排版规范：\n"
                    f"{style_spec['guidelines']}"
                    f"3. 在阐述核心递进流程或架构模型时，可使用如下围栏流程语法（前端会自动渲染为横向可视化流程卡片）：\n"
                    f"   ```\n"
                    f"   [阶段一：核心动作] -> [阶段二：关键突破] -> [阶段三：终局闭环]\n"
                    f"   (核心目标或心智定位) (核心目标或心智定位) (核心目标或心智定位)\n"
                    f"   ```\n"
                    f"4. 在引述视频关键观点或案例时，请附带原视频对应的时间戳标记（格式如 `[01:23]` 或 `[03:15]`），方便读者点击跳转回看；\n"
                    f"5. 直接从第一个 `## ` 二级标题开始输出正文，不要任何寒暄或前言。{extra}"
                ),
            },
            {"role": "user", "content": f"{src_desc}：\n\n{content}"},
        ]
        chunks: list[str] = []
        last_emit = time.monotonic()
        try:
            for delta in chat_stream(messages, temperature=0.4, max_tokens=6144):
                chunks.append(delta)
                now = time.monotonic()
                if now - last_emit >= 0.35:
                    text_so_far = "".join(chunks).strip()
                    with state_lock:
                        shared_state["summary"] = text_so_far
                    pct = min(96, 60 + int(len(text_so_far) / 45))
                    _emit_partial(pct, f"AI 正在实时流式撰写【{style_spec['label']}】…")
                    last_emit = now
        except Exception:
            if not chunks:
                fallback_text = chat(messages, temperature=0.4, max_tokens=6144)
                chunks.append(fallback_text)

        final_report = "".join(chunks).strip()
        with state_lock:
            shared_state["summary"] = final_report
        return final_report

    with ThreadPoolExecutor(max_workers=2) as pool:
        fut_meta = pool.submit(_task_meta)
        fut_report = pool.submit(_task_report)
        meta_res = fut_meta.result()
        report_res = fut_report.result()

    meta_res["summary"] = report_res
    meta_res["report_style"] = style_key
    return meta_res


def summarize_from_segments(
    segments: list,
    source: str,
    work_id: str,
    target_lang: str = "zh",
    progress=None,
    *,
    report_style: str = "deep_report",
    custom_prompt: str | None = None,
) -> dict:
    """转写结果 → 双路并发结构化总结（链接与上传共用后半段，支持基于已有字幕直接按新风格秒级重生）。"""
    lang = _lang_name(target_lang)
    style_key = report_style if report_style in _STYLE_REPORT_SPECS else "deep_report"
    style_label = _STYLE_REPORT_SPECS[style_key]["label"]
    formatted_transcript = [
        {"start": int(s["start"]), "time": _fmt_ts(s["start"]), "text": s["text"]}
        for s in segments
    ]

    def _p(stage: str, percent: float | None = None, stage_message: str | None = None, **kwargs):
        ensure_not_cancelled(work_id)
        if progress:
            progress(stage, percent, stage_message, **kwargs)

    # 转写完成瞬间，立即把完整字幕随 partial_result 推送给前端
    _p(
        "summarizing",
        55,
        f"字幕已就绪，正在并发生成思维导图与【{style_label}】…",
        partial_result={
            "title": "",
            "tldr": "",
            "summary": "",
            "key_points": [],
            "actionable_takeaways": [],
            "chapters": [],
            "mindmap": "",
            "report_style": style_key,
            "transcript_source": source,
            "target_lang": target_lang,
            "segment_count": len(segments),
            "transcript": formatted_transcript,
        },
    )
    full_text = _segments_to_text(segments)

    def _on_partial(pct: float, msg: str, snapshot: dict):
        snapshot["transcript_source"] = source
        snapshot["target_lang"] = target_lang
        snapshot["segment_count"] = len(segments)
        snapshot["transcript"] = formatted_transcript
        snapshot["report_style"] = style_key
        _p("summarizing", pct, msg, partial_result=snapshot)

    if len(full_text) <= MAX_CHARS_SINGLE:
        result = _final_summary(
            full_text,
            lang,
            is_notes=False,
            source=source,
            report_style=style_key,
            custom_prompt=custom_prompt,
            on_partial=_on_partial,
        )
    else:
        chunks = _chunk_segments(segments)
        notes_by_idx: dict[int, str] = {}

        def _map_one(item: tuple[int, list]) -> tuple[int, str]:
            i, chunk = item
            return i, _map_chunk(
                _segments_to_text(chunk), lang, i, len(chunks), source=source
            )

        workers = min(SUMMARY_MAP_PARALLEL, len(chunks))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_map_one, (i, chunk)): i
                for i, chunk in enumerate(chunks, 1)
            }
            done = 0
            for fut in as_completed(futures):
                i, note = fut.result()
                notes_by_idx[i] = note
                done += 1
                _p("summarizing", 55 + int(20 * done / max(len(chunks), 1)))

        notes = [notes_by_idx[i] for i in range(1, len(chunks) + 1)]
        result = _final_summary(
            "\n\n".join(notes),
            lang,
            is_notes=True,
            source=source,
            report_style=style_key,
            custom_prompt=custom_prompt,
            on_partial=_on_partial,
        )

    result["transcript_source"] = source
    result["target_lang"] = target_lang
    result["segment_count"] = len(segments)
    result["transcript"] = formatted_transcript
    result["report_style"] = style_key
    _p("done", 100)
    return result


def summarize(
    url: str,
    browser: str | None,
    work_id: str,
    target_lang: str = "zh",
    progress=None,
    prompt: str | None = None,
    report_style: str = "deep_report",
) -> dict:
    """完整管线：转写 → 总结。progress(stage, percent) 为可选回调。"""

    def _p(stage: str, percent: float | None = None, stage_message: str | None = None, **kwargs):
        ensure_not_cancelled(work_id)
        if progress:
            progress(stage, percent, stage_message, **kwargs)

    _p("transcribing", 8)
    tr = get_transcript(url, browser, work_id, progress=_p, prompt=prompt)
    return summarize_from_segments(
        tr["segments"],
        tr["source"],
        work_id,
        target_lang,
        progress,
        report_style=report_style,
        custom_prompt=prompt,
    )


def summarize_upload(
    file_path: str,
    work_id: str,
    target_lang: str = "zh",
    progress=None,
    filename: str = "",
    prompt: str | None = None,
    report_style: str = "deep_report",
) -> dict:
    """本地上传：文件转写 → 总结。"""

    def _p(stage: str, percent: float | None = None, stage_message: str | None = None, **kwargs):
        ensure_not_cancelled(work_id)
        if progress:
            progress(stage, percent, stage_message, **kwargs)

    _p("transcribing", 8)
    tr = get_transcript_from_file(
        file_path, work_id, progress=_p, filename=filename, prompt=prompt
    )
    result = summarize_from_segments(
        tr["segments"],
        tr["source"],
        work_id,
        target_lang,
        progress,
        report_style=report_style,
        custom_prompt=prompt,
    )
    result["source_type"] = "upload"
    if filename:
        result["filename"] = filename
    return result
