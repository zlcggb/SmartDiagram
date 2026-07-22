# 经验：参考仓 SVG 对照回归要分「能力」与「产品门禁」

## 场景

用 `svg2pptx-skill/examples` 做本仓 SVG→PPTX 回归时，example 的 viewBox / 画幅往往**不是**产品约定的 `0 0 1280 720`。若只调用带门禁的 `tryRenderSvgSlide`，会对着「全部 false」假失败。

## 做法

1. **导出纯编译函数**（如 `compileSvgPreviewToSlide`）返回 `{ ok, rendered, reason }`，回归断言 count / 不抛错。
2. **产品入口**（`tryRenderSvgSlide`）继续强制 viewBox + 硬门禁；二者分层，避免为了测 example 放宽生产门禁。
3. **references 可选**：目录缺失时 skip exit 0，主仓 CI 不因未 vendor 参考仓而红。
4. **拆包务实**：先保证 `svgCompile` 可测；大文件再抽 `exportTypes` / `irRender` 之一，禁止一次拆光。

## 易踩坑

- 把「能 walk 出对象」当成「可正式导出」——几何与门禁仍可能失败。
- 像素级对比 ppt-master ROI 低；工程化第一刀用对象数即可。
