"""文档中心后端路由：安全读取 docs/ 下的 Markdown 文档。
支持全英文语义化文档 ID（Slug）路由映射，避免在 URL 中暴露中文文件名或 .md 后缀。
遵循安全规范，防路径穿越，只允许读取受控目录下的 .md 文件。
"""
import hashlib
import os
import re
from typing import Dict, Tuple
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/docs", tags=["docs"])


def _resolve_docs_dir() -> str:
    candidates = [
        os.environ.get("VIDEO_DOCS_DIR", "").strip(),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "docs", "video")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "docs")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "docs")),
    ]
    for candidate in candidates:
        if candidate and os.path.isdir(candidate):
            return candidate
    return candidates[1]


DOCS_DIR = _resolve_docs_dir()

# 结构化目录定义（每个文档分配唯一的全英文语义化 ID）
CATEGORIES = [
    {
        "id": "arch",
        "title": "🏛️ 核心架构与系统设计",
        "items": [
            {"id": "product-overview", "file": "产品发布会说明书与架构全景.md", "title": "🌟 产品全景与发布会说明书"},
            {"id": "system-architecture", "file": "系统架构与技术全景.md", "title": "系统全栈架构深度白皮书"},
            {"id": "system-design", "file": "方案设计.md", "title": "系统方案与数据契约设计"},
            {"id": "requirements-sla", "file": "需求分析.md", "title": "产品需求与 SLA 规格说明"},
        ],
    },
    {
        "id": "changelog",
        "title": "🚀 版本演进与性能优化",
        "items": [
            {"id": "performance-evolution", "file": "优化记录与技术演进.md", "title": "性能优化与技术演进白皮书"},
            {"id": "ai-quiz-architecture", "file": "AI智能测验与双源出题架构.md", "title": "AI 智能测验与双源出题架构"},
            {"id": "concurrent-pipeline", "file": "四点并发与极速总结管线.md", "title": "四点并发与极速总结管线"},
            {"id": "engineering-log", "file": "执行记录.md", "title": "工程迭代与排坑实录"},
        ],
    },
    {
        "id": "ai",
        "title": "👁️ AI 引擎与多模态解析",
        "items": [
            {"id": "ai-visual-coach", "file": "AI视觉分析教练与端云协同架构.md", "title": "🎯 AI 视觉分析教练与端云协同架构"},
            {"id": "jeff-intent-router", "file": "Jeff毫秒级意图路由引擎.md", "title": "Jeff 毫秒级意图路由引擎"},
            {"id": "multimodal-summary", "file": "无旁白视频多模态总结方案.md", "title": "无旁白视频多模态总结方案"},
            {"id": "streaming-playback", "file": "播放能力调研与方案.md", "title": "跨平台流媒体播放能力矩阵"},
            {"id": "hevc-transcoding", "file": "HEVC转码与跨平台兼容方案.md", "title": "HEVC 转码与跨平台兼容方案"},
            {"id": "multi-platform-strategy", "file": "多平台统一策略.md", "title": "八大平台统一解析与下载策略"},
        ],
    },
    {
        "id": "ops",
        "title": "🚢 部署与生产运维指南",
        "items": [
            {"id": "docker-deployment", "file": "Docker内部部署.md", "title": "Docker 容器化构建与编排"},
            {"id": "aliyun-ecs-guide", "file": "阿里云ECS部署指南.md", "title": "阿里云 ECS 生产部署指南"},
            {"id": "baota-https-deploy", "file": "宝塔域名HTTPS与GitHub自动部署.md", "title": "宝塔 HTTPS 与自动化部署"},
            {"id": "baota-reverse-proxy", "file": "宝塔面板部署指南.md", "title": "宝塔面板反向代理配置指南"},
            {"id": "platform-ops-guide", "file": "平台接入与运维指南.md", "title": "多平台接入与反爬限频运维"},
        ],
    },
    {
        "id": "billing",
        "title": "🗄️ 数据存储与商业化体系",
        "items": [
            {"id": "postgres-storage", "file": "PostgreSQL持久化与双写存储架构.md", "title": "PostgreSQL 16 双写存储架构"},
            {"id": "stripe-billing-design", "file": "会员支付-Stripe方案设计.md", "title": "Stripe 会员与三级配额架构"},
            {"id": "stripe-sandbox-guide", "file": "会员支付-开发与验收指南.md", "title": "商业化沙箱联调与验收指南"},
        ],
    },
]

_HIDDEN_DOCS = {
    "readme.md",
    "每周学习安排-视频学习助手与部署实践.md",
    "每周学习报告-视频学习助手.md",
    "部署教程文档优化记录.md",
    "2026-08-07-洲明视频学习助手与ai测验.md",
    "2026-06-25-稳定性与总结加速迭代.md",
    "存储方案-sqlite本地账号.md",
    "系统1决策模型-jeff本地部署与毫秒级意图路由.md",
    "ai总结-无旁白视频优化方案.md",
    "tiktok-hevc下载与兼容方案.md",
    "手机竖屏宣传片-制作交接.md",
}

DEFAULT_DOC_ID = "product-overview"


