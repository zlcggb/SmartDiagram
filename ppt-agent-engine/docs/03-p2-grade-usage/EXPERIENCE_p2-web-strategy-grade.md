# 经验：P2 Web 在 API 未齐时先落「可切换 + 可选展示」

## 场景

按页策略切换、可编辑等级、AI 用量等字段可能晚于前端交付。需要产品可点、联调不炸。

## 做法

1. **可写路径走已有 PATCH**：策略用 `updateSlideSchema.renderStrategy`，不要另发明 body。
2. **读路径宽松解析**：`editableGrade` / `grade`、`callCount` / `totalCalls` 多键兼容；缺失则隐藏，不挡导出。
3. **切换后全量刷新列表**：单条 replace 可能与推断标签不同步；`getProject` 一次拉齐。
4. **用量失败静默**：独立 loose fetch，不走统一 `ApiResponse` 包装（`/api/ai/status` 返回形状可能不同）。

## 可复用点

凡「服务端权威字段 + 前端先交付」：预留 store 方法、UI 有字段才渲染、失败不阻断主流程。
