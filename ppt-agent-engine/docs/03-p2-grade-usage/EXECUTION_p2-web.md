# 执行文档：P2 Web 按页策略 / 等级 / 用量（2026-07-17）

## 需求

只改 `apps/web`（必要时读 shared）：

1. 按页策略切换（ir / svg / hybrid），PATCH 持久化后刷新 slides
2. 导出后展示可编辑等级 A/B/C（兼容 `editableGrade` / `grade` 缺失）
3. 轻量 AI 用量摘要（`/api/ai/usage` 或 `/api/ai/status`），失败隐藏
4. 保持导出三模式与警告列表；UI 克制

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A：仅前端本地改策略，导出时再带 strategies map | 55 | 不持久化，列表刷新易丢；与 API `updateSlideSchema.renderStrategy` 脱节 |
| **B：服务端策略可改 + 等级/用量可选字段兼容** | **85** | PATCH 权威；字段未齐时降级隐藏；store 预留方法 |

**选用 B。**

## 已执行

### 1. `apps/web/src/lib/exportMode.ts`

- `strategySwitchOptions`：IR / SVG / 混合切换文案
- `EditableGrade` + `resolveEditableGrade` / `collectPageGrades`
- 兼容 `pageResults[].editableGrade` 与 `grade`

### 2. `apps/web/src/lib/api.ts`

- `updateSlideRenderStrategy` → `PATCH .../slides/:id` `{ renderStrategy }`
- `getAiUsageSummary`：先 `/api/ai/usage`，再 `/api/ai/status`；宽松解析 `callCount` 等；失败 / 无数字 → `null`
- `collectExportPageGrades`；`ExportFeedbackDto.pageResults` 本地扩展 grade 字段

### 3. `apps/web/src/store/workbenchStore.ts`

- `setSlideRenderStrategy`：PATCH 后 `getProject` 全量刷新 slides
- `exportPageGrades`：导出成功后从 pageResults 收集
- `aiUsageSummary` + `refreshAiUsage`（失败静默）
- 建项 / 加载 / 导出 / App 挂载时尝试刷新用量

### 4. `apps/web/src/App.tsx` 第 5 步 + Header

- 页面列表（compact）与详情：`StrategySwitcher`
- 导出后可编辑等级标签（有字段才显示）+ 原有 warnings 列表
- Header / 第 5 步摘要行：有调用次数才显示「本次会话 AI 调用约 N 次」

## 兼容说明

| 字段 / 接口 | 未就绪时 | UI 行为 |
|-------------|---------|---------|
| `PATCH renderStrategy` | 400 / 失败 | 错误条提示；不阻断其他流程 |
| `pageResults[].editableGrade` / `grade` | 缺失 | 不展示等级块 |
| `/api/ai/usage` | 404 | 回落 status |
| `/api/ai/status` 无 callCount | 现状常见 | 用量摘要隐藏 |

## Typecheck

```text
corepack pnpm --filter @ppt-agent/web typecheck
# exit 0
```

## 验收

- [x] 页面列表/详情可切换 ir / svg / hybrid，并 PATCH + 刷新 slides
- [x] 导出含等级字段时显示 A/B/C + 一句话；缺失不报错
- [x] 用量摘要有数字才显示；失败隐藏
- [x] 导出三模式与警告列表保留
- [x] web typecheck 通过（exit 0）
- [ ] 未 commit（按任务要求）

## 遗留

- API `/api/ai/status` 若尚未返回 callCount，用量 UI 保持隐藏（待 API P2-4）
- `editableGrade` 写入 shared / export meta 后可去掉 web 本地扩展类型
- P2-2「全部生成设计」按策略跳过 ir 页：API 侧为主，Web 文案已偏「按策略」
