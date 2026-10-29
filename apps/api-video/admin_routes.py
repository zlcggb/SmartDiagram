"""管理员管理路由（RBAC 鉴权：require_admin）。"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from auth_service import AuthError, get_user_by_id, hash_password, register_user
from db import db_cursor
from session_auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


class CreateUserRequest(BaseModel):
    email: str
    password: str
    role: Optional[str] = "user"
    display_name: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return (v or "").strip().lower()

    @field_validator("role")
    @classmethod
    def _role(cls, v: str | None) -> str:
        r = (v or "user").strip().lower()
        if r not in ("user", "admin"):
            raise ValueError("角色只能为 user 或 admin")
        return r


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None
    display_name: Optional[str] = None
    new_password: Optional[str] = None


@router.get("/stats")
def admin_stats(admin: dict = Depends(require_admin)):
    with db_cursor() as cur:
        # 用户统计
        cur.execute("SELECT COUNT(*) as total_users FROM users")
        total_users = cur.fetchone()["total_users"]

        cur.execute("SELECT COUNT(*) as admin_users FROM users WHERE role = 'admin'")
        admin_users = cur.fetchone()["admin_users"]

        # 视频统计
        cur.execute("SELECT COUNT(*) as total_videos FROM videos")
        total_videos = cur.fetchone()["total_videos"]

        cur.execute("SELECT COUNT(*) as url_videos FROM videos WHERE source_type = 'url'")
        url_videos = cur.fetchone()["url_videos"]

        cur.execute("SELECT COUNT(*) as upload_videos FROM videos WHERE source_type = 'upload'")
        upload_videos = cur.fetchone()["upload_videos"]

        # 归档占用存储
        cur.execute("SELECT COALESCE(SUM(storage_bytes), 0) as total_storage_bytes FROM videos")
        total_storage_bytes = int(cur.fetchone()["total_storage_bytes"] or 0)

        # 分析任务统计
        cur.execute("SELECT COUNT(*) as total_analyses FROM analyses")
        total_analyses = int(cur.fetchone()["total_analyses"] or 0)

        cur.execute("SELECT COUNT(*) as success_analyses FROM analyses WHERE status = 'done'")
        success_analyses = int(cur.fetchone()["success_analyses"] or 0)

    max_gb = float(os.environ.get("VIDEO_STORAGE_MAX_GB", "50"))
    used_gb = float(round(total_storage_bytes / (1024 * 1024 * 1024), 2))

    return {
        "users": {
            "total": total_users,
            "admin": admin_users,
            "regular": total_users - admin_users,
        },
        "videos": {
            "total": total_videos,
            "url_count": url_videos,
            "upload_count": upload_videos,
        },
        "analyses": {
            "total": total_analyses,
            "completed": success_analyses,
        },
        "storage": {
            "used_bytes": total_storage_bytes,
            "used_gb": used_gb,
            "max_gb": max_gb,
            "percent": round((used_gb / max_gb * 100) if max_gb > 0 else 0, 1),
        },
    }


@router.get("/users")
def admin_list_users(
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_admin),
):
    offset = (page - 1) * page_size
    query_str = f"%{q.strip().lower()}%" if q and q.strip() else None

    with db_cursor() as cur:
        if query_str:
            cur.execute(
                """
                SELECT COUNT(*) as total FROM users
                WHERE LOWER(email) LIKE %s OR LOWER(COALESCE(display_name, '')) LIKE %s
                """,
                (query_str, query_str),
            )
            total = cur.fetchone()["total"]

            cur.execute(
                """
                SELECT u.id, u.email, u.role, u.status, u.display_name, u.created_at, u.last_login_at,
                       COUNT(v.id) as video_count
                FROM users u
                LEFT JOIN videos v ON u.id = v.user_id
                WHERE LOWER(u.email) LIKE %s OR LOWER(COALESCE(u.display_name, '')) LIKE %s
                GROUP BY u.id
                ORDER BY u.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (query_str, query_str, page_size, offset),
            )
        else:
            cur.execute("SELECT COUNT(*) as total FROM users")
            total = cur.fetchone()["total"]

            cur.execute(
                """
                SELECT u.id, u.email, u.role, u.status, u.display_name, u.created_at, u.last_login_at,
                       COUNT(v.id) as video_count
                FROM users u
                LEFT JOIN videos v ON u.id = v.user_id
                GROUP BY u.id
                ORDER BY u.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (page_size, offset),
            )

        rows = cur.fetchall()

    users = []
    for r in rows:
        users.append(
            {
                "id": str(r["id"]),
                "email": r["email"],
                "role": r["role"],
                "status": r["status"],
                "display_name": r.get("display_name"),
                "video_count": r.get("video_count", 0),
                "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
                "last_login_at": (
                    r["last_login_at"].isoformat()
                    if r.get("last_login_at") and hasattr(r["last_login_at"], "isoformat")
                    else (str(r["last_login_at"]) if r.get("last_login_at") else None)
                ),
            }
        )

    return {
        "items": users,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/users")
def admin_create_user(body: CreateUserRequest, admin: dict = Depends(require_admin)):
    try:
        user = register_user(
            email=body.email,
            password=body.password,
            role=body.role or "user",
            display_name=body.display_name,
            enforce_domain_check=False,  # 管理员创建不受域名限制
        )
        return user
    except AuthError as e:
        raise HTTPException(status_code=400, detail={"code": "user_error", "message": str(e)}) from e


@router.patch("/users/{user_id}")
def admin_update_user(user_id: str, body: UpdateUserRequest, admin: dict = Depends(require_admin)):
    target = get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="目标用户不存在")

    # 安全防御：管理员不可将自己降权或禁用
    if target["id"] == admin["id"]:
        if body.role and body.role != "admin":
            raise HTTPException(status_code=400, detail="不能降低当前登录管理员自己的权限")
        if body.status and body.status != "active":
            raise HTTPException(status_code=400, detail="不能禁用当前登录管理员自己的账号")

    updates = []
    params = []

    if body.role:
        if body.role not in ("user", "admin"):
            raise HTTPException(status_code=400, detail="无效的角色取值")
        updates.append("role = %s")
        params.append(body.role)

    if body.status:
        if body.status not in ("active", "disabled"):
            raise HTTPException(status_code=400, detail="无效的状态取值")
        updates.append("status = %s")
        params.append(body.status)

    if body.display_name is not None:
        updates.append("display_name = %s")
        params.append(body.display_name.strip() or None)

    if body.new_password:
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="新密码至少 6 位")
        updates.append("password_hash = %s")
        params.append(hash_password(body.new_password))

    if updates:
        updates.append("updated_at = now()")
        params.append(user_id)
        sql = f"UPDATE users SET {', '.join(updates)} WHERE id = %s"
        with db_cursor() as cur:
            cur.execute(sql, tuple(params))

    return get_user_by_id(user_id)


@router.get("/videos")
def admin_list_videos(
    user_id: Optional[str] = None,
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_admin),
):
    offset = (page - 1) * page_size
    conditions = []
    params = []

    if user_id and user_id.strip():
        conditions.append("v.user_id = %s")
        params.append(user_id.strip())

    if q and q.strip():
        query_str = f"%{q.strip().lower()}%"
        conditions.append("(LOWER(COALESCE(v.title, '')) LIKE %s OR LOWER(COALESCE(v.source_url, '')) LIKE %s OR LOWER(u.email) LIKE %s)")
        params.extend([query_str, query_str, query_str])

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with db_cursor() as cur:
        count_sql = f"""
            SELECT COUNT(*) as total
            FROM videos v
            JOIN users u ON v.user_id = u.id
            {where_clause}
        """
        cur.execute(count_sql, tuple(params))
        total = cur.fetchone()["total"]

        list_sql = f"""
            SELECT v.id, v.user_id, u.email as user_email, u.display_name as user_name,
                   v.source_type, v.source_url, v.platform, v.title, v.duration_sec,
                   v.storage_status, v.storage_bytes, v.created_at,
                   a.id as latest_analysis_id, a.status as latest_analysis_status
            FROM videos v
            JOIN users u ON v.user_id = u.id
            LEFT JOIN LATERAL (
                SELECT id, status FROM analyses WHERE video_id = v.id ORDER BY created_at DESC LIMIT 1
            ) a ON true
            {where_clause}
            ORDER BY v.created_at DESC
            LIMIT %s OFFSET %s
        """
        cur.execute(list_sql, tuple(params + [page_size, offset]))
        rows = cur.fetchall()

    items = []
    for r in rows:
        items.append(
            {
                "id": str(r["id"]),
                "user_id": str(r["user_id"]),
                "user_email": r["user_email"],
                "user_name": r.get("user_name"),
                "source_type": r["source_type"],
                "source_url": r.get("source_url"),
                "platform": r.get("platform"),
                "title": r.get("title") or "未命名视频",
                "duration_sec": r.get("duration_sec"),
                "storage_status": r["storage_status"],
                "storage_bytes": r.get("storage_bytes") or 0,
                "latest_analysis_id": r.get("latest_analysis_id"),
                "latest_analysis_status": r.get("latest_analysis_status"),
                "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.delete("/videos/{video_id}")
def admin_delete_video(video_id: str, admin: dict = Depends(require_admin)):
    from community_repo import mark_posts_invalid_for_video

    with db_cursor() as cur:
        cur.execute("SELECT storage_path FROM videos WHERE id = %s", (video_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="视频记录不存在")

    try:
        mark_posts_invalid_for_video(video_id)
    except Exception:
        pass

    with db_cursor() as cur:
        # 级联删除数据库记录
        cur.execute("DELETE FROM videos WHERE id = %s", (video_id,))

    # 清理归档物理文件
    path = row.get("storage_path")
    if path and os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass

    return {"ok": True, "message": "视频记录与分析已删除"}
