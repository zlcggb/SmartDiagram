# EXPERIENCE · 策略是「按页属性」，批量生成不能跟当前页走

## 场景

混合导出（IR / SVG / Hybrid）下，工具条常按「当前选中页」切换按钮文案。若批量按钮也绑定当前页策略，会出现：

- 停在 IR 页 → 「全部生成 IR」  
- 用户以为在「生成全部设计」，实际把视觉页也收成线框  

## 原则

1. **策略是页属性**，UI 必须可改（或明确说明为何不可改）  
2. **批量生成按各页策略调度**，文案用「按策略全部生成」  
3. 「只读徽章」只适合真不能改的字段；能 PATCH 的就别只读  

## 推荐映射

| 本页策略 | 生成本页 | 批量 |
|----------|----------|------|
| ir | generateSlideIr | generateAllDesigns（内部 ensure IR） |
| svg / hybrid | generateSlideDesign | generateAllDesigns |

不要用 `generateAllIr` 当默认批量入口。
