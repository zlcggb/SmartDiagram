# EXPERIENCE：从 AGPL 参考仓学心智、自研落地（主题包 / 版式角色）

## 何时复用

- 想借鉴竞品/开源「主题库 + 版式角色 + 填空生成」产品结构，但**不能**引入 AGPL/专有依赖时。
- 自有栈已是 IR/SVG/pptxgenjs，只需对齐交互心智而非替换导出引擎时。

## 做法摘要

1. **先写合规边界**：允许学什么、禁止拷什么，写进 REFERENCE + EXECUTION。  
2. **方案权重表强制选型**：子进程调用 / 整仓移植通常权低；自研同类契约权高。  
3. **ThemePack = 有限枚举 + token 表**，不要无限色盘；换色用角色色映射（recolor），重生成另开按钮。  
4. **Layout role → recommendedLayout → blueprint**：提示词与 JSON Schema 共用同一枚举，normalize 吞旧值。  
5. **生成链路只加约束、不换路径**：outline/plan/design 注入目录即可，不必引入 HTML Deck。

## 踩坑

- Tailwind 动态 `bg-[${hex}]` 常不生效 → 色块用 inline `style.background`。  
- 导出主题枚举若写死在 API/renderer，扩展 ThemePack 时会静默回落白蓝 → 统一 `normalizePptExportTheme`。  
- 第一期 renderer 可按 light/dark 族复用旧模板；真正色差靠 SVG recolor，避免一次改光所有 IR 模板。

## 相关文档

- [EXECUTION_dashi-inspired-integration.md](./EXECUTION_dashi-inspired-integration.md)
- [REFERENCE_dashi-ppt-skill.md](../00-architecture/REFERENCE_dashi-ppt-skill.md)
- [EXPERIENCE_reference-dashi-ppt.md](../00-architecture/EXPERIENCE_reference-dashi-ppt.md)
