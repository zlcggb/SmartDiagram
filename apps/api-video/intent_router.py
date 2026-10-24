"""系统 1 毫秒级意图路由器 (基于开源 Jeff / GLiFormer 决策中枢 + 高置信度门控)。

设计原则（第一性原理）：
1. 在视频问答面板中，用户的默认核心诉求是「探讨/总结视频内容 (`video_qa`)」。
2. 功能性短路动作 (`download` / `make_quiz` / `seek_player` / `translate` / `chitchat`) 属于高代价拦截（会跳过大模型问答），
   必须经过「强特征先验」或「Jeff 高置信度门槛 (>=0.55) + 语义锚点校验」双重确认才可触发；
   任何模糊提问、预设引导词或低置信度判定，一律安全归入 `video_qa` 交由大模型结合视频内容作答。
3. Jeff 模型重点赋能 `needs_transcript`（是否需要检索万字长字幕细节），为宏观总结类问题省去长文直塞，大幅降低大模型 TTFT。
"""
from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("vidgrab.intent_router")

# 环境变量开关与超时控制
INTENT_ROUTER_ENABLED = os.environ.get("INTENT_ROUTER_ENABLED", "true").lower() in ("true", "1", "yes")
TYPESAFE_BASE_URL = os.environ.get("TYPESAFE_BASE_URL", "http://127.0.0.1:8001").rstrip("/")
TYPESAFE_API_KEY = os.environ.get("TYPESAFE_API_KEY", "devkey")
INTENT_ROUTER_TIMEOUT = float(os.environ.get("INTENT_ROUTER_TIMEOUT", "1.5"))

# 非 video_qa 功能性意图触发短路的最低概率与置信度门槛
ACTION_PROB_THRESHOLD = 0.55
ACTION_CONF_THRESHOLD = 0.45


@dataclass
class IntentDecision:
    """意图决策结果对象。"""
    intent: str  # video_qa, make_quiz, translate, download, seek_player, chitchat
    needs_transcript: bool  # 是否需要检索长转写稿
    complexity: int  # 1 ~ 5
    confidence: float = 1.0  # 置信度 (0.0 ~ 1.0)
    probabilities: dict[str, float] = field(default_factory=dict)  # 各意图分布
    latency_ms: float = 0.0  # 毫秒耗时
    fallback: bool = False  # 是否为静默降级结果
    reason: str = ""  # 判定理由或降级原因


INTENT_CHOICES = {
    "video_qa": "围绕视频内容提问、总结核心观点、提炼要点、解释概念或追问细节",
    "download": "下载视频文件、导出MP4或保存视频到本地",
    "make_quiz": "出几道考题、考考我、生成互动测验或随堂练习",
    "seek_player": "控制播放器跳转到指定分秒时间戳位置",
    "translate": "将内容翻译成英文、日文等其他外语",
    "chitchat": "纯打招呼问候（如你好、你是谁）且不含任何内容提问",
}

# 宏观总结词（回答此类问题无需额外塞入上万字逐句字幕，仅用研报+要点+章节即可极速秒回）
_MACRO_SUMMARY_KEYWORDS = (
    "核心观点",
    "值得记住的要点",
    "三句话概括",
    "主要内容",
    "总结一下",
    "概括一下",
    "关键点",
    "核心结论",
    "讲了什么",
    "讲的什么",
    "主旨",
    "大意",
    "脉络",
    "核心逻辑",
    "有哪些要点",
)

# 明确属于内容问答/总结的语义特征词（一旦命中且无明确功能指令，优先锁定为 video_qa）
_QA_SEMANTIC_PATTERNS = re.compile(
    r"(核心观点|要点|概括|总结|关键点|讲了什么|讲的什么|说的啥|什么意思|啥意思|"
    r"为什么|为何|怎么|如何|哪些|哪个|什么|是不是|能不能讲|分析|解读|拆解|提炼|"
    r"逻辑|方法|步骤|阶段|核心|结论|观点|建议|启发|案例|原因|区别|对比)"
)

