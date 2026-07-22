# EXPERIENCE：Dashi 核心融合（薄适配加深）

## 何时复用

- 要把「主题库 + 角色选版 + 锁模板填文案 + 有限配色」竞品心智落到自有 IR/SVG 栈时。
- 已有一期 ThemePack，需要补齐到约 12 套并加 accent / 文案预算时。

## 做法摘要

1. **永远先合规边界**：学契约与交互，不抄 AGPL / 专有导出。
2. **两期拆分**：一期骨架（6 pack + 基础角色）→ 二期加深（12 pack + accent + copyBudgets + 角色扩展）。
3. **ThemePack 元数据要够 UI 用**：`suitableFor` + `previewBg` 才能做「主题网格」；chip 不够。
4. **accent 用枚举，不用色盘**：每包 3–4 个 preset；换色走 recolor 角色映射。
5. **layout enum 单一来源**：`recommendedLayoutEnumValues()` 同时喂提示词与 JSON Schema，避免 adapter 写死旧列表。
6. **renderer 不要维护第二份主题表**：`themeFamily` / `normalizePptExportTheme` 从 shared 取。

## 踩坑

- 扩展 ThemePack 后若 renderer 仍硬编码旧枚举，未知主题会静默回落白蓝。
- `recolor` 同主题换 accent 时，需同时替换 `primary`/`accent` 及 aliases，否则预览几乎无变化。
- accent 若只存在于前端 store，导出 PPTX 不会带上——文档里写清「会话预览」避免误解。

## 相关文档

- [EXECUTION_dashi-core-integration-2026-07-17.md](./EXECUTION_dashi-core-integration-2026-07-17.md)
- [EXECUTION_dashi-inspired-integration.md](./EXECUTION_dashi-inspired-integration.md)
- [REFERENCE_dashi-ppt-skill.md](../00-architecture/REFERENCE_dashi-ppt-skill.md)
