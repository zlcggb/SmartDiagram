# EXPERIENCE · PPT-Agent Web 导航与工作流重设计

日期：2026-07-18

相关文档：

- `ppt-agent-engine/apps/web/src/main.tsx` — 当前路由表
- `ppt-agent-engine/apps/web/src/store/workbenchStore.ts` — 当前全局状态
- `ppt-agent-engine/apps/web/src/pages/StudioPage.tsx` — Studio 页实现
- `ppt-agent-engine/apps/web/src/pages/BriefPage.tsx` — 需求确认页
- `ppt-agent-engine/apps/web/src/pages/BoardPage.tsx` — 便利贴墙页
- `ppt-agent-engine/docs/04-article-studio-redesign/EXPERIENCE_article-studio-ia.md` — Studio 信息架构

---

## 1. 问题陈述

当前 Web 端把 PPT 创作拆成了 5 个平级页面：

```text
/                 首页
/p/:id/brief      需求确认 + 视觉选择
/p/:id/paste      粘贴资料 + 提取事实
/p/:id/board      便利贴墙 / 大纲
/p/:id/studio     单页设计
/p/:id/export     导出历史
```

实际使用中出现以下「绕」的感觉：

1. **页面职责重叠**
   - 首页创建项目时已经能粘贴资料并保存到 `sourceText`。
   - 到了 `brief` 页，用户仍然在处理内容。
   - 独立的 `paste` 页变成了“再加一次资料”的机会，而不是必经之路。
   - 结果是：用户不知道“该在哪一步贴资料”。

2. **阶段与页面没有一一对应**
   - `brief` 页内部有两个阶段（questions → visual），但 URL 不变，刷新后可能卡在中间态。
   - `board` 是“大纲”，`studio` 是“单页设计”，但两者都可以改 slides，用户不确定什么时候该回 board。

3. **导出被做成了“目的地”**
   - 真正的导出动作在 `studio` 里完成。
   - `export` 页只是历史下载列表，单独占一个路由显得多余。

4. **URL 状态与 Store 状态双轨并行**
   - Studio 同时维护 `selectedSlideId`（store）和 `?slide=`（URL），导致加载竞态。
   - 用户刷新或分享链接时，容易落到第一页。

5. **每个页面都自己加载项目**
   - Brief/Paste/Board/Studio/Export 各写一遍 `useEffect(() => loadProject(projectId))`。
   - 这增加了竞态概率，也让“当前项目”这个状态没有统一的入口。

---

## 2. 核心思路：从“流水线”到“三层草稿”

PPT 创作不是严格的线性流水线，而是**三层逐渐细化的草稿**：

```text
┌─────────────────────────────────────────────────────────┐
│  Layer 0 · 意图（Intent）                                │
│  主题、受众、目的、参考资料                              │
│  → 产物：项目 + 需求摘要 + sourceText                    │
├─────────────────────────────────────────────────────────┤
│  Layer 1 · 结构（Structure）                             │
│  章节、页面、故事线、每页核心结论                        │
│  → 产物：slides[]（大纲态）                              │
├─────────────────────────────────────────────────────────┤
│  Layer 2 · 表达（Expression）                            │
│  单页设计、视觉稿、渲染策略、导出                        │
│  → 产物：svgPreview / irJson / pptx                      │
└─────────────────────────────────────────────────────────┘
```

这三层不是“必须一步到下一步”，而是：

- 用户可以从 Layer 0 直接跳到 Layer 2（AI 全自动）。
- 用户也可以从 Layer 2 随时回 Layer 1 改大纲。
- 每一层内部都有“AI 建议”和“人工确认”两个动作。

---

## 3. 新的导航模型：4 个空间 + 1 个动作

### 3.1 空间（Space）概念

不再用“页面”称呼，而称“空间”：

| 空间 | URL | 对应原页面 | 主要职责 |
|------|-----|------------|----------|
| **Start** | `/` | Home | 创建项目，输入初始意图和资料。 |
| **Intent** | `/p/:id/intent` | brief + paste | 确认需求、补充资料、决定视觉方向。 |
| **Structure** | `/p/:id/structure` | board | 管理章节与页面，确认故事线。 |
| **Studio** | `/p/:id/studio?slide=xxx` | studio | 单页设计、预览、主题微调。 |
| **Export** | 不再作为独立空间 | export | 降级为 Studio 的“导出抽屉/弹窗”，历史记录也嵌入其中。 |

### 3.2 关键设计原则

1. **URL 只表达“空间”和“选择”，不表达内部阶段**
   - 例如 `intent` 内部可以有多个标签页（需求、资料、视觉），但标签页状态用 `?tab=` 或锚点，不单独占路由。
   - 这样刷新后不会卡在“questions 还是 visual”的模糊状态。

2. **Studio 的当前页完全由 URL 决定**
   - 删除 `selectedSlideId` store 字段。
   - 当前 slide = `useSearchParams().get('slide')` 或 slides[0]。
   - 分享链接时直接复制 `?slide=xxx`。

