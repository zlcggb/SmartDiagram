# 经验：导出反馈与可选字段的前端兼容

## 场景

后端已有降级逻辑（warnings），但 `ExportDto` / 响应体尚未稳定带回结构化字段；前端仍需先展示策略与提示。

## 做法

1. **策略标签**：优先 `slide.renderStrategy`，否则本地 `inferRenderStrategy`；展示具体中文，避免长期停在「自动」。
2. **导出反馈**：在 web 用 `ExportDto & { warnings?; pageResults? }` 扩展，解析时全部 optional；缺字段 = 空列表。
3. **会话态警告**：存在 store（`exportWarnings`），与历史 `exports[]` 分离；可清除，换项目/再导出时重置。
4. **样式**：降级提示用 `border-line` + `text-muted`，不要做成错误红条，避免用户以为导出失败。

## 可复用点

凡「后端能力已有、DTO 未齐」的并行交付：前端用交集类型吞可选字段 + 明确 fallback，比等 shared 改完再开 UI 更快，且联调后零改或只删本地类型。
