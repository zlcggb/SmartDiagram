"""用户学习库与专属视频播放路由。"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from community_repo import video_has_community_playback_access
from media_token import sign_playback_token, verify_playback_token
from repo import delete_user_video, get_video, list_user_videos, save_video_cover
from session_auth import optional_user, require_user

router = APIRouter(tags=["library"])


class SaveCoverRequest(BaseModel):
    cover_url: str = Field(..., min_length=16, max_length=800000)
    video_id: Optional[str] = None
    analysis_id: Optional[str] = None
    post_id: Optional[str] = None


@router.post("/api/videos/cover")
def api_save_video_cover(
    req: SaveCoverRequest,
    _user: Optional[dict] = Depends(optional_user),
):
    """将播放器自动截取的视频封面图持久化到 videos 与 community_posts 表。"""
    saved = save_video_cover(
        cover_url=req.cover_url,
        video_id=req.video_id,
        analysis_id=req.analysis_id,
        post_id=req.post_id,
    )
    if not saved:
        return {"ok": False}
    return {"ok": True, **saved}


@router.get("/api/library/videos")
def api_list_my_videos(
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(require_user),
):
    """获取当前登录用户的视频库列表。"""
    return list_user_videos(user["id"], page=page, page_size=page_size, q=q)


@router.get("/api/library/videos/{video_id}")
def api_get_my_video_detail(video_id: str, user: dict = Depends(require_user)):
    """获取当前用户特定视频的详情与关联分析。"""
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")
    if str(video["user_id"]) != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权访问此视频记录")

    res = dict(video)
    res["id"] = str(res["id"])
    res["user_id"] = str(res["user_id"])
    res["created_at"] = res["created_at"].isoformat() if hasattr(res["created_at"], "isoformat") else str(res["created_at"])
    return res


@router.delete("/api/library/videos/{video_id}")
def api_delete_my_video(video_id: str, user: dict = Depends(require_user)):
    """删除当前用户视频及所有关联分析研报与测验，清理归档文件。"""
    storage_path = delete_user_video(video_id, user["id"], is_admin=user.get("role") == "admin")
    if storage_path is None:
        raise HTTPException(status_code=404, detail="视频不存在或无权删除")

    if storage_path and os.path.isfile(storage_path):
        try:
            os.remove(storage_path)
        except OSError:
            pass

    return {"ok": True, "message": "视频记录已成功删除"}


@router.get("/api/videos/{video_id}/playback")
def api_get_video_playback(video_id: str, user: dict = Depends(require_user)):
    """为登录用户签发 10 分钟有效的免 Header 播放直链。"""
    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")

    if (
        str(video["user_id"]) != user["id"]
        and user.get("role") != "admin"
        and not video_has_community_playback_access(video_id)
    ):
        raise HTTPException(status_code=403, detail="无权播放此视频")

    storage_status = video.get("storage_status")
    storage_path = video.get("storage_path")

    if storage_status != "ready" or not storage_path or not os.path.isfile(storage_path):
        return {
            "mode": "not_ready",
            "storage_status": storage_status,
            "message": "视频尚未归档或归档正在进行中",
        }

    token = sign_playback_token(video_id)
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


@router.get("/api/videos/{video_id}/stream")
def api_stream_video(video_id: str, token: str = Query(...)):
    """通过短效 HMAC 令牌直接流式读取物理归档文件，支持 Range 请求进度条拖拽。"""
    if not verify_playback_token(video_id, token):
        raise HTTPException(status_code=403, detail="播放令牌已失效或非法，请刷新页面重新获取")

    video = get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")

    storage_path = video.get("storage_path")
    if not storage_path or not os.path.isfile(storage_path):
        raise HTTPException(status_code=404, detail="视频归档文件已失效")

    filename = video.get("original_filename") or f"{video_id}.mp4"
    is_audio = storage_path.endswith(".m4a")
    media_type = "audio/mp4" if is_audio else "video/mp4"

    return FileResponse(storage_path, filename=filename, media_type=media_type)
