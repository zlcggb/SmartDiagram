# EXPERIENCE · 看板插入槽与 Studio deep-link

日期：2026-07-17

## 可复用结论

1. **插入位要落在行内缝隙**：顶栏「加一页」只能表达「当前焦点章」，无法表达「这两张卡之间」。同章插入必须带 `partTitle` + `afterSlideId`，UI 上用 hover 虚线槽最直观。
2. **列表页点进详情，URL 必须是真相源**：仅写 store 再 navigate 会被后续 `loadProject` 竞态盖掉。应用 `?id=`（此处 `?slide=`）并在数据加载完成后再次 `select`；列表回退到 `items[0]` 前先查 query。
3. **异步 reload 不要无脑重置选中**：`loadProject` 若强制 `firstItem`，任何「带着选中跳转」的入口都会偶发跳错页，空白新页尤其难察觉。

## 反模式

- 阶段按钮依赖外层 `selectedId` / 闭包旧值，而不是被点击那张卡自己的 `id`。
- Studio `selected = find(id) ?? slides[0]` 且不同步 URL。
