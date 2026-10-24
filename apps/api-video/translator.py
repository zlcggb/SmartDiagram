"""逐句字幕翻译：把转写分段批量翻译为目标语言，与原文一一对齐（对照）。

设计：按字符数分块，每块以 JSON 数组送入 LLM，要求返回等长 JSON 数组，
再与原文 zip 回去。长度不一致时做截断/补空兜底，保证不串行错位。

新增文件，仅依赖 llm_client（OpenAI 兼容），不修改既有逻辑（开闭原则）。
"""
from llm_client import chat_json

# 每块累计字符上限（控制单次 token 量；逐句翻译比总结更敏感）
CHUNK_CHARS = 2400

LANG_NAMES = {
    "zh": "中文（简体）",
    "zh-Hant": "中文（繁体）",
    "en": "English",
    "ja": "日本語",
    "ko": "한국어",
}


def _lang_name(target_lang: str) -> str:
    return LANG_NAMES.get(target_lang, target_lang or "中文（简体）")


def _chunk_texts(texts: list) -> list:
    """按字符数把文本列表切块，返回 [(start_index, [text,...]), ...]。"""
    chunks = []
    cur = []
    cur_start = 0
    cur_len = 0
    for i, t in enumerate(texts):
        if cur and cur_len + len(t) > CHUNK_CHARS:
            chunks.append((cur_start, cur))
            cur = []
            cur_start = i
            cur_len = 0
        cur.append(t)
        cur_len += len(t) + 4
    if cur:
        chunks.append((cur_start, cur))
    return chunks


def _translate_chunk(texts: list, lang: str) -> list:
    import json

    messages = [
        {
            "role": "system",
            "content": (
                f"你是专业字幕翻译。把用户给的 JSON 字符串数组逐条翻译成{lang}，"
                "严格保持数组长度与顺序一致：第 i 条对应译第 i 条，不要合并、拆分、增删或添加解释。"
                '只输出 JSON：{"translations": ["译文1", "译文2", ...]}'
            ),
        },
        {
            "role": "user",
            "content": json.dumps(texts, ensure_ascii=False),
        },
    ]
    data = chat_json(messages, temperature=0.2, max_tokens=4096)
    trans = data.get("translations") if isinstance(data, dict) else None
    if not isinstance(trans, list):
        trans = []
    # 长度对齐：多截少补
    if len(trans) < len(texts):
        trans = trans + [""] * (len(texts) - len(trans))
    elif len(trans) > len(texts):
        trans = trans[: len(texts)]
    return [str(t) for t in trans]


def translate_segments(segments: list, target_lang: str = "zh", progress=None) -> list:
    """翻译转写分段，返回 [{start, time, text, translation}]。"""
    lang = _lang_name(target_lang)
    texts = [s["text"] for s in segments]
    translations = [""] * len(texts)

    chunks = _chunk_texts(texts)
    for idx, (start_index, chunk_texts) in enumerate(chunks, 1):
        result = _translate_chunk(chunk_texts, lang)
        for j, tr in enumerate(result):
            translations[start_index + j] = tr
        if progress:
            progress(int(100 * idx / max(len(chunks), 1)))

    out = []
    for seg, tr in zip(segments, translations):
        out.append(
            {
                "start": int(seg.get("start", 0)),
                "time": seg.get("time", ""),
                "text": seg["text"],
                "translation": tr,
            }
        )
    return out
