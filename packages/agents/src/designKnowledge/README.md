# PPT Design Knowledge

这不是一组“高级、简洁、科技感”的形容词，而是 SVG 设计阶段可执行的页面设计系统。

参考项目中最有效的共同做法是：先按内容语义选择具体页面模板，再把模板拆成坐标区、形状程序、连接关系和禁止项。SVG 负责视觉表现，可编辑 IR 继续使用稳定骨架，两者不再被同一套通用卡片坐标锁死。

## 目录职责

- `templates.ts`：页面配方，定义什么时候使用、具体坐标区和形状组合。
- `selector.ts`：根据版式角色、正文块数量、图表类型和关键词选择配方。
- `shapeGrammar.ts`：跨模板复用的形状语法与 SVG/PPT 可编辑约束。
- `assembler.ts`：把选中的配方组装成模型可执行提示词。
- `visualQuality.ts`：生成后检查语义分组、必要图元和卡片墙退化。

## 调用原则

1. 两个互补模块优先 `dual-engine-bridge`，而不是两张并排卡片。
2. 架构/生态/组件关系优先 `radial-ecosystem`。
3. 流程/时间线/成长路径优先 `stepped-roadmap`。
4. 真实数据和趋势优先 `evidence-dashboard`；没有真实数值不得伪造图表刻度。
5. 对照选择优先 `matrix-contrast`。
6. 封面/观点页优先 `editorial-hero-split` 或 `quote-monument`。
7. 只有普通分类信息时才用 `asymmetric-card-stack`，且必须一大多小，禁止等宽卡片墙。

每个配方都要求 SVG 输出语义化 `<g id="...">`，既便于质量检查，也让后续转换和调试能看懂页面到底由哪些视觉层组成。
