"""业务数据仓储层（PostgreSQL 16）：视频、研报分析、AI 测验与用户历史。"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional
import uuid

import psycopg
from psycopg.types.json import Jsonb

from db import db_cursor

logger = logging.getLogger(__name__)


def _serialize_dt(val: Any) -> str | None:
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


# ── 1. 视频管理 ──


def create_video(
    user_id: str | None,
    source_type: str,
    *,
    source_url: str | None = None,
    platform: str | None = None,
    title: str | None = None,
    original_filename: str | None = None,
    duration_sec: float | None = None,
    storage_status: str = "link_only",
    original_bytes: int | None = None,
    video_id: str | None = None,
) -> dict:
    vid = video_id or str(uuid.uuid4())
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO videos (
                id, user_id, source_type, source_url, platform, title,
                original_filename, duration_sec, storage_status, original_bytes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                vid,
                user_id,
                source_type,
                source_url,
                platform,
                title,
                original_filename,
                duration_sec,
                storage_status,
                original_bytes,
            ),
        )
        row = cur.fetchone()
    return dict(row)


def update_video(video_id: str, **kwargs) -> dict | None:
    if not kwargs:
        return get_video(video_id)
    fields = []
    values = []
    for k, v in kwargs.items():
        fields.append(f"{k} = %s")
        values.append(v)
    fields.append("updated_at = now()")
    values.append(video_id)

    sql = f"UPDATE videos SET {', '.join(fields)} WHERE id = %s RETURNING *"
    with db_cursor() as cur:
        cur.execute(sql, tuple(values))
        row = cur.fetchone()
    return dict(row) if row else None


def get_video(video_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM videos WHERE id = %s", (video_id,))
        row = cur.fetchone()
    return dict(row) if row else None


# ── 2. 研报分析管理 ──


def create_analysis(
    task_id: str,
    video_id: str,
    user_id: str | None,
    target_lang: str = "zh",
    prompt: str | None = None,
) -> dict:
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO analyses (id, video_id, user_id, status, target_lang, prompt)
            VALUES (%s, %s, %s, 'queued', %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                video_id = EXCLUDED.video_id,
                user_id = EXCLUDED.user_id,
                status = 'queued',
                target_lang = EXCLUDED.target_lang,
                prompt = EXCLUDED.prompt
            RETURNING *
            """,
            (task_id, video_id, user_id, target_lang, prompt),
        )
        row = cur.fetchone()
    return dict(row)


def update_analysis_status(task_id: str, status: str, **kwargs) -> None:
    fields = ["status = %s"]
    values = [status]
    for k, v in kwargs.items():
        if k in ("result", "timing"):
            fields.append(f"{k} = %s")
            values.append(Jsonb(v) if v is not None else None)
        else:
            fields.append(f"{k} = %s")
            values.append(v)
    values.append(task_id)

    sql = f"UPDATE analyses SET {', '.join(fields)} WHERE id = %s"
    try:
        with db_cursor() as cur:
            cur.execute(sql, tuple(values))
    except Exception as e:
        logger.error("更新分析状态异常 (task_id=%s): %s", task_id, e)


