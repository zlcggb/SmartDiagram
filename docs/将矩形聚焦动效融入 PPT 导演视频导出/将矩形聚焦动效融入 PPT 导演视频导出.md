# 将矩形聚焦动效融入 PPT 导演视频导出

## 背景

你在 `docs/edit-narrated-video` 中积累了一套成熟的视频剪辑技巧（Skill），其中核心能力之一是 **矩形聚焦（Focus Box）动效**——在 PPT 讲解视频中，根据当前演讲内容自动高亮幻灯片上的特定区域（文本块/图表/卡片），周围区域压暗，配合字幕与旁白同步出现。如截图所示，矩形高亮框聚焦在标题文字上，箭头指向高亮区域。

目前 `edit-narrated-video` Skill 是一个 **Agent 侧技能**（给 Codex/AI Agent 用来剪辑视频），它与产品内的导演模块（`ExportsSpace`）是**两条完全独立的链路**。

## 现有导演链路分析

```
导演三阶段：
  ① 演讲稿（主模型生成）→ ② 配音（TTS）→ ③ 导出视频（FFmpeg）

视频生成链路：
  ExportsSpace UI → api.exportVideo() 
    → POST /api/projects/:id/export-video
    → media.ts: renderSlidePng（静态页面截图）
                 buildSubtitleCues（按字数切分字幕）
                 renderSubtitleOverlayPng（字幕条 PNG）
                 renderNarratedClip（FFmpeg：静态图 + 音频 + 字幕叠加）
                 concatVideoClips（拼接所有页）
```

**关键观察**：当前链路是 **静态图片 + 字幕叠加** 模式，每页只有一张 PNG 截图，没有任何「页内动效」的概念。字幕是唯一的时间轴元素。

## Skill 中的聚焦框能力

`edit-narrated-video` Skill 提供了完整的聚焦框生产流水线：

| 组件 | 文件 | 能力 |
|------|------|------|
| 几何提取 | `scripts/focus_boxes.py extract` | 从 PPTX 解析所有形状/文本框/表格单元格的精确坐标 |
| 语义锚定 | `scripts/focus_boxes.py resolve` | 从演讲稿中的锚点文本，匹配到 PPTX 形状 ID 和坐标 |
| QA 门禁 | resolve `--fail-on-qa` | 覆盖率 ≥ 98%、紧凑度 ≥ 0.35、防溢出检测 |
| 渲染 | Remotion 组合层 / FFmpeg | 压暗 + 矩形高亮 + 可选相机运动 |

> [!IMPORTANT]
> **Skill 当前是面向 Codex Agent 的离线手工流程**，需要人工写 `anchors` JSON 来指定每段演讲对应哪个区域。产品化需要 **自动化锚点生成**。

---

## Phase 1 实施状态（已完成 + 修复）

### 决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 锚点生成方式 | **方案 B 规则匹配**（先 B 后 A） | 零 LLM 开销，V1 先跑通链路 |
| 几何来源 | **SVG 路径**（regex 解析 `<text>` 元素） | 视频渲染本身用 SVG→PNG，坐标系一致 |
| 聚焦效果 | **压暗 + 矩形边框高亮** | 最基础、最可靠 |
| V1 手动编辑 | **不做** | 先全自动，后续 Phase 2 |
| 代码位置 | 不新建 `packages/focus-box`，直接放入现有模块 | 减少包管理开销，成熟后再拆 |

### 已变更文件

