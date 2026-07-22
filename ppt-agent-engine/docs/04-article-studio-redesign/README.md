# 04 · 文章式 PPT Agent 工作室重设计

## 阶段目标

把 5 步表单向导改成**顾问工作室**：主题调研 / 粘贴资料双入口 → Brief → 便利贴墙 → Studio（搜索｜初稿｜设计稿；设计稿右侧主题配置，工具条右上角一键导出）→ 导出历史。**不回退** P0–P2 导出能力（UI 不再暴露 draft/standard/visual）。

完整设计总览见根目录 [DESIGN_文章式PPT_Agent工作室.md](../DESIGN_文章式PPT_Agent工作室.md)。

## 文档清单

| 文档 | 类型 | 说明 |
|------|------|------|
| [EXECUTION_article-studio-redesign.md](./EXECUTION_article-studio-redesign.md) | 执行 | Phase A/B/C 落地与路由表 |
| [EXECUTION_sticky-board-layout.md](./EXECUTION_sticky-board-layout.md) | 执行 | 便利贴墙点阵画布（早期 columns 混排） |
| [EXECUTION_sticky-board-rows.md](./EXECUTION_sticky-board-rows.md) | 执行 | **现行**：一行一章 + 横向排页 + 同行拖拽 |
| [EXECUTION_board-add-page-section.md](./EXECUTION_board-add-page-section.md) | 执行 | 加一页 vs 加章节分流（partTitle + 插入位） |
| [EXECUTION_board-hover-insert.md](./EXECUTION_board-hover-insert.md) | 执行 | 行内悬停插入槽 + Studio `?slide=` 选页修正 |
| [EXECUTION_studio-editable-blank.md](./EXECUTION_studio-editable-blank.md) | 执行 | Studio 搜索/初稿可编 title·keyMessage·contentPoints |
| [EXPERIENCE_article-studio-ia.md](./EXPERIENCE_article-studio-ia.md) | 经验 | 工作室 IA 可复用做法 |
| [EXPERIENCE_sticky-board-whiteboard.md](./EXPERIENCE_sticky-board-whiteboard.md) | 经验 | 白板混排 vs 大纲列表 |
| [EXPERIENCE_sticky-board-rows.md](./EXPERIENCE_sticky-board-rows.md) | 经验 | 行列看板 + 拖拽归位 |
| [EXPERIENCE_board-add-page-section.md](./EXPERIENCE_board-add-page-section.md) | 经验 | 加页必须带分组键 |
| [EXPERIENCE_board-hover-insert.md](./EXPERIENCE_board-hover-insert.md) | 经验 | 悬停插入槽 + deep-link 防竞态 |
| [EXPERIENCE_studio-editable-meta.md](./EXPERIENCE_studio-editable-meta.md) | 经验 | 页元信息可编辑 + flush 后再检索 |
| [EXECUTION_studio-panel-scroll-2026-07-18.md](./EXECUTION_studio-panel-scroll-2026-07-18.md) | 执行 | Studio 三列视口锁定 + 中间栏内滚 + sticky 下一步 |
| [EXPERIENCE_studio-panel-scroll.md](./EXPERIENCE_studio-panel-scroll.md) | 经验 | overflow 需限高；Grid 子项要 min-h-0 |
| [EXECUTION_draft-from-search-2026-07-18.md](./EXECUTION_draft-from-search-2026-07-18.md) | 执行 | 初稿注入已选检索卡 + 可编辑 planJson |
| [EXPERIENCE_draft-from-search.md](./EXPERIENCE_draft-from-search.md) | 经验 | 递进链路必须接下一步产物，禁止复述上一步输入 |
| [EXECUTION_export-scope-no-autofill-2026-07-18.md](./EXECUTION_export-scope-no-autofill-2026-07-18.md) | 执行 | 导出支持当前页/已完成页；默认不自动补稿 |
| [EXPERIENCE_export-must-not-autofill.md](./EXPERIENCE_export-must-not-autofill.md) | 经验 | 导出≠流水线；缺页应提示并缩范围 |
| [EXECUTION_restore-strategy-switch-2026-07-18.md](./EXECUTION_restore-strategy-switch-2026-07-18.md) | 执行 | 恢复 IR/SVG/混合切换；批量按各页策略 |
| [EXPERIENCE_strategy-switch-vs-bulk-generate.md](./EXPERIENCE_strategy-switch-vs-bulk-generate.md) | 经验 | 批量生成勿绑定当前页策略 |
| [EXECUTION_fix-progress-sse-base-url-2026-07-18.md](./EXECUTION_fix-progress-sse-base-url-2026-07-18.md) | 执行 | 进度 SSE 误打 Vite:5173 刷 404 |
| [EXPERIENCE_sse-must-share-api-base.md](./EXPERIENCE_sse-must-share-api-base.md) | 经验 | SSE 与业务共用 getApiBase |
| [EXECUTION_search-all-parallel-map-2026-07-18.md](./EXECUTION_search-all-parallel-map-2026-07-18.md) | 执行 | 全部检索 LangGraph 风格有限并发 |
| [EXPERIENCE_langgraph-map-without-framework.md](./EXPERIENCE_langgraph-map-without-framework.md) | 经验 | 先同构 map-reduce，再决定是否上框架 |
| [EXECUTION_export-to-studio-theme.md](./EXECUTION_export-to-studio-theme.md) | 执行 | 导出页=历史；设计稿右栏主题+一键导出（早期） |
| [EXECUTION_export-button-toolbar-2026-07-17.md](./EXECUTION_export-button-toolbar-2026-07-17.md) | 执行 | **现行**：一键导出进设计稿工具条右上角；侧栏仅重生 |
| [EXPERIENCE_export-to-studio-theme.md](./EXPERIENCE_export-to-studio-theme.md) | 经验 | 配置贴预览、mode 藏后端、主题同步 SVG |
| [EXPERIENCE_export-button-placement.md](./EXPERIENCE_export-button-placement.md) | 经验 | 导出跟工具条；历史走顶栏；重生跟主题侧栏 |
| [EXECUTION_dashi-inspired-integration.md](./EXECUTION_dashi-inspired-integration.md) | 执行 | Dashi 启发：自研 ThemePack + 版式角色 + 提示词（合规）一期 |
| [EXECUTION_dashi-core-integration-2026-07-17.md](./EXECUTION_dashi-core-integration-2026-07-17.md) | 执行 | Dashi 核心薄适配二期：12 主题 / 角色扩展 / accent / copyBudgets |
| [EXECUTION_layout-variant-library-2026-07-17.md](./EXECUTION_layout-variant-library-2026-07-17.md) | 执行 | **三期**：精选版式变体库 + queryLayouts + renderer 全 layout |
| [EXECUTION_layout-skeleton-frames-2026-07-18.md](./EXECUTION_layout-skeleton-frames-2026-07-18.md) | 执行 | **四期**：34 变体真实坐标 JSON + fill/snap IR |
| [EXPERIENCE_layout-skeleton-frames.md](./EXPERIENCE_layout-skeleton-frames.md) | 经验 | 骨架文件为真相；提示词+normalize 双锁几何 |
| [EXECUTION_studio-theme-config-ia-2026-07-17.md](./EXECUTION_studio-theme-config-ia-2026-07-17.md) | 执行 | Studio 主题配置 IA：分层侧栏 + 质感预设 + 导出 accent |
| [EXPERIENCE_dashi-inspired-theme-layout.md](./EXPERIENCE_dashi-inspired-theme-layout.md) | 经验 | AGPL 对照后自研主题/角色落地要点 |
| [EXPERIENCE_dashi-core-integration.md](./EXPERIENCE_dashi-core-integration.md) | 经验 | 二期加深：网格、accent 枚举、enum 单一来源 |
| [EXPERIENCE_layout-variant-library.md](./EXPERIENCE_layout-variant-library.md) | 经验 | 变体剪影逼近锁模板；勿误判为再抄配色 |
| [EXPERIENCE_studio-theme-config-sidebar.md](./EXPERIENCE_studio-theme-config-sidebar.md) | 经验 | 学竞品 IA 不学皮肤；只暴露真实即时能力 |
| [SEARCH_ADAPTER.md](./SEARCH_ADAPTER.md) | 接口 | ResearchAdapter 切换点与升级建议 |

