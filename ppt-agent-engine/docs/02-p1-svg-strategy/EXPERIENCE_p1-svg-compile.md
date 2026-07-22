# 经验：SVG→PPTX 优先 XML 结构，能力按 pptxgenjs 边界裁切

## 场景

可编译 SVG 从「正则扫标签」升级到「结构感知」时，最容易在 `text/tspan` 混合内容、`defs` 引用上静默丢元素；同时 pptxgenjs 能力远小于 DrawingML 全集。

## 做法

1. **解析用 DOM/栈，渲染用白名单 walk**：失败返回 `false`，由导出层降级 IR，不 throw。
2. **tspan**：无定位属性 → 同框多 run；带 `x`/`y`/`dy` → 换行 run（`breakLine`）。
3. **渐变 / 箭头**：有原生 API 才映射；无则近似（渐变→主色 solid，marker→`endArrowType`）。
4. **少加依赖**：子集契约清晰时，包内轻量 XML 往往够用，避免安装/锁文件拖垮并行 Agent。

## 易踩坑

- 预检不足 4 对象再 mutate slide，避免「半成品 + IR」叠层（与导出降级经验一致）。
- 参考仓 `shared-standards` 的能力上界 ≠ 本仓渲染器上界；以 pptxgenjs 类型为准。
