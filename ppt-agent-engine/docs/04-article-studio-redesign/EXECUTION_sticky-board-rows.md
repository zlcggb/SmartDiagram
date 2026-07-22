# 执行：便利贴墙「一行一章 / 横向排页」

**日期**：2026-07-17  
**范围**：`apps/web` Board 便利贴墙布局与同行拖拽；不改后端 schema / 自由坐标。

## 需求摘要

上一版用 CSS `columns` 把章节卡与内容卡混进多列流，视觉上变成「瀑布混排」，不符合参考图。目标布局：

1. **纵向 = 目录/章节行**（每个 `partTitle` 一行）
2. **横向 = 该章节下的页面**（内容卡水平排列，行内可横滚）
3. 拖拽只调**同一行内**左右顺序；松手有归位动画
4. 选中蓝粗边框 + 底部工具条（删除 / + 新建页面）
5. Contents 侧栏跳到对应行；点阵画布保留

## 方案对比与选型

| 方案 | 做法 | 权重 | 说明 |
|------|------|------|------|
| **A（选用）** | 按 `partTitle` 分行：左侧 SECTION 卡 + 右侧 flex 横排内容卡；HTML5 DnD 同行 reorder；CSS transition + FLIP 归位；全局 `slideIds` = 各行拼接 | **~90** | 对齐参考图主结构；无 x/y 持久化；成本可控 |
| **B（不做）** | 完整无限画布自由坐标（每卡 x/y） | **~40** | 产品感更强，但需 schema/碰撞/缩放；本期不做 |

**选定：A。**

## 实现要点

1. **`StickyBoard.tsx`**
   - `buildBoardRows`：按连续相同 `partTitle` 分组 → `BoardRow[]`
   - 每行：`sticky-board-row` = SECTION 卡（灰底大字）+ `sticky-board-row-track`（横滚内容卡）
   - DnD：仅当拖拽源与目标 `partTitle` 相同才允许；`before/after` 空隙占位；松手前 `captureFlipRects`，`useLayoutEffect` 播 FLIP
   - `reorderWithinRow` 输出全局 `orderedIds`，交给 `reorderSlides`
   - Contents → `scrollIntoView` 对应 `section` 行
2. **`BoardPage.tsx`**：文案改为「一行一章 · 横向排页」；仍挂 `StickyBoard` + `addPageAfter`
3. **`styles.css`**：去掉 `columns`；新增 rows / row-track / drop-gap / 拖起抬升半透明

## 验证

```bash
corepack pnpm --filter @ppt-agent/web typecheck
```

- [x] typecheck 通过
- [ ] 有大纲项目打开便利贴墙：多行纵向堆叠，每行左侧章节卡、右侧内容卡横排
- [ ] 同行拖拽可改顺序；跨行拖入无效；松手有滑动归位而非闪现
- [ ] 选中蓝边 + 工具条删/新建
- [ ] Contents 跳到对应行

## 变更文件

- `apps/web/src/components/StickyBoard.tsx`
- `apps/web/src/pages/BoardPage.tsx`
- `apps/web/src/styles.css`
- `docs/04-article-studio-redesign/EXECUTION_sticky-board-rows.md`（本文件）
- `docs/04-article-studio-redesign/EXPERIENCE_sticky-board-rows.md`
- `docs/04-article-studio-redesign/README.md`

## 已知后续

- `createBlankSlide` 未带 `partTitle`；插到某章后依赖 reorder 位置，若 `partTitle` 为空可能被归入「未分章」。后续可在 API/更新接口继承锚点页的 `partTitle`。
- 跨行拖拽（改章节归属）本期不做，需写 `partTitle`。
