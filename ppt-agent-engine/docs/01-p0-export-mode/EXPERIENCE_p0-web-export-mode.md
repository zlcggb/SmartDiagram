# 经验：前后端并行时 Web 先落产品契约

## 场景

API/shared 尚未正式导出新字段时，Web 需要先交付导出模式 UI（P0）。

## 做法

1. 在 web 本地定义临时 union（`PptExportMode` / `SlideRenderStrategy`），注释标明「待对齐 shared」。
2. API body 同时传新字段 `mode` 与旧兼容字段（如 `draft:true`），降低联调阻塞。
3. 页面策略提示：有服务端 `renderStrategy` 用服务端；没有则显示「自动」，避免前端启发式写死成权威。

## 可复用点

凡「契约未齐、产品按钮要先上」的并行开发，优先 **本地临时类型 + 双字段兼容 + 降级展示**，不要为了等 shared 卡住 UI。
