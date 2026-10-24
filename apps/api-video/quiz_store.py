"""AI 测验的进程内暂存。

MVP 不持久化试卷与成绩；标准答案仅保存在服务端，生成接口不会下发。
"""
import threading
import time
import uuid


QUIZ_TTL_SECONDS = 2 * 60 * 60

_lock = threading.Lock()
_quizzes: dict[str, dict] = {}


def _cleanup_locked(now: float) -> None:
    expired = [
        quiz_id
        for quiz_id, quiz in _quizzes.items()
        if now - float(quiz.get("created_at") or 0) > QUIZ_TTL_SECONDS
    ]
    for quiz_id in expired:
        _quizzes.pop(quiz_id, None)


def create_quiz(
    summary_task_id: str,
    questions: list[dict],
    *,
    title: str = "视频学习测验",
    estimated_minutes: int = 15,
    quiz_id: str | None = None,
) -> dict:
    now = time.time()
    qid = quiz_id or uuid.uuid4().hex
    quiz = {
        "quiz_id": qid,
        "summary_task_id": summary_task_id,
        "title": title,
        "estimated_minutes": estimated_minutes,
        "questions": questions,
        "created_at": now,
    }
    with _lock:
        _cleanup_locked(now)
        _quizzes[quiz["quiz_id"]] = quiz
    return quiz



def get_quiz(quiz_id: str) -> dict | None:
    now = time.time()
    with _lock:
        _cleanup_locked(now)
        quiz = _quizzes.get(quiz_id)
        return dict(quiz) if quiz else None


def public_quiz(quiz: dict) -> dict:
    """下发结构化测验卡片数据（包含即时判题所需的答案、解析、维度与视频时间戳依据）。"""
    questions = []
    for question in quiz.get("questions") or []:
        questions.append(
            {
                "id": question["id"],
                "type": question["type"],
                "dimension": question.get("dimension") or "",
                "stem": question["stem"],
                "options": list(question.get("options") or []),
                "correct_answer": question.get("correct_answer"),
                "accepted_answers": list(question.get("accepted_answers") or []),
                "explanation": question.get("explanation") or "",
                "reference_time": question.get("reference_time", 0),
                "reference_text": question.get("reference_text") or "",
                "points": question.get("points", 1),
            }
        )
    return {
        "quiz_id": quiz["quiz_id"],
        "title": quiz.get("title") or "视频学习测验",
        "estimated_minutes": quiz.get("estimated_minutes") or max(3, round(len(questions) * 0.8)),
        "question_count": len(questions),
        "questions": questions,
    }
