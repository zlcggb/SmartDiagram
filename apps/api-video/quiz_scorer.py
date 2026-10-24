"""AI 视频测验的确定性规则评分。"""
import re
from typing import Any


def _text(value: Any) -> str:
    value = "" if value is None else str(value)
    return re.sub(r"[\s，。！？；：、,.!?;:'\"“”‘’（）()\[\]]+", "", value).lower()


def _truth(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = _text(value)
    if normalized in {"true", "正确", "对", "是", "√"}:
        return True
    if normalized in {"false", "错误", "错", "否", "×", "x"}:
        return False
    return None


def _choice(value: Any, options: list[str]) -> str:
    if value is None:
        return ""
    raw = str(value).strip()
    normalized = _text(raw)
    if len(normalized) == 1 and "a" <= normalized <= "z":
        index = ord(normalized) - ord("a")
        if 0 <= index < len(options):
            return options[index]
    for option in options:
        if _text(option) == normalized:
            return option
    return raw


def _is_correct(question: dict, answer: Any) -> bool:
    question_type = question.get("type")
    options = question.get("options") or []
    expected = question.get("correct_answer")

    if question_type == "true_false":
        expected_truth = _truth(expected)
        return _truth(answer) is not None and _truth(answer) == expected_truth

    if question_type == "multiple_choice":
        provided = answer if isinstance(answer, list) else [answer]
        actual = {_text(_choice(item, options)) for item in provided if item is not None}
        wanted = {
            _text(_choice(item, options))
            for item in (expected if isinstance(expected, list) else [expected])
            if item is not None
        }
        return bool(actual) and actual == wanted

    if question_type == "single_choice":
        return _text(_choice(answer, options)) == _text(_choice(expected, options))

    accepted = question.get("accepted_answers") or [expected]
    actual = _text(answer)
    return bool(actual) and actual in {_text(item) for item in accepted if item is not None}


def score_quiz(quiz: dict, submitted_answers: list[dict]) -> dict:
    answer_map = {
        str(item.get("question_id") or item.get("id") or ""): item.get("answer")
        for item in submitted_answers
        if isinstance(item, dict)
    }
    questions = quiz.get("questions") or []
    total_points = sum(max(1, int(q.get("points") or 1)) for q in questions)
    earned_points = 0
    details = []

    for question in questions:
        question_id = question["id"]
        user_answer = answer_map.get(question_id)
        correct = _is_correct(question, user_answer)
        points = max(1, int(question.get("points") or 1))
        if correct:
            earned_points += points
        details.append(
            {
                "question_id": question_id,
                "correct": correct,
                "user_answer": user_answer,
                "correct_answer": question.get("correct_answer"),
                "accepted_answers": question.get("accepted_answers") or [],
                "explanation": question.get("explanation") or "",
                "reference_time": question.get("reference_time", 0),
                "reference_text": question.get("reference_text") or "",
                "points": points,
                "earned_points": points if correct else 0,
            }
        )

    score = round((earned_points / total_points) * 100) if total_points else 0
    return {
        "score": score,
        "earned_points": earned_points,
        "total_points": total_points,
        "correct_count": sum(1 for item in details if item["correct"]),
        "question_count": len(details),
        "details": details,
    }
