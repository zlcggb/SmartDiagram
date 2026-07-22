# EXECUTION · 便利贴墙悬停插入 + 阶段入口修正

日期：2026-07-17

## 问题

1. **加页路径偏顶栏**：必须先选中卡片再点「+ 加一页」，无法在两卡之间直观插入。
2. **空白页阶段图标跳错页**：在「新增空白页」上点「搜索结果 / 初稿 / 设计稿」会进入别的页面（常见为首页 / `slides[0]`）。

## 方案对比

| 方案 | 做法 | 权重 | 结论 |
|------|------|------|------|
| **A** | 行内 hover 虚线插入槽 + 修正 Studio 入口始终用被点卡 `slide.id`（URL `?slide=` 优先） | **~92** | **选用** |
| B | 仅改顶栏「加一页」交互文案/引导 | ~35 | 不做：仍无法定位插入点 |

## 根因（阶段跳错页）

`StickyBoard` 本身已传 `onOpenStudio(slide.id, phase)`，但 Studio 挂载时：

1. `loadProject` **无条件** `selectedSlideId = firstSlideId(slides)`；
2. `selectSlide(fromQuery)` 若早于异步 `loadProject` 完成，会被覆盖；
3. `selected = find(selectedSlideId) ?? slides[0]` 在错误 id 时静默落到首页。

## 改动摘要

| 文件 | 变更 |
|------|------|
| `StickyBoard.tsx` | 每张内容卡右侧增加 `sticky-insert-slot`；点击 `onAddPage(slide.id, partTitle)`；阶段按钮显式绑定当前卡 `slide.id` |
| `styles.css` | 悬停展开虚线虚拟框 + 大加号；拖拽时隐藏插入槽 |
| `BoardPage.tsx` | `openStudio`：`selectSlide` → `setStudioPhase` → `navigate(...?slide=id)`；顶栏「进入工作室」带当前焦点 slide |
| `StudioPage.tsx` | URL `?slide=` 优先解析；`slides` 加载后再对齐 `selectSlide` |
| `workbenchStore.ts` | `loadProject` 若当前 `selectedSlideId` 仍存在则保留，不再强行回到首页 |

## 交互（落地后）

1. 鼠标移到内容卡右侧缝隙 / 章末 → 出现虚线框 + 大加号 → 点击在该卡后插入同章空白页。
2. 卡上三阶段图标 → 始终进入**该卡** Studio，URL 含 `?slide=<id>`，并设置对应 `studioPhase`。

## 验证

```text
corepack pnpm --filter @ppt-agent/web typecheck
```

手动：

- 悬停「新增空白页」右侧 → 虚线槽 → 点击 → 同章出现新空白页且在其后。
- 在空白页点「初稿」→ Studio 标题为「新增空白页」，地址栏 `?slide=` 为该卡 id。
