# 执行：数字便利贴墙对齐参考图布局

**日期**：2026-07-17  
**范围**：`apps/web` Board 页视觉与交互；不改后端 API / 持久化坐标。

## 需求摘要

用户反馈现状「左侧竖排列表 + 深蓝章节条」不像参考图。目标是：点阵白板画布、章节卡与内容卡混排多列网格、选中蓝边框 + 底部浮出工具条；可选 Contents 侧栏跳转章节。

## 方案对比与选型

| 方案 | 做法 | 权重 | 说明 |
|------|------|------|------|
| **A（选用）** | CSS 多列（`columns`）画布 + 章节卡/内容卡两种组件 + 选中工具条；拖拽仍走现有 `reorderSlides`；新增页 create + reorder 插到选中后 | **~88** | 对齐参考图主视觉；无新持久化；成本可控；Contents 侧栏可一并做 |
| **B（不做）** | 无限画布自由拖拽，持久化每卡 x/y | **~55** | 产品感更强，但需 schema/API/碰撞与缩放；本期超出范围 |

**选定：A。**

## 实现要点

1. **新建** `apps/web/src/components/StickyBoard.tsx`
   - 按 `partTitle` 切换时插入合成「章节卡」，与真实 slide「内容卡」混入同一多列流。
   - 章节卡：大标题、右上淡色编号、`SECTION` + Draft。
   - 内容卡：`#页码`、右上「内容页」、标题 + 摘要、底部三阶段按钮（搜索/初稿/设计稿）。
   - 单击选中（蓝粗边框）；双击或点标题进 Studio；点阶段图标带 `studioPhase`。
   - 选中浮出工具条：删除 | + 新增页面（章节卡仅新增）。
   - 左侧 Contents 侧栏：章节列表，点击 `scrollIntoView`。
2. **改写** `apps/web/src/pages/BoardPage.tsx`：头部操作保留；主体改挂 `StickyBoard`；`addPageAfter` = `createBlankSlide` + `reorderSlides`。
3. **样式** `apps/web/src/styles.css`：点阵背景、多列、卡片/工具条/Contents；品牌蓝强调，无紫渐变霓虹。

## 验证

```bash
corepack pnpm --filter @ppt-agent/web typecheck
```

- 有大纲的项目打开「便利贴墙」：画布铺满、多列混排，无左侧窄条文档感。
- 单击卡片出现蓝边与工具条；删除/新增可用；拖拽内容卡可 reorder。
- 点标题或阶段图标进入 Studio 对应阶段。
- Contents 可跳到对应章节卡。

## 变更文件

- `apps/web/src/components/StickyBoard.tsx`（新）
- `apps/web/src/pages/BoardPage.tsx`
- `apps/web/src/styles.css`
- `docs/04-article-studio-redesign/EXECUTION_sticky-board-layout.md`（本文件）
- `docs/04-article-studio-redesign/EXPERIENCE_sticky-board-whiteboard.md`
- `docs/04-article-studio-redesign/README.md`（索引）
