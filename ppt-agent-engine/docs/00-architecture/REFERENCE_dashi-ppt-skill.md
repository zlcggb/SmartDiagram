# 参考项目分析：dashi-ppt-skill（2026-07-17）

本地路径：`references/dashi-ppt-skill/`（浅克隆，已 gitignore）  
上游：<https://github.com/chuspeeism/dashi-ppt-skill>  


---

## 0. 方案选择

| 方案 | 做法 | 权重 | 决策 |
|------|------|------|------|
| **A（选用）** | 浅克隆到 `references/` + 写 REFERENCE（颜色/主题/生成/导出） | **~90** | **执行** |
| B | 只读网页不克隆 | ~30 | 否：无法核对 skill 脚本、manifest、导出入口 |



---

## 1. 仓库结构概览

```text
dashi-ppt-skill/
├── README.md / README.en.md     # 产品说明、12 主题、流程、许可
├── npm-dist/                    # npx 安装器
└── skills/dashi-ppt/            # Agent Skill 本体（当前约 0.4.3）
    ├── SKILL.md                 # Agent 工作流硬规则（最重要）
    ├── README.md                # 面向用户的短说明
    ├── assets/skill/            # 主题网格预览图等
    ├── references/              # options / layout-roles / goal-spec schema
    ├── scripts/                 # render_goal_deck.sh|.ps1、版本检查
    └── project/                 # 本地生成器（Node 20+）
        ├── package.json         # layout:query / render:goal / export:pptx …
        ├── layout-manifest.json # 1020 版式契约（含 controls）
        ├── src/                 # React 编排、主题元数据、控制台命名
        │   └── components/themes/theme01…theme12/
        ├── dist/theme-runtime/  # 各主题打包后的运行时模块
        ├── assets/template-swiss.html  # 预览/编辑器壳（右侧控制台）
        └── packages/html-deck-to-pptx/ 
```

**定位一句话**：不是「LLM 自由画 SVG」，而是 **预置主题版式库 + JSON 填文案（goal.json）→ 渲染离线 HTML Deck（自带编辑控制台）→ 本机浏览器导出 PPTX/PDF**。

体量约 82MB；根 `.gitignore` 已忽略整个 `references/`。

---

## 2. 主题 / 颜色如何控制

### 2.1 三层颜色模型

| 层 | 机制 | 说明 |
|----|------|------|
| **整套主题（themePack）** | `theme01`…`theme12` | 生成前选定；决定版式库、视觉语言、默认 token |
| **主题内设计 token** | 如 `theme01` 的 `THEME` + scoped CSS（`--aip-*`） | 墨色、系列色、字号、间距；样式作用域在主题根类（如 `.aip-root`），避免泄漏 |
| **页级控制台配色** | `layout-manifest` / metadata 里的 `controls` | 右侧面板：滑杆/开关/下拉；含 `accentColor`、`palette`、`scheme` 等**枚举色**，非任意取色器 |

README FAQ 明确：**自定义样式刻意限制在预设范围**——「稳定产出比自由选色更重要」。

### 2.2 12 套主题

| key | 名称（摘要） | 适合场景（摘要） |
|-----|--------------|------------------|
| theme01 | 轻拟态 | 产品/企业汇报 |
| theme02 | 炫光紫绿 | 科技发布 / AI |
| theme03 | 深浅代码 | 技术方案 |
| theme04 | 玻璃糖果 | 年轻化品牌 |
| theme05 | 色谱图表 | 数据报告 |
| theme06 | 深色图谱 | 高密度战略 |
| theme07 | 冷白调研 | 白皮书/调研 |
| theme08 | 黑金实验 | 高端品牌 |
| theme09 | 深蓝杂志 | 品牌故事 |
| theme10 | 金色指数 | 金融投资（Skill 默认自动选时慎用） |
| theme11 | 高能增长 | 增长/路演 |
| theme12 | 声波霓虹 | 娱乐潮流 |

每主题约 70–110 页版式，合计 **1020** 个 `layout`（如 `theme01_page001`）。封面只能从该主题前 5 页选 1 页；正文从第 6 页起；同一 deck 内 `layout` 不得重复。

### 2.3 页级配色控件（控制台）

从 `layout-manifest.json` 抽样：

- 约 **229/1020** 页带 `accentColor`（`select`/`color`，选项为预设 hex）。
- 其它颜色相关 publicKey 还包括：`palette`、`paletteVariant`、`scheme`、`colorMode`、`barColor`、`bgColor`、`tint` 等（按版式出现）。
- 控件元数据进入渲染后的 HTML：`[data-prop-controls]`；预览壳 `template-swiss.html` 读这些控件画右侧面板，改动写回 props / 自动保存。

**Agent 默认规则**（`SKILL.md`）：普通生成只填文案 `copyKeys` / 可见数组 / 媒体槽，**不要**改配色、数量、显隐等 control；仅用户明确要求时才动 `controlKeys`。

### 2.4 与「整套换肤」的关系

- 生成时：`goal.json` 顶层 `themePack`。
- 交付 deck 默认**不**对用户暴露主题切换；调试才开 `preview.themeSwitcher`。
- 用户要整套换风：由 Agent **重选 themePack + 重新选 layout 填稿**（不是简单 CSS 全局换肤）。

---

## 3. 生成链路（Skill 流程）

