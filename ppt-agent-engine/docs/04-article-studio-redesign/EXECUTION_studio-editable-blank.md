# EXECUTION · Studio 空白页标题/结论可编辑

日期：2026-07-17

## 问题

便利贴墙「加一页」后进入 Studio「搜索」Tab：标题「新增空白页」、关键结论「请补充本页核心结论」为**静态文案**，没有输入框。用户无法改元信息 → 无法有效检索 → 无法生成初稿。

「初稿」Tab 虽有 title/keyMessage 控件，但每键 `updateSlide` 且占 `busy`，空白页体验仍差；搜索 Tab 完全不可编。

## 方案对比

| 方案 | 做法 | 权重 | 结论 |
|------|------|------|------|
| **A** | Studio 搜索/初稿统一可编辑表单（title / keyMessage / contentPoints）+ debounce/blur 保存 `updateSlide`；检索/生成前 flush | **~90** | **选用** |
| B | 仅弹窗编辑元信息 | ~40 | 不做：打断搜索工作流，空白页仍先看到静态区 |

便利贴墙双击改标题：成本高于本轮收益，**延后**；Studio 可编辑即可闭环。

## 后端确认（检索读 slide 字段）

`POST /api/projects/:id/slides/:slideId/search` 从 DB 取当前 slide，再交给 adapter：

- `researchAdapter.searchPage(slide, …)` 或 `adapter.generatePageSearch(slide, …)`
- `mockPageSearch` 使用 `slide.title`、`slide.keyMessage`、`slide.contentPoints[0]`、`slide.slideGoal`

因此前端先 `updateSlide` 落库，再点「重新搜索本页」，检索一定吃到最新标题/结论。无需改 API 契约。

`UpdateSlideInput`（`updateSlideSchema`）已含：`title?`、`keyMessage?`、`contentPoints?` 等。

## 改动摘要

| 层 | 文件 | 变更 |
|----|------|------|
| web | `apps/web/src/pages/StudioPage.tsx` | 搜索/初稿共用 `SlideMetaEditor`；本地草稿 + 450ms debounce + blur flush；缺省空白页轻提示；检索/初稿动作前 `flushMetaSave` |
| store | `apps/web/src/store/workbenchStore.ts` | `updateSlide` 乐观更新、**不占 busy**，失败回滚，避免输入时禁用生成按钮 |

## 交互

1. **搜索 Tab**：可编标题、关键结论、内容要点（每行一条）；缺标题/仍为默认空白文案时提示「先填写标题与核心结论再检索」。
2. **初稿 Tab**：同上表单 + 原有线框预览。
3. **重新搜索本页 / 全部检索 / 生成本页初稿**：先 flush 未保存草稿，再调 API。
4. 切页 / 卸载：尽量 flush 当前页。

## 未做

- 便利贴墙内联/双击改标题（可选增强）。
- 搜索结果卡片「用于初稿」勾选持久化（原有 readOnly，本轮不动）。

## 验证

```text
corepack pnpm --filter @ppt-agent/web typecheck
```

手动：加空白页 → Studio 搜索 Tab 改标题与结论 → 「重新搜索本页」→ 查询词/资料卡应反映新标题；初稿 Tab 同步可见同一字段。

## 根因一句话

搜索阶段把 slide 元信息当只读摘要渲染，空白页无法补全检索输入。
