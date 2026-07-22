# EXECUTION · 导出范围可控，禁止悄悄全量生成

日期：2026-07-18

## 需求

只做完一页设计稿时点「导出」，不应自动给其余页补检索/初稿/出图。应提示未生成，并允许只导出当前页（或已完成页）以便预览效果。

## 根因

`POST /export-pptx` → `prepareSlidesForExport` 会对**全部页**调用 `ensureSlideIr` / 必要时补 SVG，缺 plan 时还会 `generateSlidePlan`。前端「一键导出」无范围选择，用户感知为全自动流水线。

（说明：导出路径本身不跑按页检索；但补 plan/IR/SVG 已足够「怪怪的」。）

## 方案对比

| 方案 | 做法 | 权重 | 说明 |
|------|------|------|------|
| A | `slideIds` + `fillMissing` 默认 false；未就绪弹层：当前页 / 已完成页 / 取消 | **9.2** | 产品意图清晰；预览单页零成本 |
| B | 仅前端 confirm，后端仍自动补齐全部 | **4.0** | 确认后仍会跑生成，治标不治本 |

**选用方案 A。**

## 改动

1. `exportPptxSchema`：`slideIds?`、`fillMissing` 默认 `false`
2. `prepareSlidesForExport`：`fillMissing=false` 时不调 AI，只用已有 SVG/IR（否则主题模板）
3. 导出 API：按 `slideIds` 过滤页面
4. Studio：工具条「导出当前页」+「导出 PPTX」；有未就绪页时弹层三选一
5. Store/API client：透传 `slideIds` / `fillMissing`

## 验证

- [ ] 仅 1 页有设计稿：点「导出当前页」只出 1 页 PPTX，其余页不被生成
- [ ] 点「导出 PPTX」且有未就绪页：出现提示，不自动开跑
- [ ] 全部就绪：直接导出全部，且 `fillMissing=false`
- [ ] typecheck：shared / api / web 通过

## 与「全部自动生成」的边界

顶栏「全部自动生成」仍走 `run-pipeline`，那是显式全量。导出按钮不再承担补齐职责。