def finish_analysis(
    task_id: str,
    status: str = "done",
    result: dict | None = None,
    error: str | None = None,
    error_code: str | None = None,
    timing: dict | None = None,
) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE analyses
            SET status = %s,
                result = %s,
                error = %s,
                error_code = %s,
                timing = %s,
                finished_at = now()
            WHERE id = %s
            RETURNING video_id
            """,
            (
                status,
                Jsonb(result) if result else None,
                error,
                error_code,
                Jsonb(timing) if timing else None,
                task_id,
            ),
        )
        row = cur.fetchone()
        if row and result and status == "done":
            # 同步更新视频的 title 和 duration（若有）
            vid_title = result.get("title")
            duration = None
            raw_trans = result.get("transcript")
            if isinstance(raw_trans, list) and raw_trans:
                last_seg = raw_trans[-1]
                if isinstance(last_seg, dict) and "end" in last_seg:
                    duration = float(last_seg["end"])
            
            up_fields = []
            up_values = []
            if vid_title:
                up_fields.append("title = COALESCE(NULLIF(title, ''), %s)")
                up_values.append(vid_title)
            if duration:
                up_fields.append("duration_sec = COALESCE(duration_sec, %s)")
                up_values.append(duration)
            if up_fields:
                up_values.append(row["video_id"])
                cur.execute(
                    f"UPDATE videos SET {', '.join(up_fields)}, updated_at = now() WHERE id = %s",
                    tuple(up_values),
                )


def resolve_analysis_id_by_prefix(hex_prefix: str) -> str | None:
    """根据 8 位 hex 前缀查找完整 analysis_id（供 10 位极简短链 ?s= 解码定位）。"""
    clean = (hex_prefix or "").replace("-", "").strip().lower()
    if len(clean) < 6:
        return None
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT id FROM analyses
            WHERE replace(id::text, '-', '') LIKE %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (f"{clean}%",),
        )
        row = cur.fetchone()
    return str(row["id"]).replace("-", "") if row else None


def get_analysis_for_user(
    task_id: str,
    user_id: str | None = None,
    is_admin: bool = False,
    allow_public_read: bool = False,
) -> dict | None:
    with db_cursor() as cur:
        if is_admin or allow_public_read:
            cur.execute(
                """
                SELECT a.*, v.source_type, v.source_url, v.title as video_title,
                       v.platform, v.duration_sec, v.storage_status
                FROM analyses a
                JOIN videos v ON a.video_id = v.id
                WHERE a.id = %s
                """,
                (task_id,),
            )
        elif user_id:
            cur.execute(
                """
                SELECT a.*, v.source_type, v.source_url, v.title as video_title,
                       v.platform, v.duration_sec, v.storage_status
                FROM analyses a
                JOIN videos v ON a.video_id = v.id
                WHERE a.id = %s AND (a.user_id = %s OR v.user_id = %s)
                """,
                (task_id, user_id, user_id),
            )
        else:
            # 未登录访客只能读取无归属的游客分析记录，不能凭 task_id 翻看他人内容
            cur.execute(
                """
                SELECT a.*, v.source_type, v.source_url, v.title as video_title,
                       v.platform, v.duration_sec, v.storage_status
                FROM analyses a
                JOIN videos v ON a.video_id = v.id
                WHERE a.id = %s AND a.user_id IS NULL
                """,
                (task_id,),
            )
        row = cur.fetchone()
    if not row:
        return None
    res = dict(row)
    res["id"] = str(res["id"])
    res["video_id"] = str(res["video_id"])
    res["user_id"] = str(res["user_id"]) if res.get("user_id") else None
    res["created_at"] = _serialize_dt(res.get("created_at"))
    res["finished_at"] = _serialize_dt(res.get("finished_at"))
    return res


def append_analysis_chat(task_id: str, user_msg: dict, assistant_msg: dict) -> None:
    """将单轮问答对话追加持久化到 analyses.result.chat_history (JSONB)。"""
    new_msgs = [user_msg, assistant_msg]
    try:
        with db_cursor() as cur:
            cur.execute(
                """
                UPDATE analyses
                SET result = jsonb_set(
                    COALESCE(result, '{}'::jsonb),
                    '{chat_history}',
                    COALESCE(result->'chat_history', '[]'::jsonb) || %s::jsonb,
                    true
                )
                WHERE id = %s
                """,
                (Jsonb(new_msgs), task_id),
            )
    except Exception as e:
        logger.error("持久化问答记录异常 (task_id=%s): %s", task_id, e)


# ── 3. 用户专属视频与学习库 ──


def list_user_videos(
    user_id: str,
    page: int = 1,
    page_size: int = 20,
    q: str | None = None,
) -> dict:
    offset = (page - 1) * page_size
    conditions = ["v.user_id = %s"]
    params = [user_id]

    if q and q.strip():
        query_str = f"%{q.strip().lower()}%"
        conditions.append("(LOWER(COALESCE(v.title, '')) LIKE %s OR LOWER(COALESCE(v.source_url, '')) LIKE %s)")
        params.extend([query_str, query_str])

    where_clause = f"WHERE {' AND '.join(conditions)}"

    with db_cursor() as cur:
        cur.execute(f"SELECT COUNT(*) as total FROM videos v {where_clause}", tuple(params))
        total = cur.fetchone()["total"]

        sql = f"""
            SELECT v.id, v.source_type, v.source_url, v.platform, v.title,
                   v.original_filename, v.duration_sec, v.storage_status,
                   v.storage_bytes, v.created_at,
                   a.id as latest_analysis_id, a.status as latest_analysis_status,
                   a.result as analysis_result
            FROM videos v
            LEFT JOIN LATERAL (
                SELECT id, status, result FROM analyses
                WHERE video_id = v.id
                ORDER BY created_at DESC
                LIMIT 1
            ) a ON true
            {where_clause}
            ORDER BY v.created_at DESC
            LIMIT %s OFFSET %s
        """
        cur.execute(sql, tuple(params + [page_size, offset]))
        rows = cur.fetchall()

    items = []
    for r in rows:
        analysis_res = r.get("analysis_result") or {}
        quiz_obj = analysis_res.get("quiz")
        quiz_state_obj = analysis_res.get("quiz_state") or {}
        score_res = quiz_state_obj.get("score_result") or {}
        last_score = score_res.get("score") if isinstance(score_res, dict) else None
        items.append(
            {
                "id": str(r["id"]),
                "source_type": r["source_type"],
                "source_url": r.get("source_url"),
                "platform": r.get("platform"),
                "title": r.get("title") or analysis_res.get("title") or "未命名视频",
                "tldr": analysis_res.get("tldr"),
                "original_filename": r.get("original_filename"),
                "duration_sec": r.get("duration_sec"),
                "storage_status": r["storage_status"],
                "storage_bytes": r.get("storage_bytes") or 0,
                "latest_analysis_id": r.get("latest_analysis_id"),
                "latest_analysis_status": r.get("latest_analysis_status"),
                "quiz_count": 1 if quiz_obj else 0,
                "last_score": last_score,
                "created_at": _serialize_dt(r["created_at"]),
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def delete_user_video(video_id: str, user_id: str, is_admin: bool = False) -> str | None:
    """删除视频及级联分析，返回物理存储路径以便清理磁盘。"""
    with db_cursor() as cur:
        if is_admin:
            cur.execute("SELECT storage_path FROM videos WHERE id = %s", (video_id,))
        else:
            cur.execute("SELECT storage_path FROM videos WHERE id = %s AND user_id = %s", (video_id, user_id))
        row = cur.fetchone()
        if not row:
            return None
        storage_path = row.get("storage_path")
        cur.execute("DELETE FROM videos WHERE id = %s", (video_id,))
    return storage_path


# ── 4. AI 测验持久化 ──


def save_quiz(
    analysis_id: str,
    user_id: str | None,
    title: str,
    estimated_minutes: int,
    questions: list[dict],
    quiz_id: str | None = None,
) -> dict:
    qid = quiz_id or uuid.uuid4().hex
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO quizzes (id, analysis_id, user_id, title, estimated_minutes, questions)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                estimated_minutes = EXCLUDED.estimated_minutes,
                questions = EXCLUDED.questions
            RETURNING *
            """,
            (qid, analysis_id, user_id, title, estimated_minutes, Jsonb(questions)),
        )
        row = cur.fetchone()
    res = dict(row)
    res["id"] = str(res["id"])
    res["user_id"] = str(res["user_id"]) if res.get("user_id") else None
    return res