3. **资料是全局资产，不是步骤**
   - 在 `intent` 页提供“资料面板”，但 Studio 也可以侧边展开资料面板。
   - 不要在导航上把“贴资料”做成一个必经步骤。

4. **导出是动作，不是空间**
   - 导出按钮常驻在 Studio 工具条。
   - 导出历史作为抽屉或弹窗，不独占路由。
   - 如果未来需要分享“下载中心”，可以单独开 `/p/:id/downloads`，但默认不走这里。

---

## 4. 详细路由设计

### 4.1 最终路由表

```tsx
// main.tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<StartPage />} />
    <Route path="/p/:projectId/*" element={<ProjectWorkspace />}>
      <Route index element={<Navigate to="intent" replace />} />
      <Route path="intent" element={<IntentSpace />} />
      <Route path="structure" element={<StructureSpace />} />
      <Route path="studio" element={<StudioSpace />} />
      <Route path="exports" element={<ExportsSpace />} /> {/* 可选，默认隐藏 */}
      <Route path="*" element={<Navigate to="intent" replace />} />
    </Route>
    <Route path="/projects/:projectId" element={<LegacyProjectRedirect />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
</BrowserRouter>
```

### 4.2 嵌套路由 + 统一外壳

新增 `ProjectWorkspace` 作为 `/p/:projectId/*` 的 layout：

- 统一加载项目（取代各页自己 `loadProject`）。
- 提供顶部导航，在 Intent / Structure / Studio 之间切换。
- 处理错误、loading、AI 用量等全局状态。

```tsx
function ProjectWorkspace() {
  const { projectId } = useParams();
  const { loadProject, project, busy, error } = useProjectStore();

  useEffect(() => {
    if (projectId) loadProject(projectId);
  }, [projectId]);

  if (!project) return <FullScreenLoading />;

  return (
    <ProjectShell>
      <Outlet />
      <ProgressPanel />
    </ProjectShell>
  );
}
```

### 4.3 空间内部标签

#### Intent Space

URL: `/p/:id/intent?tab=brief`（默认）

内部标签：

- `brief`：需求问答（原 BriefPage 的 questions 阶段）。
- `source`：资料与事实（原 PastePage 的功能）。
- `visual`：视觉方向选择（原 BriefPage 的 visual 阶段）。

设计意图：

- 用户进入项目后，先看到的不是“问题清单”，而是“ Intent 工作台”，三个标签分别对应“你想说什么、你有什么资料、你想长什么样”。
- 标签顺序反映推荐流程，但允许跳转。
- 当 `brief` 完成且选择了 `visual`，底部显示“进入结构工作台”主按钮。

#### Structure Space

URL: `/p/:id/structure`

- 继承原 BoardPage 的“章节 + 页面”横向画布。
- 但弱化“便利贴”隐喻，强化“这是故事线”的认知。
- 提供一键生成大纲、拖拽排序、增删页面。
- 点击任意页面 → 跳转 `/p/:id/studio?slide=xxx`。

#### Studio Space

URL: `/p/:id/studio?slide=xxx&phase=search|draft|design`

- `slide` 参数：当前正在编辑的页面 ID。
- `phase` 参数：当前工作阶段（检索素材 / 生成初稿 / 设计出图）。
- 不再用 store 的 `studioPhase`，URL 即阶段状态。
- 导出以抽屉/弹窗形式出现，不跳转路由。

---

## 5. 状态归属重新划分

| 状态 | 当前归属 | 新归属 | 说明 |
|------|----------|--------|------|
| `project` | workbenchStore | projectStore | 项目元数据。 |
| `slides` | workbenchStore | slideStore | 章节与页面列表。 |
| `selectedSlideId` | workbenchStore | URL `?slide=` | 选择状态由 URL 唯一决定。 |
| `studioPhase` | workbenchStore | URL `?phase=` | 阶段由 URL 唯一决定。 |
| `sourceText` / `facts` | workbenchStore | sourceStore | 资料与事实。 |
| `exportTheme` / `accent` / `surface` | workbenchStore | themeStore | 主题与视觉配置。 |
| `busy` / `progressStages` | workbenchStore | progressStore | 进度与全局 loading。 |
| `error` | workbenchStore | 各空间局部或 progressStore | 避免全局错误互相覆盖。 |

### 5.1 为什么 selectedSlideId 和 studioPhase 应该放进 URL

- 可分享：用户可以把“我正在设计第 5 页”的链接直接发给同事。
- 可刷新：刷新后不会丢失上下文。
- 可前进后退：浏览器前进/后退自然记录创作路径。
- 减少竞态：store 和 URL 不再有两份真相。

---

## 6. 顶部导航与面包屑设计

### 6.1 新顶部导航

```text
[PPT Agent]  [当前项目名 ▼]  ─────────────────────  [Intent] [Structure] [Studio]  [全部自动生成 ✨]
```

- 三个空间名称用英文或中文皆可，但建议用含义明确的词：
  - 意图 / 结构 / 工作室
  - 或 需求 / 大纲 / 设计
