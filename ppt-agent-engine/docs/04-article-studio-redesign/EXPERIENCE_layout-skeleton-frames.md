# EXPERIENCE：Variant 坐标骨架文件

## 何时复用

- 要把「角色/变体剪影」推进到可落地的固定构图时。
- IR/SVG 仍自由漂移、同质三卡墙反复出现时。

## 做法摘要

1. **JSON 为唯一真相**：`frames/<variantId>.json` 锁 x/y/w/h；TS 只做 fill/snap。
2. **两路消费**：提示词下发骨架模板；`normalizeSlideIr` 再 snap 一次防漂移。
3. **fallback 直接填槽**：模型失败时用 `buildIrFromSkeleton`，比手写三卡兜底更稳。
4. **slot 路径约定**：`claim`、`metrics.0`、`cards.1`；从 slide/plan 映射时同步展开索引。

## 踩坑

- `fill.ts` 不要从 `shared/index` 再引类型，易循环依赖；用本地 IrDoc 结构。
- registry 用 `import … with { type: "json" }`（NodeNext）；增帧后记得改 registry。
- snap 按 id → role → 顺序匹配 content，LLM 乱改 id 时仍能保住文案。

## 相关

- [EXECUTION_layout-skeleton-frames-2026-07-18.md](./EXECUTION_layout-skeleton-frames-2026-07-18.md)
- [EXECUTION_layout-variant-library-2026-07-17.md](./EXECUTION_layout-variant-library-2026-07-17.md)
- [packages/shared/src/skeletons/README.md](../../packages/shared/src/skeletons/README.md)