# 各功能性意图的合法语义锚点（防止零样本模型将普通模糊提问误判为功能短路）
_TRANSLATE_ANCHOR = re.compile(
    r"(翻译|翻成|译成|译为|中译英|英译中|英文|英语|日文|日语|韩文|韩语|法语|法文|德语|德文|俄语|西语|外语|english|japanese|korean|translate)"
)
_SEEK_ANCHOR = re.compile(
    r"(跳到|跳转到|快进到|定位到|播放到|播放至|后退到|第\s*\d+\s*分钟|\b\d{1,2}:\d{2}\b)"
)
_QUIZ_ANCHOR = re.compile(
    r"(考考我|出几道题|出两道题|出题|生成测验|随堂测试|测试卷|出考题|做练习题|做个测验|quiz)"
)
_DOWNLOAD_ANCHOR = re.compile(
    r"(下载|导出\s*mp4|保存到本地|保存视频|下载直链|离线缓存|无水印视频)"
)
_CHITCHAT_ANCHOR = re.compile(
    r"^(你好|您好|hi|hello|hey|哈喽|嗨|早上好|下午好|晚上好|在吗|你是谁|你叫什么|有什么功能|你能做什么)[！!？?。，,\s]*$"
)


def _make_fallback_decision(
    reason: str,
    latency_ms: float = 0.0,
    default_intent: str = "video_qa",
) -> IntentDecision:
    """构建安全兜底降级决策。"""
    return IntentDecision(
        intent=default_intent,
        needs_transcript=True,
        complexity=3,
        confidence=1.0,
        probabilities={default_intent: 1.0},
        latency_ms=round(latency_ms, 2),
        fallback=True,
        reason=reason,
    )


