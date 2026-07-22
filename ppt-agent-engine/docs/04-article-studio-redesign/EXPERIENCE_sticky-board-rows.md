# 经验：行列看板 + 拖拽归位

## 场景

大纲/故事板类产品常被做成「多列瀑布」或「自由画布」。参考图若明确是 **纵向章节、横向页面**，用 CSS `columns` 混排会立刻错：章节卡与内容卡交错进列，破坏「一行一章」心智。

## 可复用做法

1. **数据先分行再渲染**：`partTitle` 连续分组 → `rows[]`；DOM 就是 `flex-column` of `flex-row`，不要指望多列流「碰巧」对齐。
2. **全局顺序 = 各行拼接**：同行内 reorder 后 `flatMap` 回完整 `slideIds`，后端仍只吃一维数组。
3. **拖拽空隙 + FLIP**：拖入位用窄条占位；松手前记 `getBoundingClientRect`，重排后 `element.animate(translate)`，避免列表瞬间跳位。
4. **跨行先不做**：没有 `partTitle` 写入能力时，跨行只会弄乱分组；同行内左右排序先做稳。

## 注意

- SECTION 卡是合成 UI，不参与 DnD；内容卡才 draggable。
- 行 track 设 `overflow-x: auto`，卡片固定宽度，避免挤扁。
- 空白页若无 `partTitle`，插入中间可能切出「未分章」行——建页时应继承锚点章节（见 [EXPERIENCE_board-add-page-section.md](./EXPERIENCE_board-add-page-section.md)）。
