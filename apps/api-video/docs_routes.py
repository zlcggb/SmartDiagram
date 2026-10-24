"""文档中心后端路由：安全读取 docs/ 下的 Markdown 文档。
遵循安全规范，防路径穿越，只允许读取 .md 文件。
"""
import os
import re
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/docs", tags=["docs"])

_PRIMARY_DOCS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "docs", "video"))
_FALLBACK_DOCS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "docs"))
DOCS_DIR = _PRIMARY_DOCS_DIR if os.path.isdir(_PRIMARY_DOCS_DIR) else _FALLBACK_DOCS_DIR

# 结构化目录定义
CATEGORIES = [
    {
        "id": "arch",
        "title": "🏛️ 核心架构与系统设计",
        "items": [
            {"path": "产品发布会说明书与架构全景.md", "title": "🌟 产品全景与发布会说明书"},
            {"path": "系统架构与技术全景.md", "title": "系统全栈架构深度白皮书"},
            {"path": "方案设计.md", "title": "系统方案与数据契约设计"},
            {"path": "需求分析.md", "title": "产品需求与 SLA 规格说明"},
        ],
    },
    {
        "id": "changelog",
        "title": "🚀 版本演进与性能优化",
        "items": [
            {"path": "优化记录与技术演进.md", "title": "性能优化与技术演进白皮书"},
            {"path": "AI智能测验与双源出题架构.md", "title": "AI 智能测验与双源出题架构"},
            {"path": "四点并发与极速总结管线.md", "title": "四点并发与极速总结管线"},
            {"path": "执行记录.md", "title": "工程迭代与排坑实录"},
        ],
    },
    {
        "id": "ai",
        "title": "👁️ AI 引擎与多模态解析",
        "items": [
            {"path": "Jeff毫秒级意图路由引擎.md", "title": "Jeff 毫秒级意图路由引擎"},
            {"path": "无旁白视频多模态总结方案.md", "title": "无旁白视频多模态总结方案"},
            {"path": "播放能力调研与方案.md", "title": "跨平台流媒体播放能力矩阵"},
            {"path": "HEVC转码与跨平台兼容方案.md", "title": "HEVC 转码与跨平台兼容方案"},
            {"path": "多平台统一策略.md", "title": "八大平台统一解析与下载策略"},
        ],
    },
    {
        "id": "ops",
        "title": "🚢 部署与生产运维指南",
        "items": [
            {"path": "Docker内部部署.md", "title": "Docker 容器化构建与编排"},
            {"path": "阿里云ECS部署指南.md", "title": "阿里云 ECS 生产部署指南"},
            {"path": "宝塔域名HTTPS与GitHub自动部署.md", "title": "宝塔 HTTPS 与自动化部署"},
            {"path": "宝塔面板部署指南.md", "title": "宝塔面板反向代理配置指南"},
            {"path": "平台接入与运维指南.md", "title": "多平台接入与反爬限频运维"},
        ],
    },
    {
        "id": "billing",
        "title": "🗄️ 数据存储与商业化体系",
        "items": [
            {"path": "PostgreSQL持久化与双写存储架构.md", "title": "PostgreSQL 16 双写存储架构"},
            {"path": "会员支付-Stripe方案设计.md", "title": "Stripe 会员与三级配额架构"},
            {"path": "会员支付-开发与验收指南.md", "title": "商业化沙箱联调与验收指南"},
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
}


@router.get("/list")
def api_docs_list():
    """返回文档目录树与分组元数据，支持自动收集 docs/ 下未归类的其余 .md 文件。"""
    # 收集已归类的所有文档文件名
    categorized_paths = set()
    for cat in CATEGORIES:
        for item in cat.get("items", []):
            categorized_paths.add(item["path"].lower())

    # 扫描 docs/ 目录，自动补全遗漏的 md 文件作为兜底
    uncategorized_items = []
    if os.path.isdir(DOCS_DIR):
        for fname in sorted(os.listdir(DOCS_DIR)):
            if not fname.endswith(".md"):
                continue
            if fname.lower() in _HIDDEN_DOCS or fname.endswith(".example.md"):
                continue
            if fname.lower() not in categorized_paths:
                title = os.path.splitext(fname)[0]
                uncategorized_items.append({"path": fname, "title": title})

    categories_result = [dict(c) for c in CATEGORIES]
    if uncategorized_items:
        categories_result.append({
            "id": "more",
            "title": "📚 更多技术沉淀与指南",
            "items": uncategorized_items,
        })

    return {"categories": categories_result, "default_doc": "产品发布会说明书与架构全景.md"}


@router.get("/content")
def api_docs_content(path: str = Query(..., description="文档相对路径，如 系统架构与技术全景.md")):
    """安全读取单个 Markdown 文档内容。"""
    # 规范化并去除前后斜杠与多余字符
    clean_path = path.strip().lstrip("/")
    if clean_path.startswith("docs/"):
        clean_path = clean_path[5:]
    if not clean_path.endswith(".md"):
        clean_path += ".md"

    # 防路径穿越 (Path Traversal) 检查
    target_abs = os.path.abspath(os.path.join(DOCS_DIR, clean_path))
    if not target_abs.startswith(DOCS_DIR):
        raise HTTPException(status_code=403, detail="非法访问路径")

    if not os.path.isfile(target_abs):
        # 尝试根目录 README.md
        if clean_path.lower() in ("readme.md", "docs/readme.md"):
            readme_path = os.path.join(DOCS_DIR, "README.md")
            if os.path.isfile(readme_path):
                target_abs = readme_path
            else:
                raise HTTPException(status_code=404, detail="文档未找到")
        else:
            raise HTTPException(status_code=404, detail=f"文档不存在: {clean_path}")

    try:
        with open(target_abs, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        # 尝试提取第一个 # 一级标题作为 Title
        title = os.path.splitext(os.path.basename(clean_path))[0]
        match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if match:
            title = match.group(1).strip()

        mtime = None
        try:
            mtime = os.path.getmtime(target_abs)
        except OSError:
            mtime = None

        return {
            "title": title,
            "path": clean_path,
            "filename": os.path.basename(clean_path),
            "modified_at": mtime,
            "content": content,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取文档失败: {e}") from e
