# 经验：对照 AGPL HTML-Deck Skill（dashi）时注意什么

## 何时复用

再拉「Agent Skill + 本地生成器 + 浏览器导出」类参考仓，或讨论「右侧主题控制台 / 一键导出」产品形态时。

## 要点

1. **先分许可层**：主体 AGPL ≠ 可并入商用引擎；子包若标 Proprietary，只读架构不抄实现。
2. **颜色要分三层写清**：整套 themePack → 主题 token/CSS 变量 → 页级枚举控件；避免写成「随便 CSS 换肤」。
3. **生成契约比导出引擎更值得学**：`layout + props` / role 选页 / 锁模板填文案，可映射到我们的 IR 与导出模式，而不碰专有 DOM→PPTX。
4. **参考仓一律 `references/` + gitignore**，文档落在 `docs/00-architecture/REFERENCE_*.md`，与 svg2pptx 对照同一索引。
