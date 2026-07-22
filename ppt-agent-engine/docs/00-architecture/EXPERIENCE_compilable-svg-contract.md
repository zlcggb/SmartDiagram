# 经验：可编译 SVG 契约应放在 shared，而不是只写在 prompt

## 场景

AI 生成 SVG → 拆成原生 PPTX 时，模型常输出 `style`/`class`/`foreignObject` 等 DrawingML 不支持特性；若只靠 prompt，门禁无法复用到 API/导出。

## 做法

1. **文档契约**（`COMPILABLE_SVG.md`）：给人读的白名单/黑名单。
2. **prompt 硬规则**：只同步关键句，避免整篇粘贴占 token。
3. **shared 纯函数门禁**（`getBannedSvgFeatures`）：API / renderer 共用，失败可重生成或降级 IR。
4. **按页策略**（`inferRenderStrategy`）：内容页偏 IR，视觉页偏 SVG，默认 hybrid。

## 可复用点

凡「模型产出中间态 → 编译器」链路，都应：**文档契约 + 生成约束 + 可测硬门禁** 三件套，且门禁放在无 UI 依赖的 shared 包。
