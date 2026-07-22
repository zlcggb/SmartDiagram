# 经验：P1 前后端 DTO 收口（2026-07-17）

## 场景

多 Agent 并行落地后，web 常先写「兼容可选字段」的本地 DTO；shared/API 定稿后字段名可能漂移（本轮：`used` vs `path`）。

## 做法

1. 以 `@ppt-agent/shared` 为唯一真相源；本地只留 UI 文案与收集函数。
2. 收口时逐字段对照表：响应字段名 / 类型 / web 是否消费 / 结论。
3. 功能只用到子集时（如只读 `warning`），仍要对齐完整形状，避免后续误用错字段。

## 可复用检查清单

- [ ] ExportDto / PageRenderResult / SlideDto 是否从 shared 导入
- [ ] 本地 interface 是否仍有同义异名（used/path、strategy/mode）
- [ ] `corepack pnpm typecheck` 全仓一次过
