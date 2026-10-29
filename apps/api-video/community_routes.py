"""学习社区 API（须登录）。"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from community_moderation import CommentRejected, count_recent_comments_by_user, validate_comment_body
from community_profile import get_public_profile, get_user_activity
from community_repo import (
    POST_VISIBLE,
    add_comment,
    count_recent_reports_by_user,
    create_comment_report,
    get_analysis_for_community_post,
    get_comment_by_id,
    get_post_by_id,
    get_post_by_video_id,
    list_comment_reports_admin,
    list_comments,
    list_favorites_for_user,
    list_posts_admin,
    list_posts_by_author,
    list_posts_feed,
    publish_post,
    resolve_comment_report,
    sync_post_to_latest_analysis,
    toggle_favorite,
    toggle_like,
    viewer_flags,
    withdraw_post,
)
from media_token import sign_playback_token
from repo import get_latest_quiz_bundle_for_analysis, get_video
from session_auth import require_admin, require_user

router = APIRouter(tags=["community"])

_PUBLISH_CONFIRM_TEXT = (
    "本人确认该内容适合在公司内网学习社区展示，不含未对外披露的客户、财务、未发布产品等信息；"
    "本地上传内容已获内部传播授权。"
)


class PublishRequest(BaseModel):
    analysis_id: str = Field(..., min_length=4, max_length=128)
    confirm: bool = True


class CommentCreateRequest(BaseModel):
    body: str = Field(..., min_length=2, max_length=500)


class CommentReportRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class CommentReportResolveRequest(BaseModel):
    action: str = Field(..., pattern="^(hide|dismiss)$")
    admin_note: Optional[str] = Field(default=None, max_length=1000)


def _summary_payload_from_row(record: dict) -> dict:
    res = record.get("result") or {}
    if isinstance(res, dict):
        res = dict(res)
        # 社区只读展示时：回填测验题目但剥离原作者个人答题进度（让访客获得干净沙盒试卷）
        analysis_id = str(record.get("analysis_id") or record.get("id") or "")
        if not res.get("quiz") and analysis_id:
            try:
                bundle = get_latest_quiz_bundle_for_analysis(analysis_id)
                if bundle and bundle.get("quiz"):
                    res["quiz"] = bundle["quiz"]
            except Exception:
                pass
        res.pop("quiz_state", None)
    return {
        "task_id": str(record.get("analysis_id") or record.get("id") or ""),
        "status": record["status"],
        "stage": "done" if record["status"] == "done" else record["status"],
        "percent": 100.0 if record["status"] == "done" else 0.0,
        "stage_message": None,
        "result": res,
        "error": record.get("error"),
        "error_code": record.get("error_code"),
        "partial_transcript": (res.get("transcript") if isinstance(res, dict) else None) or [],
        "timing": record.get("timing") or {},
        "video_id": str(record.get("video_id") or ""),
        "video_title": record.get("video_title") or "",
        "webpage_url": record.get("source_url") or "",
        "source_type": record.get("source_type"),
        "duration": record.get("duration_sec"),
        "cover_url": record.get("cover_url") or "",
    }


@router.get("/api/community/posts")
def api_community_feed(
    sort: str = Query("new", pattern="^(new|hot)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    user: dict = Depends(require_user),
):
    return list_posts_feed(sort=sort, page=page, page_size=page_size, viewer_id=user["id"])


@router.get("/api/community/posts/mine")
def api_community_mine(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    user: dict = Depends(require_user),
):
    return list_posts_by_author(user["id"], page=page, page_size=page_size, viewer_id=user["id"])


@router.get("/api/community/favorites")
def api_community_favorites(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    user: dict = Depends(require_user),
):
    return list_favorites_for_user(user["id"], page=page, page_size=page_size)


@router.get("/api/community/posts/by-analysis/{analysis_id}")
def api_community_post_by_analysis(analysis_id: str, user: dict = Depends(require_user)):
    from db import db_cursor

    with db_cursor() as cur:
        cur.execute(
            "SELECT video_id FROM analyses WHERE id = %s AND user_id = %s::uuid",
            (analysis_id, str(user["id"])),
        )
        row = cur.fetchone()
    if not row:
        return {"post": None}
    post = get_post_by_video_id(str(row["video_id"]))
    return {"post": post}


@router.get("/api/community/users/me")
def api_community_user_me(user: dict = Depends(require_user)):
    profile = get_public_profile(
        user["id"],
        user["id"],
        is_admin=user.get("role") == "admin",
    )
    if not profile:
        raise HTTPException(status_code=404, detail="用户不存在")
    return profile


@router.get("/api/community/users/{user_id}")
def api_community_user_profile(user_id: str, user: dict = Depends(require_user)):
    profile = get_public_profile(
        user_id,
        user["id"],
        is_admin=user.get("role") == "admin",
    )
    if not profile:
        raise HTTPException(status_code=404, detail="用户不存在或不可用")
    return profile


@router.get("/api/community/users/{user_id}/posts")
def api_community_user_posts(
    user_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    user: dict = Depends(require_user),
):
    row = get_public_profile(user_id, user["id"], is_admin=user.get("role") == "admin")
    if not row:
        raise HTTPException(status_code=404, detail="用户不存在或不可用")
    return list_posts_by_author(
        user_id,
        page=page,
        page_size=page_size,
        public_only=True,
        viewer_id=user["id"],
    )


@router.get("/api/community/users/{user_id}/activity")
def api_community_user_activity(
    user_id: str,
    weeks: int = Query(52, ge=1, le=52),
    user: dict = Depends(require_user),
):
    profile = get_public_profile(
        user_id,
        user["id"],
        is_admin=user.get("role") == "admin",
    )
    if not profile:
        raise HTTPException(status_code=404, detail="用户不存在或不可用")
    return get_user_activity(user_id, weeks=weeks)


@router.get("/api/community/posts/{post_id}")
def api_community_post_detail(post_id: str, user: dict = Depends(require_user)):
    post = get_post_by_id(post_id, viewer_id=user["id"])
    if not post:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if (
        post["status"] == "withdrawn"
        and str(post["author_id"]) != str(user["id"])
        and user.get("role") != "admin"
    ):
        raise HTTPException(status_code=404, detail="帖子不存在或已撤回")
    flags = viewer_flags(post_id, user["id"])
    post.update(flags)
    post["is_author"] = str(post["author_id"]) == str(user["id"])
    return post


@router.get("/api/community/posts/{post_id}/summary")
def api_community_post_summary(post_id: str, user: dict = Depends(require_user)):
    post = get_post_by_id(post_id)
    if not post:
        raise HTTPException(status_code=404, detail="帖子不存在")
    no_store = {"Cache-Control": "no-store"}
    if post["status"] == "withdrawn":
        raise HTTPException(
            status_code=404,
            detail={"code": "withdrawn", "message": "作者已撤回该内容"},
            headers=no_store,
        )
    if post["status"] == "invalid":
        raise HTTPException(
            status_code=404,
            detail={"code": "invalid", "message": "内容已失效"},
            headers=no_store,
        )
    row = get_analysis_for_community_post(post_id)
    if not row or row.get("invalid"):
        raise HTTPException(
            status_code=404,
            detail={"code": "invalid", "message": "内容已失效"},
            headers=no_store,
        )
    if row.get("withdrawn"):
        raise HTTPException(
            status_code=404,
            detail={"code": "withdrawn", "message": "作者已撤回该内容"},
            headers=no_store,
        )
    if not row.get("analysis_id"):
        raise HTTPException(
            status_code=404,
            detail={"code": "invalid", "message": "内容已失效"},
            headers=no_store,
        )
    payload = _summary_payload_from_row(row)
    payload["post_status"] = post["status"]
    payload["post_id"] = post_id
    return payload


@router.get("/api/community/posts/{post_id}/playback")
def api_community_playback(post_id: str, user: dict = Depends(require_user)):
    post = get_post_by_id(post_id)
    if not post or post["status"] not in POST_VISIBLE:
        raise HTTPException(status_code=404, detail="无法播放")
    video_id = post.get("video_id")
    if not video_id:
        raise HTTPException(status_code=404, detail="视频已不可用")
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")

    storage_status = video.get("storage_status")
    storage_path = video.get("storage_path")
    if storage_status != "ready" or not storage_path or not os.path.isfile(storage_path):
        return {
            "mode": "not_ready",
            "storage_status": storage_status,
            "message": "视频尚未归档或归档正在进行中",
        }
    token = sign_playback_token(str(video_id))
    is_audio = storage_path.endswith(".m4a")
    media_type = "audio/mp4" if is_audio else "video/mp4"
    return {
        "mode": "audio" if is_audio else "video",
        "stream_type": "progressive",
        "storage_status": "ready",
        "src": f"/api/videos/{video_id}/stream?token={token}",
        "mime": media_type,
        "expires_in": 600,
    }


@router.post("/api/community/posts")
def api_community_publish(req: PublishRequest, user: dict = Depends(require_user)):
    if not req.confirm:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "confirm_required",
                "message": "请确认合规声明后再发布",
                "confirm_text": _PUBLISH_CONFIRM_TEXT,
            },
        )
    try:
        post = publish_post(author_id=user["id"], analysis_id=req.analysis_id.strip())
    except ValueError as e:
        code = str(e)
        if code == "not_found":
            raise HTTPException(status_code=404, detail="分析不存在") from e
        if code == "forbidden":
            raise HTTPException(status_code=403, detail="无权发布该分析") from e
        if code == "not_done":
            raise HTTPException(status_code=400, detail="请等待总结完成后再发布") from e
        raise
    return {"ok": True, "post": post, "message": "已发布到学习社区"}


@router.delete("/api/community/posts/{post_id}")
def api_community_withdraw(post_id: str, user: dict = Depends(require_user)):
    ok = withdraw_post(post_id, user["id"], is_admin=user.get("role") == "admin")
    if not ok:
        raise HTTPException(status_code=404, detail="帖子不存在或无权操作")
    return {"ok": True, "message": "已从社区下架"}


@router.patch("/api/community/posts/{post_id}/sync")
@router.post("/api/community/posts/{post_id}/sync")
def api_community_sync(post_id: str, user: dict = Depends(require_user)):
    post = sync_post_to_latest_analysis(post_id, user["id"])
    if not post:
        raise HTTPException(status_code=404, detail="无法同步，请确认您为作者且存在最新总结")
    return {"ok": True, "post": post, "message": "社区展示已更新为最新总结"}


@router.post("/api/community/posts/{post_id}/like")
def api_community_like(post_id: str, user: dict = Depends(require_user)):
    try:
        return toggle_like(post_id, user["id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail="帖子不可点赞") from e


@router.post("/api/community/posts/{post_id}/favorite")
def api_community_favorite(post_id: str, user: dict = Depends(require_user)):
    try:
        return toggle_favorite(post_id, user["id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail="帖子不可收藏") from e


@router.get("/api/community/posts/{post_id}/comments")
def api_community_list_comments(
    post_id: str,
    limit: int = Query(100, ge=1, le=200),
    user: dict = Depends(require_user),
):
    post = get_post_by_id(post_id)
    if not post or post["status"] not in POST_VISIBLE:
        raise HTTPException(status_code=404, detail="帖子不存在")
    return {"items": list_comments(post_id, limit=limit, viewer_id=user["id"])}


@router.post("/api/community/posts/{post_id}/comments")
def api_community_add_comment(
    post_id: str,
    req: CommentCreateRequest,
    user: dict = Depends(require_user),
):
    if count_recent_comments_by_user(user["id"], 60) >= 8:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "评论过于频繁，请稍后再试"},
        )
    try:
        body = validate_comment_body(req.body)
    except CommentRejected as e:
        raise HTTPException(
            status_code=422,
            detail={"code": e.code, "message": e.message},
        ) from e
    try:
        item = add_comment(post_id, user["id"], body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail="当前帖子不可评论") from e
    return {"ok": True, "item": item}


@router.post("/api/community/comments/{comment_id}/report")
def api_report_comment(
    comment_id: str,
    req: CommentReportRequest,
    user: dict = Depends(require_user),
):
    if count_recent_reports_by_user(user["id"], 300) >= 10:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "举报过于频繁，请稍后再试"},
        )
    comment = get_comment_by_id(comment_id)
    if not comment or comment.get("status") != "visible":
        raise HTTPException(status_code=404, detail="评论不存在或已不可见")
    if comment.get("post_status") not in POST_VISIBLE:
        raise HTTPException(status_code=404, detail="帖子不可举报评论")
    if str(comment["user_id"]) == str(user["id"]):
        raise HTTPException(status_code=400, detail="不能举报自己的评论")
    item = create_comment_report(comment_id, user["id"], req.reason)
    return {"ok": True, "item": item, "message": "举报已提交，管理员会尽快处理"}


@router.get("/api/admin/community/posts")
def api_admin_community_posts(
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    status: Optional[str] = None,
    _admin: dict = Depends(require_admin),
):
    if status and status not in ("published", "withdrawn", "invalid", "outdated"):
        status = None
    return list_posts_admin(page=page, page_size=page_size, status=status)


@router.patch("/api/admin/community/posts/{post_id}/withdraw")
@router.post("/api/admin/community/posts/{post_id}/withdraw")
def api_admin_community_withdraw(post_id: str, admin: dict = Depends(require_admin)):
    ok = withdraw_post(post_id, admin["id"], is_admin=True)
    if not ok:
        raise HTTPException(status_code=404, detail="帖子不存在")
    return {"ok": True}


@router.patch("/api/admin/community/comments/{comment_id}/hide")
@router.post("/api/admin/community/comments/{comment_id}/hide")
def api_admin_hide_comment(comment_id: str, _admin: dict = Depends(require_admin)):
    from community_repo import hide_comment

    if not hide_comment(comment_id):
        raise HTTPException(status_code=404, detail="评论不存在")
    return {"ok": True}


@router.get("/api/admin/community/comment-reports")
def api_admin_comment_reports(
    status: str = Query("open"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    _admin: dict = Depends(require_admin),
):
    if status not in ("open", "reviewed", "dismissed", ""):
        status = "open"
    return list_comment_reports_admin(
        status=status or None,
        page=page,
        page_size=page_size,
    )


@router.patch("/api/admin/community/comment-reports/{report_id}")
@router.post("/api/admin/community/comment-reports/{report_id}")
def api_admin_resolve_comment_report(
    report_id: int,
    req: CommentReportResolveRequest,
    _admin: dict = Depends(require_admin),
):
    if not resolve_comment_report(report_id, req.action, req.admin_note):
        raise HTTPException(status_code=404, detail="举报不存在或已处理")
    return {"ok": True}