def route_user_intent(query: str, history_context: str | None = None) -> IntentDecision:
    """毫秒级前置意图路由（规则先验 + Jeff 模型 + 高置信度安全门控）。"""
    clean_query = (query or "").strip()
    if not clean_query:
        return _make_fallback_decision("空输入", latency_ms=0.0, default_intent="chitchat")

    t0 = time.perf_counter()
    lower_q = clean_query.lower()

    # =========================================================================
    # 第一层：高确定性功能动词先验 (耗时 < 0.1ms，零网络开销)
    # =========================================================================

    # 1. 播放跳转明确指令
    if re.search(r"(跳到|跳转到|快进到|定位到|播放到|播放至|后退到)", lower_q):
        return IntentDecision(
            intent="seek_player",
            needs_transcript=False,
            complexity=1,
            confidence=0.99,
            probabilities={"seek_player": 1.0},
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
            fallback=False,
            reason="精准播放跳转先验",
        )

    # 2. 互动测验明确指令
    if _QUIZ_ANCHOR.search(lower_q):
        return IntentDecision(
            intent="make_quiz",
            needs_transcript=False,
            complexity=1,
            confidence=0.99,
            probabilities={"make_quiz": 1.0},
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
            fallback=False,
            reason="精准互动测验先验",
        )

    # 3. 语言翻译明确指令
    if re.search(r"(翻译|翻成|译成|译为|translate)", lower_q) and _TRANSLATE_ANCHOR.search(lower_q):
        return IntentDecision(
            intent="translate",
            needs_transcript=False,
            complexity=2,
            confidence=0.99,
            probabilities={"translate": 1.0},
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
            fallback=False,
            reason="精准翻译先验",
        )

    # 4. 视频下载明确指令
    if _DOWNLOAD_ANCHOR.search(lower_q):
        return IntentDecision(
            intent="download",
            needs_transcript=False,
            complexity=1,
            confidence=0.99,
            probabilities={"download": 1.0},
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
            fallback=False,
            reason="精准下载先验",
        )

    # 5. 纯日常问候先验（严格全句匹配，绝不误伤业务问题）
    if _CHITCHAT_ANCHOR.match(lower_q):
        return IntentDecision(
            intent="chitchat",
            needs_transcript=False,
            complexity=1,
            confidence=0.99,
            probabilities={"chitchat": 1.0},
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
            fallback=False,
            reason="日常问候极速先验",
        )

    # 6. 宏观总结与预设引导词极速先验（直接走 video_qa 且免塞万字长字幕，TTFT 极快）
    if any(k in lower_q for k in _MACRO_SUMMARY_KEYWORDS) and not (
        _TRANSLATE_ANCHOR.search(lower_q)
        or _DOWNLOAD_ANCHOR.search(lower_q)
        or _QUIZ_ANCHOR.search(lower_q)
    ):
        return IntentDecision(
            intent="video_qa",
            needs_transcript=False,
            complexity=2,
            confidence=0.98,
            probabilities={"video_qa": 0.98},
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
            fallback=False,
            reason="宏观总结先验 (轻量上下文加速)",
        )

    if not INTENT_ROUTER_ENABLED:
        return _make_fallback_decision(
            "意图路由开关未启用 (INTENT_ROUTER_ENABLED=false)",
            latency_ms=(time.perf_counter() - t0) * 1000,
        )

    # =========================================================================
    # 第二层：调用本地 Jeff (GLiFormer) 零样本分类 + 高置信度安全门控
    # =========================================================================
    try:
        from typesafe_sdk import Choice, Noul, RetryPolicy, TypeSafeClient

        client = TypeSafeClient(
            api_key=TYPESAFE_API_KEY,
            base_url=TYPESAFE_BASE_URL,
            timeout=INTENT_ROUTER_TIMEOUT,
            retry=RetryPolicy(max_retries=0),
        )

        state_input: Any = clean_query
        if history_context:
            state_input = f"[上文]: {history_context[:80]}\n[输入]: {clean_query}"

        questions = {
            "intent": Choice(
                instructions="判定用户在视频学习助手中的意图：",
                criteria=INTENT_CHOICES,
            ),
            "needs_transcript": Noul(
                instructions="回答该问题是否必须检索视频逐句字幕细节？",
            ),
        }

        resp = client.system_one(state_input, questions)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        intent_answer = resp.choices.get("intent")
        raw_intent = intent_answer.choice if intent_answer else "video_qa"
        confidence = float(getattr(intent_answer, "confidence", 1.0) or 1.0)
        probabilities = getattr(intent_answer, "probabilities", {}) or {}
        top_prob = float(probabilities.get(raw_intent, confidence) or 0.0)

        intent = raw_intent
        gate_reason = "Jeff 本地模型判定"

        # 安全门控：若模型判定为非 video_qa 的功能性短路意图，必须通过语义锚点与高置信度校验
        if intent != "video_qa":
            anchor_ok = False
            if intent == "translate":
                anchor_ok = bool(_TRANSLATE_ANCHOR.search(lower_q))
            elif intent == "seek_player":
                anchor_ok = bool(_SEEK_ANCHOR.search(lower_q))
            elif intent == "make_quiz":
                anchor_ok = bool(_QUIZ_ANCHOR.search(lower_q))
            elif intent == "download":
                anchor_ok = bool(_DOWNLOAD_ANCHOR.search(lower_q))
            elif intent == "chitchat":
                anchor_ok = bool(_CHITCHAT_ANCHOR.match(lower_q)) and not bool(_QA_SEMANTIC_PATTERNS.search(lower_q))

            if not anchor_ok or (top_prob < ACTION_PROB_THRESHOLD and confidence < ACTION_CONF_THRESHOLD):
                intent = "video_qa"
                gate_reason = f"Jeff+安全门控修正 ({raw_intent}->{intent})"

        # 解析 Noul (是否需要挂载长转写摘录)
        noul_answer = resp.nouls.get("needs_transcript")
        noul_prob = float(getattr(noul_answer, "noul", 0.5) or 0.5)
        if intent in ("download", "chitchat", "make_quiz"):
            needs_transcript = False
        elif any(k in lower_q for k in _MACRO_SUMMARY_KEYWORDS):
            needs_transcript = False
        else:
            # 细节问题默认挂载转写摘录，确保回答有据可依
            needs_transcript = True if noul_prob >= 0.35 else True

        complexity = 2 if not needs_transcript else 3

        return IntentDecision(
            intent=intent,
            needs_transcript=needs_transcript,
            complexity=complexity,
            confidence=round(max(confidence, float(probabilities.get(intent, 0.8))), 3),
            probabilities={k: round(v, 4) for k, v in probabilities.items()},
            latency_ms=round(elapsed_ms, 2),
            fallback=False,
            reason=gate_reason,
        )

    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.warning(
            "Jeff 意图路由异常 (耗时 %.1fms)，触发优雅降级 fallback -> video_qa: %s",
            elapsed_ms,
            exc,
        )
        return _make_fallback_decision(f"Jeff 服务降级: {exc}", latency_ms=elapsed_ms)