def get_quiz_by_id(quiz_id: str) -> dict | None:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM quizzes WHERE id = %s", (quiz_id,))
        row = cur.fetchone()
    if not row:
        return None
    res = dict(row)
    res["id"] = str(res["id"])
    res["user_id"] = str(res["user_id"]) if res.get("user_id") else None
    return res


def save_quiz_attempt(
    quiz_id: str,
    user_id: str,
    answers: list[dict],
    result: dict,
    score: float,
) -> dict:
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO quiz_attempts (quiz_id, user_id, answers, result, score)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (quiz_id, user_id, Jsonb(answers), Jsonb(result), score),
        )
        row = cur.fetchone()
    res = dict(row)
    res["id"] = str(res["id"])
    res["quiz_id"] = str(res["quiz_id"])
    res["user_id"] = str(res["user_id"])
    res["created_at"] = _serialize_dt(res["created_at"])
    return res


def save_analysis_quiz_data(
    task_id: str,
    quiz_data: dict | None = None,
    quiz_state: dict | None = None,
    reset_state: bool = False,
) -> None:
    """将测验题目 (quiz) 与作答进度/评测结果 (quiz_state) 持久化进 analyses.result JSONB。"""
    if not task_id:
        return
    try:
        with db_cursor() as cur:
            if quiz_data is not None:
                cur.execute(
                    """
                    UPDATE analyses
                    SET result = jsonb_set(
                        COALESCE(result, '{}'::jsonb),
                        '{quiz}',
                        %s::jsonb,
                        true
                    )
                    WHERE id = %s
                    """,
                    (Jsonb(quiz_data), task_id),
                )
            if reset_state:
                cur.execute(
                    """
                    UPDATE analyses
                    SET result = COALESCE(result, '{}'::jsonb) - 'quiz_state'
                    WHERE id = %s
                    """,
                    (task_id,),
                )
            elif quiz_state is not None:
                cur.execute(
                    """
                    UPDATE analyses
                    SET result = jsonb_set(
                        COALESCE(result, '{}'::jsonb),
                        '{quiz_state}',
                        %s::jsonb,
                        true
                    )
                    WHERE id = %s
                    """,
                    (Jsonb(quiz_state), task_id),
                )
    except Exception as e:
        logger.error("持久化测验数据至 analyses.result 异常 (task_id=%s): %s", task_id, e)