```text
需求描述
  → 确认 themePack（展示 theme-style-grid.png）+ 是否需要图/视频
  → 整理 goal.json（title/goal/audience/pageCount/themePack/slides[]）
  → layout:query（按 theme + role 抽候选）/ inspect:layout / props:safe
  → validate:goal-spec → render:goal（composeDeck + renderDeck）
  → 输出 output/<deck>/ppt/index.html + assets/
  → validate:swiss + validate:goal-copy
  → 启动本机预览 HTTP（含导出/自动保存 API）
  → 浏览器内编辑（文案/媒体/控制台）或 Agent 返工
  → 导出 HTML 离线包 / PDF / 可编辑 PPTX
```

### 3.1 核心契约：`goal.json`

每页是 **`layout` + `props`**，不是自由 HTML slide：

```json
{
  "themePack": "theme01",
  "randomSeed": "…",
  "slides": [
    { "layout": "theme01_page001", "props": { "titleTop": "…", "lead": "…" } }
  ]
}
```

- `role` 仅草稿选页用，渲染前必须落成具体 `layout`。
- 文案长度受 `fillPlan` / `copyBudgets` 约束；Html 字段只允许 `<br>` / `<b>` / `<em>`。
- 长稿可先 `goal:scaffold` 出骨架与 `fill-plan`，再分段填 props。

### 3.2 「产物即编辑器」

预览不是纯静态站：必须用 skill 自带 preview server（导出、自动保存）。`file://` 打不开可编辑 PPTX 导出。顶栏：放映 / 明暗 / 重置；左侧缩略图可重排；每页右侧控制台约 20+ 维。

---

## 4. 导出 PPTX 大致机制（公开可读部分）

### 4.1 两条入口

| 入口 | 路径 | 说明 |
|------|------|------|
| UI | `POST /api/export-editable-pptx`（preview 服务） | 同源鉴权；本机 Chrome 导出 |
| CLI | `npm run export:pptx -- <ppt目录> out.pptx` | `export-pptx.mjs`：临时起 preview → Playwright → 引擎 |

PDF：同脚本 `--pdf` / `export:pdf`（截图式）。

依赖：**本机 Chrome / Chromium / Edge**（`CHROME_PATH`）+ `playwright-core`。

### 4.2 引擎架构主张（README + 包 README）

子包 `project/packages/html-deck-to-pptx`：

- 输入：已渲染 HTML deck URL（DOM 契约约 `#deck > .slide`，active 页带 `.active`）。
- 策略口号：**逐节点保真回退链**——能映射的做可编辑对象；映射不了的区域截图，但**从实时 DOM 抽回文字保持可编辑（非 OCR）**。
- 公共 API 形态：`exportEditablePptxFromUrl(browser, url, options)`。
- 依赖栈可见：`pptxgenjs`、`html-to-image`、Playwright 等。



### 4.3 可编辑性边界（其自身表述）

> PPT 无法拥有 HTML 全量能力，但尽量保留可编辑性。

即：**HTML 表现力优先，PPTX 为交付降级**；动画/玻璃/复杂背景等可能变图，文字尽量可改。这与我们 Hybrid「IR 保底 + SVG 视觉 + 按页编译」是不同赛道的同类问题。

---

## 5. 与 ppt-agent-engine（Hybrid IR/SVG）对比与可借鉴建议

| 维度 | dashi-ppt-skill | ppt-agent-engine（现状） |
|------|-----------------|--------------------------|
| 中间态 | React 主题版式 + goal props | Slide IR +（可选）可编译 SVG |
| 视觉来源 | 预置 1020 页组件库 | LLM 生成 SVG / IR 渲染 |
| 颜色 | 12 主题 token + 页级枚举控件 | 少量导出主题 + `themeRecolor` 近似换色 |
| 编辑 UX | 每页右侧控制台 + 就地改字 + 媒体槽 | Studio / Board；主题侧栏仍弱 |
| 导出 | HTML→DOM→专有引擎→PPTX | pptxgenjs + SVG 编译/降级三模式 |

### 5.1 高 ROI 可借鉴

1. **主题配置放设计稿右侧（用户已提方向）**  
   对齐 dashi「每页控制台」：Studio 右侧放「主题包 / 强调色枚举 / 明暗」——控件是**有限选项**，避免无限色盘导致幻灯片不一致。

2. **生成前强制选风 + 网格预览**  
   Brief/开稿一步展示主题卡（类 `theme-style-grid`），减少「生成完才发现风格不对」。

3. **锁模板填文案**  
   对「可编辑保真」页优先：版式固定、只换文案与数据；自由 SVG 留给 `visual` 模式。与我们 `draft/standard/visual` 可映射。

4. **一键导出入口始终可见**  
   预览顶栏或 Export 页：HTML/PDF/PPTX 分清能力与可编辑等级（我们已有 `editableGrade` / pageResults，可强化文案）。

5. **页角色（role）选版式池**  
   cover / metrics / comparison… 与 Board 分区可对照，减少 LLM 乱排结构。

6. **配色策略：主题内系列色 + accent 枚举**  
   比「全局 hex 重写」更稳；可演进我们的 `themeRecolor`：从双主题近似映射 → 有限 accent 预设。

---
---

## 7. 本地更新

```bash
cd references/dashi-ppt-skill
git pull
```

对照文档：本文；执行记录见同目录 `EXECUTION_reference-dashi-clone-2026-07-17.md`。

相关本仓文档：

- [REFERENCE_svg2pptx_analysis.md](./REFERENCE_svg2pptx_analysis.md)（SVG→DrawingML 另一赛道）
- [HYBRID_IR_SVG_STRATEGY.md](./HYBRID_IR_SVG_STRATEGY.md)
- [COMPILABLE_SVG.md](./COMPILABLE_SVG.md)