| 变更 | 文件 | 状态 |
|------|------|------|
| [MODIFY] schema 扩展 | `packages/shared/src/index.ts` | ✅ `videoExportSchema` 加 `focus` 字段 |
| [NEW] 聚焦遮罩渲染器 | `packages/ppt-renderer/src/focusOverlay.ts` | ✅ + 🔧 修复 |
| [MODIFY] 导出 | `packages/ppt-renderer/src/index.ts` | ✅ 导出 `renderFocusOverlayPng` |
| [NEW] 聚焦框引擎 | `apps/service-ppt-renderer/src/lib/focusBox.ts` | ✅ + 🔧 修复 |
| [MODIFY] FFmpeg 管线 | `apps/service-ppt-renderer/src/lib/video.ts` | ✅ 支持 `focusOverlays` 叠加层 |
| [MODIFY] 导出路由 | `apps/service-ppt-renderer/src/routes/media.ts` | ✅ 集成聚焦框生成 |
| [MODIFY] 前端开关 | `apps/web/.../ExportsSpace.tsx` | ✅ 聚焦动效 checkbox |
| [MODIFY] 前端 API | `apps/web/.../lib/api.ts` | ✅ `focus` 参数透传 |

### 已发现并修复的问题

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | 遮罩 PNG 完全透明，压暗效果不可见 | SVG `<mask>` 在 resvg-js 中不可靠 | 改用 `fill-rule="evenodd"` + 双矩形路径挖洞 |
| 2 | 聚焦事件全部为空，无任何聚焦框产出 | `extractAnchorsFromNarration` 从短字幕 cue 中提不到关键词 | 新增 `extractAnchorsFromCue` 专门处理短句 + 全文 fallback |
| 3 | 聚焦依赖字幕开启，无字幕时不工作 | `localCues` 在 `subtitles=false` 时为空 | 传入 `durationMs` 做全文级 fallback |

---

## 原计划 vs 实际：需要修改的部分

### ~~A. 新建 `packages/focus-box` 独立包~~

**实际**：没有新建独立包。聚焦遮罩渲染器放在了 `packages/ppt-renderer`（因为它和 `renderSubtitleOverlayPng` 是同类），聚焦框引擎放在了 `apps/service-ppt-renderer/src/lib/`（只在后端导出时使用）。

**修改建议**：维持现状。如果未来 Phase 2 需要前端预览聚焦框，再考虑将 `focusBox.ts` 提取到共享包。

### ~~B. FFmpeg drawbox 滤镜方案~~

原计划建议用 FFmpeg 的 `drawbox` 滤镜直接在视频帧上画暗化区：
```
[base]drawbox=c=black@0.55:t=fill:enable='between(t,S,E)'[dimmed]
[dimmed]drawbox=x=X:y=Y:w=W:h=H:c=replace:t=fill:enable='between(t,S,E)'[focused]
```

**实际**：采用了 **PNG 遮罩叠加方案**——预渲染聚焦遮罩为带 alpha 通道的 PNG，再用 FFmpeg `overlay` filter 叠加。

**修改理由**：
- PNG 方案能精确实现圆角矩形描边（drawbox 只支持直角）
- 遮罩 PNG 和字幕 PNG 使用相同的叠加机制，代码统一
- 抗锯齿效果更好

### ~~C. 前端聚焦模式选择（自动/手动）~~

原计划包含聚焦模式 radio：`○ 自动  ○ 手动`。

**实际 V1**：只做了一个 checkbox 开关「矩形聚焦动效」，无模式选择。

**修改建议**：V1 保持简单。手动模式属于 Phase 2，需要 UI 编辑聚焦区域。

---

## Phase 2 计划（待实施）

> [!IMPORTANT]
> 以下是原计划中尚未实施的部分，需要根据 V1 实际效果决定优先级。

### 2.0 FFmpeg 可靠时间轴试行（2026-08-02）

已改用“最终音频转写对齐 → 语义 cue → 确定性 SVG 几何 → FFmpeg overlay”。

- `WHISPER_CPP_PATH` 与 `WHISPER_MODEL_PATH` 同时配置时，对最终 TTS 音频做本地转写；
- 作者原文通过编辑距离对齐回转写 token 的实测时间戳，字幕仍显示审定原文；
- 覆盖率低于 `0.78`、只有静音检测、或只有整页时长时，聚焦 fail-closed；
- 聚焦/字幕区间会向外取整帧，输出固定 H.264 High + `yuv420p` + AAC；
- 所有页合并后完整解码视频和音频流，任一缺失或损坏都会使导出失败；
- `.focus.json` 记录全局/页内时间、对齐来源、覆盖率、匹配 ID、几何 QA 和拒绝原因。
- 当前只放行已审计的 SVG 文字几何；`container` 目标在容器形状提取与 QA 完成前明确拒绝，不会假装成文字框。

