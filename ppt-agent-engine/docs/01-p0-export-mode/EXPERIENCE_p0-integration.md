# 经验：P0 多 Agent 交付后的类型收口

## 场景

多路并行改 shared / api / renderer / web 后，web 常会留下「待对齐」本地类型（如 `PptExportMode`）。收口时应优先 **从 shared 重导类型**，只保留纯 UI 文案层。

## 做法

1. shared 已有 `ExportMode` / `RenderStrategy` / `inferRenderStrategy` 时，web 删除重复 union，改为导入。
2. UI 选项文案（`exportModeOptions`、busy label）留在 apps/web，避免污染 shared。
3. 展示「自动 vs 服务端策略」时：`fromServer` 判断用 shared 的 `renderStrategies`；无字段时仍显示「自动」，启发式可与后端共用 `inferRenderStrategy`，避免双套规则漂移。
4. 收口后必跑 `corepack pnpm typecheck`（全仓 `-r`），不要只跑 web。

## 易踩点

- API 用 `exportPptxSchema` 同时服务 export 与 design：body 可带 `mode`，但 design 路径可能暂时只用 `theme`——属契约前向兼容，不是字段名不一致。
- `draft` 布尔与 `mode` 并存时，以 schema transform 为准（`draft:true` → `mode:draft`）。
