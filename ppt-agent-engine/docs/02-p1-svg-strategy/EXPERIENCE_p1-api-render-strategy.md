# 经验：按页 renderStrategy 入库与导出 mode 分流（2026-07-17）

## 场景

AI PPT 混合导出（IR + SVG）里，「策略只在内存推断」会导致：

- 前端始终显示「自动」，无法信任服务端决策
- 设计生成与导出行为不一致（有的路径强制 SVG，有的又忽略 mode）
- 降级信息只在日志/文案里，前端无法结构化展示

这类问题在「大纲 → 设计 → 导出」全链路会反复碰到。

## 做法

1. **单一真相源**：Prisma `Slide.renderStrategy` + shared `infer` / `effectiveRenderStrategy`
2. **读时兜底**：`formatSlide` 无库值则推断，DTO 始终有字段
3. **写时落库**：大纲创建、layout 变更、策划/IR/设计、导出准备都写回
4. **mode 只改「是否调设计模型 / 生效策略」**，不改内容权威（仍在 Plan/IR）
5. **导出反馈结构化**：`warnings[]` + `pageResults[]`，与 renderer 同形，供 Web 直接消费

## 踩坑

- `formatExport(record, extras?)` 不能 `array.map(formatExport)`：map 的 `index` 会被当成 extras，TS 直接挂。
- 「DTO 上已有推断值」不等于「DB 已落库」；导出前应幂等补写，避免旧数据永远空列。

## 复用提示

凡「运行时策略 + 可选持久化 + 多模式产品按钮」：优先 **库字段可选 + 读时推断 + 写路径补齐**，避免只做内存字段导致前后端漂移。
