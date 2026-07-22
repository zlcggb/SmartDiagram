# 执行文档：导出 PPTX 文字排版保真校准（2026-07-17）

## 问题

- **在线 SVG 预览正确**，导出 PPTX 后字号 / 换行 / 垂直对齐有可见差距（非乱码级，但是「不能 100% 复刻」）。
- 复现页：Studio P6「下阶段规划与潜在风险应对」
  - 标题区贴边 / 间距偏紧
  - 右上 ROADMAP 徽章：字相对框偏大或垂直不居中
  - 左侧橙块「潜在 / 风险」提前换行（预览更宽可容纳）

## 方案对比

| 方案 | 内容 | 权重 | 取舍 |
|------|------|------|------|
| **A（选用）** | 度量与排版校准：CJK 字宽、文本框加宽余量、信任 `data-h`、徽章 fit、多行 valign、装饰 path 椭圆近似；契约/prompt 同步 | **90** | 保留可编辑矢量；明显缩小差距；可回归 |
| B | 视觉页默认 raster（PNG 贴图）像素一致 | **42** | 100% 像素但可编辑性差；不修编译主路径；宜作可选开关而非默认 |

**结论：执行方案 A。** OOXML 无法与浏览器 SVG 像素级等同；目标是明显缩小差距。若单页必须像素级一致，后续可加可选「像素保真导出」（方案 B 补充，非默认）。

## 根因（已验证）

| # | 根因 | 说明 |
|---|------|------|
| 1 | `data-h` 被错误封顶 | `Math.min(rawDataH, estimatedLineCount * fontPx * 1.55)` 把徽章框压矮 → `valign:middle` 相对徽章矩形偏移 |
| 2 | CJK 字宽低估 + 文本框无余量 | pptxgen/OOXML 中文度量偏「肥」；`data-w` 原样映射时橙块提前换行 |
| 3 | 西文经验收窄误伤短中文 | 旧 `shouldTightenWidth` 用 0.75em 估宽，短中文标签会被收窄 |
| 4 | 字号 0.75 几何正确但非唯一因素 | 保持 `FONT_PX_TO_PT=0.75`；换行靠加宽而非再打折字号（避免回归「乱码感」小字） |
| 5 | 曲线填充装饰 path 被跳过 | 01/02 底图 blob 预览有、导出空；现对曲线 fill path 做淡色椭圆近似（仍非矢量 path） |

## 改动摘要

### `packages/ppt-renderer/src/svgCompile.ts`

- `cjkRatioOf` / `avgCharWidthEm`：混合字宽估算
- 导出保真加宽：CJK `×1.12`，西文 `×1.04`；CJK/多行禁止收窄
- **信任 `data-h`**：有属性时 `finalH = max(contentMinH, rawDataH)`，不再压扁徽章
- 紧徽章：字号适配框高；`valign` 多行 top / 单行 middle；padded 单行按基线居中定位
- 标题贴左缘时微移 `+6u`
- 曲线无描边填充 path → 淡色 `ellipse` 近似（简单折线填充仍跳过）

### 其它

- `prompts.ts`：徽章 `data-h`、中文 `data-w` 余量、显式 tspan 换行
- `COMPILABLE_SVG.md`：同步文本与装饰 path 说明
- `svg-compile-regression.ts`：CJK 加宽 / 徽章 data-h / 曲线 blob 用例

## 验证

```bash
corepack pnpm --filter @ppt-agent/ppt-renderer test:svg-regression
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck
corepack pnpm --filter @ppt-agent/agents typecheck
```

结果（本机）：defense 10/10 + examples 2/2；typecheck 通过。

| Fixture | 断言 |
|---------|------|
| 橙块多行中文 `data-w=220` | 框宽 ≈ `220×1.12` → 2.567in；`fontSize=15`（20×0.75） |
| ROADMAP 徽章 `data-h=36` | `h=0.375in` 保留；`valign=middle`；`fontSize=10.5` |

## 残留上限（对用户可说）

| 能到多接近 | 说明 |
|------------|------|
| **明显更好，但仍非 100%** | 换行点、字距、行高仍可能差 1 行或数 px；客户端字体（无雅黑时）会再漂 |
| **曲线装饰** | blob 仅为椭圆近似，不是原 path 造型 |
| **复杂滤镜 / mask / 异形裁剪** | 仍不支持；应 IR 或重生成 |

### 何时用 IR / 像素导出

| 场景 | 建议 |
|------|------|
| 表格、风险清单、强可编辑正文 | 页策略 **IR** |
| 封面 / 对比 / 流程等视觉页 | **SVG 编译**（本校准后） |
| 必须与设计稿像素级一致（评审/印刷） | 可选 **像素保真导出**（raster，可编辑性差；待产品开关） |
| 生成侧 | 中文多行尽量 **显式 tspan 换行**；徽章 `data-h`=整颗高度 |

## 相关文档

- [COMPILABLE_SVG.md](../00-architecture/COMPILABLE_SVG.md)
- [EXECUTION_export-pptx-garble-fix-2026-07-17.md](./EXECUTION_export-pptx-garble-fix-2026-07-17.md)
- [EXPERIENCE_export-pptx-preview-ok-compile-drift.md](./EXPERIENCE_export-pptx-preview-ok-compile-drift.md)
- [EXPERIENCE_export-text-fidelity-cjk-badge.md](./EXPERIENCE_export-text-fidelity-cjk-badge.md)