def _fallback_doc_id(filename: str) -> str:
    """为未预设分类的额外 .md 文档生成稳定的纯英文短 ID。"""
    stem = os.path.splitext(filename)[0].lower()
    ascii_part = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    digest = hashlib.md5(filename.encode("utf-8")).hexdigest()[:6]
    return f"{ascii_part}-{digest}" if ascii_part else f"doc-{digest}"


def _build_doc_maps() -> Tuple[Dict[str, str], Dict[str, str]]:
    """构建 id -> filename 与 filename_lower -> id 双向映射表。"""
    id_to_file: Dict[str, str] = {}
    file_to_id: Dict[str, str] = {}
    for cat in CATEGORIES:
        for item in cat.get("items", []):
            doc_id = item["id"]
            fname = item["file"]
            id_to_file[doc_id] = fname
            file_to_id[fname.lower()] = doc_id
            file_to_id[os.path.splitext(fname)[0].lower()] = doc_id

    if os.path.isdir(DOCS_DIR):
        for fname in sorted(os.listdir(DOCS_DIR)):
            if not fname.endswith(".md"):
                continue
            if fname.lower() in _HIDDEN_DOCS or fname.endswith(".example.md"):
                continue
            if fname.lower() not in file_to_id:
                doc_id = _fallback_doc_id(fname)
                id_to_file[doc_id] = fname
                file_to_id[fname.lower()] = doc_id
                file_to_id[os.path.splitext(fname)[0].lower()] = doc_id

    return id_to_file, file_to_id


@router.get("/list")
def api_docs_list():
    """返回文档目录树与分组元数据，所有条目统一使用纯英文语义化 ID 作为路由标识。"""
    id_to_file, file_to_id = _build_doc_maps()
    categorized_files = {
        item["file"].lower()
        for cat in CATEGORIES
        for item in cat.get("items", [])
    }

    categories_result = []
    for cat in CATEGORIES:
        categories_result.append({
            "id": cat["id"],
            "title": cat["title"],
            "items": [
                {
                    "id": item["id"],
                    "path": item["id"],
                    "title": item["title"],
                }
                for item in cat.get("items", [])
            ],
        })

    uncategorized_items = []
    if os.path.isdir(DOCS_DIR):
        for fname in sorted(os.listdir(DOCS_DIR)):
            if not fname.endswith(".md"):
                continue
            if fname.lower() in _HIDDEN_DOCS or fname.endswith(".example.md"):
                continue
            if fname.lower() not in categorized_files:
                doc_id = file_to_id.get(fname.lower()) or _fallback_doc_id(fname)
                title = os.path.splitext(fname)[0]
                uncategorized_items.append({
                    "id": doc_id,
                    "path": doc_id,
                    "title": title,
                })

    if uncategorized_items:
        categories_result.append({
            "id": "more",
            "title": "📚 更多技术沉淀与指南",
            "items": uncategorized_items,
        })

    return {"categories": categories_result, "default_doc": DEFAULT_DOC_ID}


@router.get("/content")
def api_docs_content(path: str = Query(..., description="文档英文 ID（如 product-overview）或兼容旧版文件名")):
    """安全读取单个 Markdown 文档内容，同时兼容英文 ID 与旧版中文 .md 路径。"""
    id_to_file, file_to_id = _build_doc_maps()

    raw_key = path.strip().lstrip("/")
    if raw_key.startswith("docs/video/"):
        raw_key = raw_key[len("docs/video/"):]
    elif raw_key.startswith("docs/"):
        raw_key = raw_key[len("docs/"):]

    # 1. 优先匹配纯英文文档 ID
    resolved_id = raw_key.lower()
    if resolved_id.endswith(".md"):
        resolved_id = resolved_id[:-3]

    if resolved_id in id_to_file:
        clean_file = id_to_file[resolved_id]
        canonical_id = resolved_id
    elif raw_key.lower() in file_to_id:
        canonical_id = file_to_id[raw_key.lower()]
        clean_file = id_to_file[canonical_id]
    else:
        clean_file = raw_key if raw_key.endswith(".md") else f"{raw_key}.md"
        canonical_id = file_to_id.get(clean_file.lower(), resolved_id)

    # 防路径穿越 (Path Traversal) 检查
    target_abs = os.path.abspath(os.path.join(DOCS_DIR, clean_file))
    if not target_abs.startswith(DOCS_DIR):
        raise HTTPException(status_code=403, detail="非法访问路径")

    if not os.path.isfile(target_abs):
        if clean_file.lower() in ("readme.md", "docs/readme.md"):
            readme_path = os.path.join(DOCS_DIR, "README.md")
            if os.path.isfile(readme_path):
                target_abs = readme_path
            else:
                raise HTTPException(status_code=404, detail="文档未找到")
        else:
            raise HTTPException(status_code=404, detail=f"文档不存在: {raw_key}")

    try:
        with open(target_abs, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        # 尝试提取第一个 # 一级标题作为 Title
        title = os.path.splitext(os.path.basename(clean_file))[0]
        match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if match:
            title = match.group(1).strip()

        mtime = None
        try:
            mtime = os.path.getmtime(target_abs)
        except OSError:
            mtime = None

        return {
            "id": canonical_id,
            "title": title,
            "path": canonical_id,
            "filename": canonical_id,
            "modified_at": mtime,
            "content": content,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取文档失败: {e}") from e