- 当前空间高亮。
- 未完成的空间允许访问，但给出“你还没完成需求确认”的轻提示。

### 6.2 进度提示

- 在三个导航项之间加入一条隐式进度线：
  - 灰色：未开始
  - 蓝色：进行中
  - 完成：已完成
- 这样用户一眼就知道自己在哪一层。

---

## 7. 用户流程示例

### 7.1 快速全自动路径

```text
首页输入主题 → 创建项目 → /p/:id/intent（brief 标签）
→ AI 生成问题 → 用户随便回答 → 选择视觉主题
→ 点击“进入结构” → AI 生成大纲
→ 点击“进入工作室” → 点击“全部自动生成” → 导出
```

### 7.2 深度编辑路径

```text
首页输入主题 + 粘贴资料 → 创建项目 → /p/:id/intent/source
→ 确认/编辑资料 → 提取事实 → 切到 brief 回答问题
→ 进入结构 → 手动调整章节和页面 → 进入 studio
→ 逐页修改 meta / plan / 设计 → 导出
```

### 7.3 从 studio 回结构

```text
在 studio 发现某页放错章节 → 顶部导航点“结构”
→ 在 structure 拖拽调整 → 顶部导航回到 studio
→ 继续设计
```

---

## 8. 对现有代码的迁移影响

### 8.1 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `main.tsx` | 替换为嵌套路由表。 |
| 新增 `ProjectWorkspace.tsx` | 统一项目加载与外壳。 |
| 新增 `ProjectShell.tsx`（重构） | 接收 `Outlet`，提供导航。 |
| `BriefPage.tsx` | 拆成 `IntentSpace` 的 `BriefTab` 子组件。 |
| `PastePage.tsx` | 拆成 `IntentSpace` 的 `SourceTab` 子组件。 |
| `BoardPage.tsx` | 重命名为 `StructureSpace`。 |
| `StudioPage.tsx` | 大幅瘦身，只保留布局容器；编辑逻辑拆到子组件。 |
| `ExportPage.tsx` | 可选保留为 `/exports`，但推荐改为 `Studio` 的导出抽屉。 |
| `workbenchStore.ts` | 拆分为 domain slices。 |

### 8.2 不需要立即改的地方

- 后端 API 路径不变。
- Slide 数据结构不变。
- 主题包、渲染策略、导出模式不变。
- 进度 SSE 机制不变（但建议从 store 抽到 progress service）。

---

## 9. 推荐的实施顺序

1. **P0：路由骨架**
   - 引入 `ProjectWorkspace` + 嵌套路由。
   - 把 `loadProject` 抽到 workspace 层。
   - 保留旧页面作为子组件，先不改内部逻辑。

2. **P1：URL 作为选择真相源**
   - Studio 的 `selectedSlideId` 改为从 URL 读取。
   - `studioPhase` 改为从 URL 读取。
   - 删除 store 中的对应字段。

3. **P2：合并 Intent 空间**
   - 把 Brief 的 questions 和 visual 拆成 `IntentSpace` 的 tab。
   - 把 Paste 的功能作为 `source` tab。
   - 此时不再保留 `/brief` 和 `/paste` 路由，用 redirect 兼容旧链接。

4. **P3：Structure 空间**
   - 把 BoardPage 改名并迁入嵌套路由。
   - 调整顶部导航顺序为 Intent → Structure → Studio。

5. **P4：导出降级为动作**
   - 把 Studio 的导出按钮抽出 `ExportDrawer`。
   - 导出历史从独立页面移到抽屉内。
   - 可选保留 `/exports` 作为隐藏入口。

6. **P5：视觉与 Store 重构**
   - 在导航稳定后，再拆 `workbenchStore`。
   - 统一设计系统 token。

---

## 10. 风险与回退

| 风险 | 缓解 |
|------|------|
  用户 bookmarks 了旧路由 `/p/:id/brief` | 保留 redirect：`/p/:id/brief` → `/p/:id/intent?tab=brief` |
| 旧页面中硬编码的 `navigate('/p/:id/board')` | 全局搜索替换为新的 structure URL |
| 移除 `selectedSlideId` 后部分子组件依赖 | 提供 `useCurrentSlide()` hook，内部读取 URL |
| 改动范围大 | 按 P0–P5 分批，每批单独验证 |

---

## 11. 结论

当前导航“绕”的本质是：**把创作流程硬切成多个平级页面，而页面之间没有清晰的分层关系**。建议把 Web 端重新组织为 **“三层草稿”模型**，并通过 **嵌套路由 + URL 作为选择真相源** 来实现：

- **Intent**（意图）：主题、资料、视觉方向。
- **Structure**（结构）：章节、页面、故事线。
- **Studio**（表达）：单页设计、预览、导出。

导出不再独占空间，而是 Studio 内的动作。项目加载统一到 workspace 层。这样用户的心智负担会明显降低，URL 也会更稳定、可分享。
