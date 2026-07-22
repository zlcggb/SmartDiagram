# 02 · P1 按页策略与 SVG 编译增强

## 阶段目标

让策略从「运行时推断」变成**可持久化、可展示**；增强 SVG→原生编译（XML / tspan / 渐变近似 / 箭头）；导出反馈 `warnings` + `pageResults`。

## 文档清单

| 文档 | 类型 | 说明 |
|------|------|------|
| [EXECUTION_p1-api.md](./EXECUTION_p1-api.md) | 执行 | `renderStrategy` 入库回传；mode 分流；导出反馈字段 |
| [EXECUTION_p1-web.md](./EXECUTION_p1-web.md) | 执行 | 策略中文标签；warnings UI；draft 禁批量设计 |
| [EXECUTION_p1-renderer.md](./EXECUTION_p1-renderer.md) | 执行 | `svgCompile.ts` 能力增强 |
| [EXECUTION_p1-integration.md](./EXECUTION_p1-integration.md) | 执行 | P1 集成收口 |
| [EXECUTION_export-download-svg-wps-ir.md](./EXECUTION_export-download-svg-wps-ir.md) | 执行 | 导出自动下载 + WPS 伪线防御 + IR ensure |
| [EXECUTION_export-pptx-garble-fix-2026-07-17.md](./EXECUTION_export-pptx-garble-fix-2026-07-17.md) | 执行 | 预览 OK / 导出乱码错乱：编译加固 |
| [EXECUTION_export-text-fidelity-2026-07-17.md](./EXECUTION_export-text-fidelity-2026-07-17.md) | 执行 | 预览 OK / 导出换行·徽章·字号漂移校准 |
| [EXPERIENCE_p1-api-render-strategy.md](./EXPERIENCE_p1-api-render-strategy.md) | 经验 | 策略字段设计 |
| [EXPERIENCE_p1-web-export-feedback.md](./EXPERIENCE_p1-web-export-feedback.md) | 经验 | 导出反馈 UI |
| [EXPERIENCE_p1-svg-compile.md](./EXPERIENCE_p1-svg-compile.md) | 经验 | 编译器增量改法 |
| [EXPERIENCE_p1-integration.md](./EXPERIENCE_p1-integration.md) | 经验 | P1 集成 |
| [EXPERIENCE_export-auto-download-svg-artifact-ir-ensure.md](./EXPERIENCE_export-auto-download-svg-artifact-ir-ensure.md) | 经验 | 自动下载 / 伪线 / IR 链路 |
| [EXPERIENCE_export-pptx-preview-ok-compile-drift.md](./EXPERIENCE_export-pptx-preview-ok-compile-drift.md) | 经验 | 预览与编译器漂移排查 |
| [EXPERIENCE_export-text-fidelity-cjk-badge.md](./EXPERIENCE_export-text-fidelity-cjk-badge.md) | 经验 | CJK 换行 / 徽章 data-h 保真 |

## 完成事项时间线（2026-07-17）

| 事项 | 结果 |
|------|------|
| Prisma：`Slide.renderStrategy` | 迁移 + format 回传 |
| Renderer：拆出/增强 `svgCompile` | 更稳的原生对象映射 |
| API：export 带 warnings / pageResults | 前端可展示降级原因 |
| Web：策略标签 + 反馈区 | 用户看得见「发生了什么」 |
| 导出主按钮自动下载 | store 成功后 `triggerBrowserDownload` |
| SVG 伪线防御（WPS） | 跳过曲线/fill-only；过滤角上长线 |
| IR ensure + Studio 线框 | draft/ir 强制生成；设计稿 Tab 可预览 IR |
| 导出乱码/错乱编译加固 | g 继承、安全字体、字号 0.75、fit:none、polygon、硬 transform 降级 |
| 导出文字排版保真校准 | CJK 加宽、信任 data-h、徽章 valign、曲线 blob 椭圆近似 |

← [01 P0](../01-p0-export-mode/README.md) · [文档中心](../README.md) · 下一阶段 → [03 P2](../03-p2-grade-usage/README.md)
