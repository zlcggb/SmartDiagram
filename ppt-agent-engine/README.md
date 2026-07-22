# PPT-agent

PPT-agent 是一个本地优先的 PPT 制作引擎原型，目标是把“项目资料 -> 事实确认 -> 便利贴大纲 -> 单页策划稿 -> Gemini SVG/Bento 页面设计 -> 可编辑 PPTX”串成稳定闭环。

当前版本重点是可编辑导出：导出的 PPTX 不是整页图片，主要文字、卡片、表格和线条会尽量转换成 PowerPoint 原生文本框与形状。

## 目录结构

```text
apps/api              后端 API，项目、AI 调用、导出接口
apps/web              前端工作台，5 步制作流程
packages/agents       Gemini/Mock 适配器和提示词链
packages/ppt-renderer PPTX 渲染器，负责把 SVG/IR 转成可编辑对象
packages/shared       共享类型和 schema
prisma                SQLite schema、迁移、种子数据
docs                  设计文稿、分阶段执行/经验文档、PRD、维护手册（见 docs/README.md）
storage/exports       本地导出文件，已被 gitignore 忽略
```

## 本地启动

一键（推荐）：

```bash
chmod +x start-dev.sh
./start-dev.sh
```

或手动：

```bash
corepack pnpm install
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm dev
```

首次若无 `.env`，`start-dev.sh` 会从 `.env.example` 生成。不配 Gemini Key 时默认可用 `AI_PROVIDER=mock` 演示。

默认地址：

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:4000
- 健康检查: http://127.0.0.1:4000/api/health
- AI 状态: http://127.0.0.1:4000/api/ai/status

## 环境变量

复制 `.env.example` 为 `.env`，再填入本机配置：

```env
DATABASE_URL="file:D:/codex work/PPT-agent/ppt-agent-engine/prisma/dev.db"
AI_PROVIDER="gemini"
GEMINI_API_KEY="你的 Gemini API Key"
GEMINI_MODEL="gemini-3.1-flash-lite"
GEMINI_DESIGN_MODEL="gemini-3.5-flash"
```

如果本机访问 Gemini 需要代理，可以额外设置：

```env
GEMINI_PROXY_URL="http://127.0.0.1:7892"
```

`.env` 已加入 `.gitignore`，不要提交真实 API Key。

## 常用命令

```bash
corepack pnpm dev          # 同时启动 API 和 Web
corepack pnpm dev:api      # 只启动后端
corepack pnpm dev:web      # 只启动前端
corepack pnpm typecheck    # 类型检查
corepack pnpm db:generate  # 生成 Prisma Client
corepack pnpm db:migrate   # 初始化或更新 SQLite 数据库
corepack pnpm db:studio    # 打开 Prisma Studio
```

## 验证 Gemini 是否接入

打开：

```text
http://127.0.0.1:4000/api/ai/status
```

正常接入时应看到：

```json
{
  "status": "ok",
  "provider": "gemini",
  "usingMock": false,
  "geminiApiKeyConfigured": true
}
```

## 当前导出逻辑

1. 前端第 5 步选择导出风格，例如“白蓝”或“蓝黑”。
2. 后端调用 Gemini 生成每页 SVG/Bento 页面设计。
3. 后端清洗 SVG 中的幻觉文本，避免乱写日期、倒计时和不存在的数字。
4. PPT 渲染器把 SVG 中的 `rect`、`text`、`line`、`circle` 等元素转换为 PPT 原生对象。
5. 导出的 PPTX 里卡片可以拖动，文字可以编辑。

## 重要限制

- `gemini-3.1-flash-lite` 成本低，适合事实提取、结构化大纲和普通策划稿。
- 页面设计和 SVG/Bento 预览默认使用 `GEMINI_DESIGN_MODEL=gemini-3.5-flash`，更接近手工提示词直接生成的高级视觉效果。
- SVG 预览和 PPTX 可编辑转换之间天然有损耗。复杂滤镜、渐变、路径装饰可能无法完全转换成 PPT 原生对象。

## 后续维护

开发前先看：

- `docs/README.md`（文档中心与阶段时间线）
- `docs/DESIGN_文章式PPT_Agent工作室.md`（产品 / 技术总览）
- `docs/MAINTENANCE.md`
- `docs/prd/editable-ppt-agent-engine-prd.md`

每次改完至少运行：

```bash
corepack pnpm typecheck
```

提交前确认不要包含：

- `.env`
- `prisma/dev.db`
- `storage/exports/**`
- `node_modules`
