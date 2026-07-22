# 经验：P2 前后端用量与策略字段收口（2026-07-17）

## 场景

API 已落地结构化 `AiUsageDto.counts`，Web 仍按「宽松平铺 callCount」解析 → 接口 200 但 UI 永远隐藏用量。多 Agent 并行时常见「写方定契约、读方仍兼容旧草稿」。

## 做法

1. 收口时以 shared 类型为权威，逐字段对照表（含未展示字段如 `path` / `lastExportSummary`）。
2. 用量：优先识别嵌套 `data` / `usage` 下的 `counts` 求和；平铺字段只作回落。
3. 锁定态：写路径可只 PATCH `renderStrategy`（服务端默认锁定）；读路径要消费 `strategyLocked`，否则产品语义不可见。

## 可复用检查清单

- [ ] `PageRenderResult.path`（不是 `used`）+ `editableGrade`
- [ ] `SlideDto.strategyLocked` 读写语义一致
- [ ] `/api/ai/usage` 与 `/api/ai/status.usage` 同一 `AiUsageDto` 形状
- [ ] `corepack pnpm typecheck` 与 `test:svg-regression` 分行跑通
