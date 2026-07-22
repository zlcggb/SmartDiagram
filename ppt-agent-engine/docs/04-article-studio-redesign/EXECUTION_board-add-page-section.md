# EXECUTION · 便利贴墙「加一页 / 加章节」分流

日期：2026-07-17

## 问题

顶栏「+ 加一页」与卡片「+ 新建页面」实际效果像**新建章节行**：新 slide 无 `partTitle`，墙按 `partTitle` 连续分组后落入「未分章」或拆开原章。

用户期望：在当前章节内容卡右侧再加一张**同章内容页**。

## 方案对比

| 方案 | 做法 | 权重 | 结论 |
|------|------|------|------|
| **A** | API `POST /slides` 支持 `partTitle` + `afterSlideId`；前端拆「加一页 / 加章节」；工具条同章加页 | **~90** | **选用** |
| B | 前端假分组、不写 `partTitle` | ~30 | 不做：刷新/重排后失真，且无法跨会话稳定 |

## 产品逻辑（落地后）

1. **加内容页**：插入指定章（`partTitle`）；默认插在该章最后一页后，或选中页后；新 slide 带正确 `partTitle` 与 `sortOrder`。
2. **加章节**：独立入口；创建新 `partTitle` + 一张空白内容页（章节卡由分组合成）。
3. 卡片「+ 新建页面」= 同章加页，写入/继承 `partTitle`。

## 改动摘要

| 层 | 文件 | 变更 |
|----|------|------|
| shared | `packages/shared/src/index.ts` | `createBlankSlideSchema` 增 `partTitle?`、`afterSlideId?`；`updateSlideSchema` 增 `partTitle?`；导出 `CreateBlankSlideInput` |
| API | `apps/api/src/routes/projects.ts` | 创建时写 `partTitle`；按 `afterSlideId` 插入并重排 `sortOrder`；无 partTitle 时继承锚点页 |
| web api | `apps/web/src/lib/api.ts` | `createBlankSlide(projectId, input)` |
| store | `apps/web/src/store/workbenchStore.ts` | `createBlankSlide(input?)` 按锚点插入本地列表并重编号 |
| Board | `BoardPage.tsx` | 顶栏「加一页」/「加章节」；无选中则落到最后一章末尾 |
| StickyBoard | `StickyBoard.tsx` | `onAddPage(afterId, partTitle?)`；`BoardFocus` + Contents/选中同步当前章 |

## 交互

- 顶栏 **加一页**：有选中章/页 → 插到该上下文；无选中 → 最后一章末尾。
- 顶栏 **加章节**：`prompt` 章节名（默认「新章节」）→ 末尾新建该 part 的空白页。
- 行内/选中工具条 **新建页面**：同章加页。
- Contents 点章节：设为当前章（供顶栏加一页）。

## 验证

```text
corepack pnpm --filter @ppt-agent/shared typecheck
corepack pnpm --filter @ppt-agent/api typecheck
corepack pnpm --filter @ppt-agent/web typecheck
```

手动：选中「后端基础架构…」→ 加一页 → 同行出现新内容卡且 partTitle 一致；加章节 → 新 SECTION 行。

## 根因一句话

空白页创建未写 `partTitle`，分组键变成「未分章」，视觉上像多了一章。