def get_latest_quiz_bundle_for_analysis(analysis_id: str) -> dict | None:
    """当 analyses.result 中尚未内嵌 quiz 时，从 quizzes 与 quiz_attempts 表回溯最近一次测验及作答结果。"""
    if not analysis_id:
        return None
    try:
        with db_cursor() as cur:
            cur.execute(
                """
                SELECT * FROM quizzes
                WHERE analysis_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (analysis_id,),
            )
            q_row = cur.fetchone()
            if not q_row:
                return None

            quiz_id = str(q_row["id"])
            questions = q_row.get("questions") or []
            quiz_payload = {
                "quiz_id": quiz_id,
                "summary_task_id": analysis_id,
                "title": q_row.get("title") or "AI 视频学习测验",
                "estimated_minutes": int(q_row.get("estimated_minutes") or 5),
                "question_count": len(questions),
                "questions": questions,
            }

            cur.execute(
                """
                SELECT * FROM quiz_attempts
                WHERE quiz_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (quiz_id,),
            )
            a_row = cur.fetchone()
            state_payload = None
            if a_row:
                raw_answers = a_row.get("answers") or []
                ans_map = {}
                rev_map = {}
                if isinstance(raw_answers, list):
                    for item in raw_answers:
                        if isinstance(item, dict) and item.get("question_id"):
                            qid = str(item["question_id"])
                            ans_map[qid] = item.get("answer")
                            rev_map[qid] = True
                for q in questions:
                    qid = str(q.get("id") or "")
                    if qid:
                        rev_map[qid] = True
                state_payload = {
                    "quiz_id": quiz_id,
                    "answers": ans_map,
                    "revealed": rev_map,
                    "current_index": 0,
                    "view_mode": "summary",
                    "score_result": a_row.get("result"),
                }

            return {"quiz": quiz_payload, "quiz_state": state_payload}
    except Exception as e:
        logger.warning("回溯历史测验记录失败 (analysis_id=%s): %s", analysis_id, e)
        return None
