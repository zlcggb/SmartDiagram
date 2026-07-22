# 执行文档：文章式 PPT Agent 整体重设计

日期：2026-07-17

## 需求分析

把 5 步表单向导改成专家工作室：主题调研（主）/ 粘贴资料（次）→ Brief → 便利贴墙 → Studio（搜索｜初稿｜设计稿）→ Hybrid 导出。

## 方案对比

| 方案 | 做法 | 权重 |
|------|------|------|
| A. 路由级页面 + 扩展现有 API/Store | 拆 `App.tsx`，保留 Prisma/导出栈，补 Brief/Search/Pipeline | **92** |
| B. 推倒重写前端+导出 | 新画布编辑器 + 新导出 | 35 |

选择 **A**：体感与可维护性收益最大，且不回退 P0–P2 Hybrid 导出。

## 已落地

### Phase A
- Home 双入口：`/` 主题调研 / 粘贴资料
- Brief：`/p/:id/brief` + `brief/start` `brief/answer` + research
- Board：便利贴墙、partTitle 章节、拖拽排序
- Outline Architect 提示词升级

### Phase B
- Studio 三 Tab + 左缩略图 / 中画布 / 右 Agent 日志
- Page Search（LLM 模拟）+ 资料卡
- 初稿 / 设计稿分流；导出页保留 mode/strategy/warnings/grades

### Phase C
- `POST .../run-pipeline` + 顶栏「全部自动生成」
- Agent 日志
- `ResearchAdapter` + [`SEARCH_ADAPTER.md`](./SEARCH_ADAPTER.md)

### Preserve export
- 继续 `export-pptx` Hybrid 路径；设计稿 Tab 可切 ir/svg/hybrid

## 关键路由

| 路径 | 页 |
|------|----|
| `/` | Home |
| `/p/:id/brief` | 需求对话 |
| `/p/:id/paste` | 粘贴资料 |
| `/p/:id/board` | 便利贴墙 |
| `/p/:id/studio` | 工作室 |
| `/p/:id/export` | 导出 |

旧 `/projects/:id` 重定向到 board。

## 验证建议

1. 主题流：创建 → Brief → 调研大纲 → Board → Studio 检索/初稿/设计 → 标准导出
2. 粘贴流：粘贴 → 事实 → Board → 同上
3. 一键流水线后检查 Agent 日志与 slides 状态
4. standard 模式缺 SVG 时仍能降级导出