实测使用 whisper.cpp base 对第 1 页最终音频对齐，作者文案覆盖率为 `0.832`，平均 token 置信度为 `0.941`，通过聚焦时间轴门禁。

### 2.1 SVG 文本提取精度提升

**当前问题**：regex 提取 `<text>` 元素的宽度是估算值（字符数 × 平均字宽），与实际渲染宽度有偏差。

**改进方向**：
- 使用 resvg-js 或 canvas 实际度量文本宽度
- 或者在 SVG 设计阶段给关键元素添加 `data-focus-label` 属性（可在 SVG 生成 prompt 中加入）

### 2.2 LLM 自动锚点生成（原计划方案 A）

在 `writeSlideScriptNarration` 生成演讲稿时，同时输出结构化的聚焦锚点：

```json
{
  "script": "大家好，今天我们围绕...",
  "focusAnchors": [
    { "text": "安全架构梳理", "segment": 0 },
    { "text": "三层安全隔离", "segment": 1 }
  ]
}
```

**优势**：LLM 能理解语义关系（如"看右边的图表"），规则方法做不到。

### 2.3 手动聚焦编辑 UI

在导演阶段提供可视化编辑：
- 显示每页的聚焦框预览
- 拖拽调整聚焦框位置/大小
- 添加/删除聚焦事件
- 调整时间轴

### 2.4 QA 门禁

移植 `focus_boxes.py` 的 QA 检测：
- 覆盖率检查（≥ 98% 的锚点都能匹配到形状）
- 紧凑度检查（聚焦框面积 / 画面面积 ≥ 0.35 发出警告）
- 溢出检测（聚焦框不能超出画面边界）

### 2.5 聚焦效果升级

| 效果层级 | 描述 | 优先级 |
|----------|------|--------|
| 压暗 + 矩形边框 | 当前 V1 实现 | ✅ |
| 渐入渐出过渡 | 聚焦框切换时 200ms fade | P1 |
| 下划线高亮 | 对文本行加下划线而非整块压暗 | P2 |
| 相机运动 | scale + translate 模拟镜头推拉 | P3 |

---

## 工作量预估（修订后）

| 阶段 | 工作项 | 原预估 | 修订预估 | 状态 |
|------|--------|--------|----------|------|
| Phase 1 | TS 聚焦框引擎 | 2-3 天 | 1 天 | ✅ 已完成 |
| Phase 1 | FFmpeg 聚焦渲染 | 1 天 | 0.5 天 | ✅ 已完成 |
| Phase 1 | 后端集成 | 1 天 | 0.5 天 | ✅ 已完成 |
| Phase 1 | 前端开关 | 0.5 天 | 0.3 天 | ✅ 已完成 |
| Phase 1 | Bug 修复（resvg mask + 锚点提取） | — | 0.5 天 | ✅ 已完成 |
| Phase 2 | LLM 自动锚点 | 1-2 天 | 1-2 天 | 待定 |
| Phase 2 | 手动聚焦编辑 UI | 2-3 天 | 2-3 天 | 待定 |
| Phase 2 | 聚焦效果升级（渐变/相机） | — | 1-2 天 | 待定 |
| Phase 2 | QA 门禁 | — | 0.5 天 | 待定 |

## Verification Plan

### Automated Tests
- 单元测试：聚焦框引擎的几何解析、锚点匹配、QA 门禁
- 集成测试：FFmpeg 聚焦渲染输出帧抽样验证
- 端到端：导演导出一个 3 页项目的带聚焦视频，验证聚焦框出现在正确时间段

### Manual Verification
- 用现有项目在导演阶段导出带聚焦的视频
- 对比无聚焦 vs 有聚焦的视觉效果
- 验证聚焦框与字幕的碰撞避让