## 完成事项时间线（2026-07-17）

| Phase | 事项 |
|-------|------|
| A | Home 双入口；Brief；Board + partTitle；Outline Architect 提示词 |
| B | Studio 三 Tab；页检索资料卡；初稿/设计分流 |
| C | `run-pipeline`；Agent 日志；ResearchAdapter |
| Preserve | 继续 `export-pptx`；页策略可切换（IR/SVG/混合）；UI 固定 standard |
| 导出 IA | 导出页仅历史；设计稿右栏主题配置；**工具条右上角一键导出**；日志折叠 |
| Board UI | 便利贴墙：点阵画布、**一行一章 / 横向排页**、同行拖拽、选中工具条、Contents |
| Board 加页 | **加一页**（同章 + partTitle/afterSlideId）与 **加章节** 分流；工具条同章加页 |
| Board 悬停插 | 内容卡右侧 / 章末 **hover 虚线加号槽**；阶段图标进 Studio 固定用该卡 `slide.id` + `?slide=` |
| Studio 可编 | 搜索/初稿统一可编标题·结论·要点；debounce/blur `updateSlide`；检索前 flush；空白页轻提示 |
| Dashi 启发 | 自研 6 ThemePack + layout blueprint；Outline/Plan/Design 强制角色模版；Home/Studio 选主题 |
| Dashi 核心二期 | 12 ThemePack + accent 枚举 + copyBudgets + 角色扩展；Home 主题网格；renderer 共用 themeFamily |
| 版式变体三期 | ~40 精选剪影 + queryLayouts；blueprint 构图规范；copyBudgets 硬门禁；IR 主题模板对齐 18 layout |
| 坐标骨架四期 | 34× JSON 帧；锁几何填槽；normalize snap；mock/fallback 走 skeleton |
| 主题配置 IA | 设计稿右栏分层（族/包/accent/质感/文案说明）；质感 CSS 预览；导出传 accentId |
| Studio 内滚 | 三列大屏锁 `100dvh`；检索/初稿长内容栏内滚；下一步条 sticky |
| 初稿递进 | 已选 search 卡进 plan prompt；初稿可编辑；页意图在步骤 2 只读 |
| 导出范围 | `slideIds` + `fillMissing=false`；未就绪弹层；工具条「导出当前页」 |
| 策略可选 | 设计稿恢复 IR/SVG/混合切换；「按策略全部生成」 |
| 检索并行 | search-all 有限并发 fan-out（LangGraph 同构，未引框架） |

## 关键路由速查

| 路径 | 页 |
|------|----|
| `/` | Home |
| `/p/:id/brief` | 需求 |
| `/p/:id/paste` | 资料 |
| `/p/:id/board` | 便利贴墙 |
| `/p/:id/studio` | 工作室 |
| `/p/:id/export` | 导出历史（下载） |

← [03 P2](../03-p2-grade-usage/README.md) · [文档中心](../README.md)
