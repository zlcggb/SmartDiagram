# EXECUTION · 恢复本页 IR/SVG/混合可选

日期：2026-07-18

## 需求

设计稿阶段只显示「IR 优先（只读）」，工具条却出现「全部生成 IR」，用户无法选择 IR / SVG / 混合，也不理解批量按钮在做什么。

## 根因

1. 工作室改版（导出进 Studio）时把策略切换收成只读徽章  
2. 工具条按**当前页**策略分支：当前页是 IR 就显示「全部生成 IR」并调用 `generateAllIr`，会把**所有页**都生成 IR，而不是尊重各页策略

## 方案对比

| 方案 | 做法 | 权重 | 说明 |
|------|------|------|------|
| A | 恢复三选一切换 +「按策略全部生成」走 `generateAllDesigns` | **9.0** | API/store 已具备；语义对齐 Hybrid |
| B | 同时暴露「全部 IR」与「全部 SVG」两个硬按钮 | **6.0** | 更易误触全量 IR |

**选用方案 A。**

## 改动

1. `StudioPage` 设计稿标题旁：`IR | SVG | 混合` 切换（`setSlideRenderStrategy`，锁定）  
2. 生成本页：随本页策略调用 IR 或设计稿  
3. 批量：统一「按策略全部生成」→ `generateAllDesigns`（ir 页 ensure IR，svg/hybrid 出设计稿）  
4. `setSlideRenderStrategy` 改为乐观更新，不占全局 busy  

## 验证

- [ ] 可把当前页从 IR 切到 SVG/混合，徽章与生成按钮文案随之变化  
- [ ] 「按策略全部生成」不会因当前页是 IR 而把全部页改成只出 IR  
- [ ] 切换策略后重新「生成本页」得到对应产物  
- [ ] web typecheck 通过  
