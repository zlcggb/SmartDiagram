# 经验：文章式工作室信息架构

## 场景

把「表单向导式」AI PPT 工具升级成「顾问工作室」时，用户抱怨像玩具的根因通常是：**入口先填表、大纲像列表、策划与设计挤在一步**。

## 可复用做法

1. **双入口汇合**：主题流与粘贴流前半段不同，后半段共用 Board + Studio + Export。
2. **三阶段显式分流**：搜索 → 初稿（结构）→ 设计稿（皮囊）；导出继续 Hybrid。
3. **第一期假搜索**：LLM 资料卡 + `ResearchAdapter` 预留，避免过早绑供应商。
4. **路由拆页**：巨型 `App.tsx` 会拖垮迭代；按 `/brief` `/board` `/studio` `/export` 分页面。
5. **Agent 日志**：一键流水线必须有可观测进度，否则「自动」像黑盒。

## 注意

- 不要为对齐截图引入紫渐变霓虹皮肤；沿用品牌蓝 + 浅灰网格即可。
- Prisma 扩展 `mode/briefJson/researchJson/searchJson/partTitle` 时，format 层要给旧数据默认 `mode=paste`。
