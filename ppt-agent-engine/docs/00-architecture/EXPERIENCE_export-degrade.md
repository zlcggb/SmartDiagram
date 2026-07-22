# 经验：导出链路「失败降级」优于「失败即整份失败」

## 场景

AI 中间态（可编译 SVG）到交付物（PPTX）时，单页编译失败很常见。若「有 svgPreview 但编译失败 → throw」，用户会在最后一步丢整份结果。

## 做法

1. **契约层**统一 `mode` / `renderStrategy` / `getBannedSvgFeatures`（shared），渲染与 API 只消费。
2. **按页策略**：`ir` 直接骨架；`svg`/`hybrid` 先编译，失败回 IR/主题模板。
3. **standard 必须能交差**：缺 SVG 或编译失败 → warning + 降级，不 400/整份 throw。
4. **降级燃料提前备**：生成 SVG 时尽量顺带写 IR；导出前再 lazy `ensureSlideIr`。

## 易踩坑

- 往同一 slide 先画 SVG 再降级，可能叠层 → 先 banned + token 预检再 mutate。
- 前后端改 mode 时要同步，避免 API 已放行、客户端仍按旧「必须全页 SVG」拦截。
