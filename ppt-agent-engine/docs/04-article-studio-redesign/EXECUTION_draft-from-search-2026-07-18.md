# EXECUTION · 初稿基于检索素材递进生成

日期：2026-07-18

## 需求

Studio 链路应是递进：

1. **检索素材**：用页意图（标题 / 核心结论 / 内容要点）检索资料卡  
2. **生成初稿**：用已选资料卡 + 页意图综合写出真正初稿（可编辑）  
3. **设计出图**：基于初稿生成设计

现状问题：初稿只吃 slide 元数据 + facts，**不读 `searchJson`**；Mock 直接复述 `contentPoints`；初稿阶段又展示同一套页意图编辑器，看起来像「又生成了一遍要点」，体验割裂。

## 方案对比

| 方案 | 做法 | 权重 | 说明 |
|------|------|------|------|
| A | Prompt/Mock 注入已选检索卡；PATCH 支持 `planJson`/`searchJson`；初稿 UI 可编辑且页意图只读 | **9.0** | 改动集中、立刻打通递进；不引入新实体 |
| B | 检索卡落库为 Fact，初稿只读 facts | **6.5** | 模型更干净，但迁移重、勾选状态与事实库易双轨 |

**选用方案 A。**

## 改动清单

| 区域 | 文件 | 内容 |
|------|------|------|
| Prompt | `packages/agents/src/prompts.ts` | `buildSlidePlanPrompt` 注入已选资料卡；禁止原样抄 contentPoints |
| Helper/Mock | `studioHelpers.ts` / `mockGeminiAdapter.ts` | `selectedSearchMaterials` + `buildMockPlanFromSearch` |
| Schema/API | `shared` `updateSlideSchema`；`projects.ts` PATCH | 可写 `searchJson` / `planJson`；改初稿清设计、改页意图清初稿 |
| Store | `workbenchStore.ts` | 乐观更新 plan/search |
| UI | `StudioPage.tsx` | 勾选「用于初稿」生效；初稿可编辑；页意图只读摘要 |

## 验证

- [ ] 检索后勾选/取消「用于初稿」，刷新仍保留  
- [ ] 「生成本页初稿」后 contentBlocks **不是** contentPoints 原文复述（有检索卡时）  
- [ ] 初稿标题/结论/块可编辑并自动保存；再进设计稿用新文案  
- [ ] `shared` / `agents` / `web` / `api` typecheck 通过  

## 注意

已有旧 `planJson` 不会自动重生；需在步骤 2 再点「生成本页初稿」或「全部初稿」。
