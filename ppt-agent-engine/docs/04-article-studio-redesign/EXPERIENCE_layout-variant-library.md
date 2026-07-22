# EXPERIENCE：用精选变体库逼近「锁模板填文案」

## 何时复用

- 对照竞品（如 dashi）发现「心智对齐了但颜值仍掉线」时。
- 要做 layout:query / 角色选版 / 防同质三卡墙，又不想搬外部版式源码时。

## 根因提醒

dashi 好看靠 **人工打磨的固定版式资产**，不是 ThemePack 数量。只扩配色 = 放大器，救不了差构图。

## 做法摘要

1. **变体层独立于角色枚举**：`recommendedLayout` 仍是稳定枚举；`layoutVariant.id` 描述剪影（主视觉区/字阶/槽位/禁止项）。
2. **queryLayouts 要可复现**：`seed` + 避开 `usedVariantIds`，封面单独池。
3. **提示词注入剪影，normalize 做预算硬门禁**：软约束不够，超长文案必须裁。
4. **renderer 按枚举精确分支**：禁止 `title.includes("status")` 这类脆弱匹配；generic 兜底也要有主次。
5. **合规红线写进 EXECUTION**：学契约与交互，不抄 AGPL/专有引擎。

## 踩坑

- Outline 注入 ThemePack 目录时要写清「主题已选定勿改」，否则模型可能试图换 theme。
- `generateSlidePlan` 若不传 theme，变体偏好会退化成默认 light。
- 流水线里勿引用块级作用域变量（如仅在「无大纲」分支声明的 `fresh`）。

## 相关文档

- [EXECUTION_layout-variant-library-2026-07-17.md](./EXECUTION_layout-variant-library-2026-07-17.md)
- [EXPERIENCE_why-thin-dashi-adapt-looks-worse.md](./EXPERIENCE_why-thin-dashi-adapt-looks-worse.md)
- [REFERENCE_dashi-ppt-skill.md](../00-architecture/REFERENCE_dashi-ppt-skill.md)
