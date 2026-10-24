"""AI 总结任务的内存任务表（独立于下载用的 tasks.py，遵循开闭原则，不改既有逻辑）。

状态流转：queued -> transcribing -> local_asr -> analyzing_frames -> summarizing -> done / error / cancelled
（local_asr：云端 ASR 不可用时的本地 Whisper；analyzing_frames 仅在弱旁白/音画融合时触发）
"""
import threading
import time


class SummaryCancelledError(Exception):
    """用户主动取消总结任务。"""


_tasks: dict[str, dict] = {}
_lock = threading.Lock()


def create_summary_task(
    task_id: str,
    target_lang: str = "zh",
    *,
    url: str | None = None,
    file_id: str | None = None,
    filename: str | None = None,
    source_type: str = "url",
    video_id: str | None = None,
) -> None:
    with _lock:
        _tasks[task_id] = {
            "task_id": task_id,
            "video_id": video_id or file_id,
            "source_type": source_type,
            "url": url,
            "file_id": file_id,
            "filename": filename,
            "target_lang": target_lang,
            "status": "queued",
            "stage": "queued",
            "percent": 0.0,
            "result": None,
            "error": None,
            "error_code": None,
            "cancel_requested": False,
            "created_at": time.time(),
            "partial_transcript": [],
            "timing": {
                "started_at": time.time(),
                "audio_prep_ms": 0,
                "asr_ms": 0,
                "llm_ms": 0,
                "total_ms": 0,
            },
        }


def update_summary_task(task_id: str, **kwargs) -> None:
    with _lock:
        if task_id in _tasks:
            _tasks[task_id].update(kwargs)


def get_summary_task(task_id: str):
    with _lock:
        t = _tasks.get(task_id)
        return dict(t) if t else None


def is_summary_cancelled(task_id: str) -> bool:
    with _lock:
        t = _tasks.get(task_id)
        return bool(t and t.get("cancel_requested"))


def request_summary_cancel(task_id: str) -> bool:
    with _lock:
        t = _tasks.get(task_id)
        if not t or t.get("kind") == "translate":
            return False
        if t["status"] in ("done", "error", "cancelled"):
            return False
        t["cancel_requested"] = True
        return True


def ensure_not_cancelled(task_id: str) -> None:
    if is_summary_cancelled(task_id):
        raise SummaryCancelledError()


# --- 逐句字幕翻译任务（复用同一张内存表，字段语义略有不同） ---


def create_translate_task(task_id: str, target_lang: str = "zh") -> None:
    with _lock:
        _tasks[task_id] = {
            "task_id": task_id,
            "kind": "translate",
            "target_lang": target_lang,
            "status": "queued",
            "stage": "translating",
            "percent": 0.0,
            "result": None,
            "error": None,
            "error_code": None,
            "created_at": time.time(),
        }
