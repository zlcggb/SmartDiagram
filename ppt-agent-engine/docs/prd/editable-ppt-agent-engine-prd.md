# 可编辑 PPT Agent 引擎 PRD

## 1. 文档信息

- 产品名称：可编辑 PPT Agent 引擎
- 文档版本：v1.0
- 当前阶段：MVP 标准化方案
- 目标用户：几乎没有 AI 使用经验、只希望直接生成可修改 PPT 的普通业务用户
- 核心原则：最终 PPT 中的标题、正文、卡片、表格、流程线、指标块必须优先使用 PowerPoint 原生文本框和形状，SVG 只作为预览、视觉参考或复杂装饰兜底

## 2. Problem Statement

普通业务用户需要制作项目周报、售前方案、产品介绍等演示文稿，但他们通常不擅长写提示词，也不熟悉 PPT 结构设计、页面策划和视觉排版。现有 AI PPT 工具常见问题包括：

- 输出看起来像 PPT，但文字和形状不可编辑，后续修改困难。
- 直接根据一句话生成整份 PPT，缺少需求澄清和业务语境理解。
- 页面内容容易堆叠，逻辑不清、信息密度失控。
- SVG 或图片页面虽然视觉效果好，但在 PowerPoint 中的编辑体验不稳定。
- 用户不知道失败原因，只会感觉按钮没反应或结果不可用。

本产品要解决的问题是：让普通用户通过极低门槛输入资料，生成一份结构清晰、视觉专业、内容可继续编辑的 PPTX。

## 3. Solution

产品采用“模型策划 + 结构协议 + 原生 PPTX 渲染”的架构。

整体流程：

1. 用户选择场景并粘贴资料。
2. 系统根据场景补问少量必要问题。
3. Gemini 负责资料理解、事实提取、大纲规划、单页策划和视觉布局建议。
4. Gemini 不直接生成最终 PPTX，而是输出结构化 Slide IR。
5. 系统将 Slide IR 渲染为 PowerPoint 原生文本框、形状、表格、线条和图表。
6. Gemini 生成的 SVG 作为每页视觉预览和复杂装饰参考，不作为最终可编辑内容的主来源。
7. 每页生成后执行质量检查，发现文字溢出、结构缺失、布局不合法时自动修复或提示用户。

目标体验：

- 用户不需要懂 prompt。
- 用户不需要知道 SVG、JSON、IR、PPTX 渲染等技术细节。
- 用户打开导出的 PPT 后，可以直接修改文字、拖动卡片、调整形状和表格。

## 4. Goals

- 支持从粘贴文本生成可编辑 PPTX。
- 支持 Gemini API 自动生成大纲、页面策划、布局 JSON 和 SVG 预览。
- 支持项目周报、售前方案、产品介绍三个第一阶段场景。
- 支持按页生成、按页重试、按页重生成。
- 支持基础页面质检：结构完整性、文本长度、元素数量、布局合法性。
- 支持 PPTX 导出，主要内容为 PowerPoint 原生对象。
- 支持 API Key 后端配置，不暴露到前端。

## 5. Non-Goals

以下内容不进入第一阶段：

- 多人协作、账号权限、团队空间。
- 完整模板商城。
- 全量 PDF、Word、网页链接解析。
- 复杂动态图表和高级数据分析。
- 完全自由拖拽式 PPT 编辑器。
- 追求所有 SVG 元素 100% 转成 PPT 原生对象。
- 让 Gemini 直接生成最终 PPTX 文件。

## 6. Target Users

### 6.1 普通业务用户

特征：

- 不懂 AI 提示词。
- 不知道 PPT 结构设计方法。
- 希望直接得到一份能改的 PPT。

核心诉求：

- 少填信息。
- 少做选择。
- 生成结果能用、能改、能交付。

### 6.2 售前/项目/产品人员

特征：

- 经常需要把项目资料、会议纪要、产品文档变成 PPT。
- 对内容准确性和可编辑性要求高。

核心诉求：

- 逻辑清楚。
- 能快速改客户名称、数据、计划和风险。
- 风格专业，不像随机 AI 拼图。

### 6.3 产品维护者

特征：

- 需要低成本接入 Gemini。
- 需要在模型输出不稳定时保持产品可控。

核心诉求：

- 模型调用可替换。
- 输出结构可校验。
- PPT 渲染结果可测试。

## 7. User Stories

1. As a 普通业务用户, I want 选择一个 PPT 场景, so that 我不用自己设计大纲结构。
2. As a 普通业务用户, I want 粘贴一段资料就能开始, so that 我不需要学习复杂 prompt。
3. As a 普通业务用户, I want 系统只问必要问题, so that 我不会被表单吓退。
4. As a 普通业务用户, I want 看到页面草稿, so that 我能先确认逻辑是否正确。
5. As a 普通业务用户, I want 一键生成 PPTX, so that 我可以直接打开 PowerPoint 使用。
6. As a 普通业务用户, I want PPT 里的文字是普通文本框, so that 我能直接修改标题和正文。
7. As a 普通业务用户, I want PPT 里的卡片是普通形状, so that 我能拖动、改色、调整大小。
8. As a 普通业务用户, I want 生成失败时看到中文原因, so that 我知道下一步该怎么做。
9. As a 项目经理, I want 生成项目周报, so that 我能快速汇报进展、风险和下周计划。
10. As a 项目经理, I want 系统识别风险和待确认事项, so that 我不会遗漏需要客户确认的问题。
11. As a 售前顾问, I want 生成售前方案, so that 我能快速形成客户可读的解决方案初稿。
12. As a 售前顾问, I want 系统把客户痛点、方案价值和实施路径分开表达, so that PPT 更容易说服客户。
13. As a 产品经理, I want 生成产品介绍, so that 我能快速说明产品定位、功能、优势和场景。
14. As a 产品经理, I want 每页都有核心结论, so that PPT 不只是资料堆砌。
15. As a 用户, I want 可以只重生成某一页, so that 我不用因为一页不好而重做整份 PPT。
16. As a 用户, I want 看到 SVG 预览, so that 我能快速判断视觉方向。
17. As a 用户, I want 最终文件不是整页图片, so that 我能继续编辑交付版本。
18. As a 用户, I want 页面内容不要溢出, so that 导出的 PPT 看起来专业。
19. As a 用户, I want 页面信息太多时系统自动拆页, so that 每页都能读得清楚。
20. As a 产品维护者, I want Gemini 输出结构化 JSON, so that 后端可以稳定校验和渲染。
21. As a 产品维护者, I want 模型调用集中在 agents 模块, so that 后续可以替换模型供应商。
22. As a 产品维护者, I want PPT 渲染器只依赖 Slide IR, so that 渲染逻辑可测试、可复用。
23. As a 产品维护者, I want 支持 Mock Adapter, so that 没有 API 或 API 不稳定时仍能开发和演示。
24. As a 产品维护者, I want Gemini API Key 只存在后端环境变量, so that 密钥不会泄露给浏览器。

## 8. Core Product Workflow

### 8.1 创建项目

用户填写：

- 项目名称
- PPT 场景
- 目标受众
- 使用目的
- 期望页数
- 风格偏好

系统行为：

- 创建项目记录。
- 进入资料输入步骤。
- 未创建项目时，只允许停留在第一步。

### 8.2 输入资料

第一阶段支持：

- 粘贴文本

后续扩展：

- PDF
- Word
- Markdown
- 网页链接

内部抽象为 SourceDocument：

- type
- title
- rawText
- chunks
- metadata

### 8.3 事实提取

Gemini 从资料中提取：

- 背景
- 目标
- 进展
- 风险
- 关键数据
- 待确认事项
- 下一步计划
- 可用于 PPT 的事实

输出必须结构化，供用户确认和后续引用。

### 8.4 大纲生成

Gemini 根据场景、受众、目的、资料事实生成整份 PPT 大纲。

要求：

- 结论先行。
- 每个章节有明确目的。
- 每页有核心信息。
- 页数符合用户期望。

### 8.5 单页策划

每页生成 Slide Plan：

- 页面标题
- 页面目标
- 核心结论
- 内容块
- 引用事实
- 推荐版式
- 信息优先级

### 8.6 页面布局

Gemini 生成 Slide IR，而不是直接生成最终 PPTX。

Slide IR 必须描述：

- 页面尺寸
- 主题 token
- 元素列表
- 坐标
- 文本
- 样式角色
- 层级关系

### 8.7 SVG 预览

Gemini 可基于同一页 Slide Plan 生成 SVG 预览。

使用方式：

- 用户预览视觉方向。
- 系统参考布局比例。
- 复杂装饰可作为兜底素材。

限制：

- 主标题、正文、卡片、表格不以 SVG 作为最终编辑源。

### 8.8 PPTX 渲染

渲染器读取 Slide IR，生成 PPTX。

映射规则：

- text -> PowerPoint 文本框
- card -> PowerPoint 矩形 + 文本框
- metric -> 数字文本框 + 标签文本框 + 背景形状
- table -> PowerPoint 表格或形状网格
- timeline -> 线条 + 节点形状 + 文本框
- process -> 箭头/线条 + 卡片
- icon -> 可选 SVG 或图标字体兜底
- decoration -> 可选 SVG/图片兜底

## 9. Slide IR Standard

### 9.1 Slide IR 顶层结构

```json
{
  "version": "1.0",
  "slideId": "string",
  "slideType": "bento_summary",
  "canvas": {
    "width": 1280,
    "height": 720
  },
  "theme": "consulting_blue",
  "title": "string",
  "keyMessage": "string",
  "elements": [],
  "speakerNotes": "string",
  "qualityHints": []
}
```

### 9.2 Element 类型

第一阶段支持：

- text
- card
- metric
- table
- timeline
- process
- divider
- badge
- icon
- svgDecoration

### 9.3 坐标标准

- Gemini 使用 1280 x 720 坐标。
- 渲染器统一转换为 PowerPoint 宽屏尺寸。
- 所有元素必须在画布内。
- 元素之间最小间距建议为 20px。

### 9.4 可编辑等级

- L1：完全原生可编辑，文本框和形状均为 PPT 原生对象。
- L2：主要内容原生可编辑，少量图标/装饰使用 SVG。
- L3：整页图片或整页 SVG，仅允许作为临时预览，不作为正式输出。

第一阶段正式导出目标为 L1/L2。

## 10. Gemini Prompt Chain

### 10.1 Prompt 1: 需求澄清

输入：

- 场景
- 用户原始描述

输出：

- 已知信息
- 缺失信息
- 最多 3 个必要问题

### 10.2 Prompt 2: 资料提取

输入：

- 用户资料
- 场景
- 受众
- 目的

输出：

- 结构化事实
- 风险
- 待确认事项
- 可用于 PPT 的内容

### 10.3 Prompt 3: 大纲生成

输入：

- 项目信息
- 已确认事实
- 期望页数

输出：

- 封面
- 目录
- 章节
- 页面列表
- 结束页

### 10.4 Prompt 4: 单页策划

输入：

- 大纲中的某一页
- 相关事实
- 场景规则

输出：

- Slide Plan
- 推荐布局
- 内容块
- 信息优先级

### 10.5 Prompt 5: Slide IR 生成

输入：

- Slide Plan
- 主题 token
- 布局约束

输出：

- 可校验的 Slide IR JSON

### 10.6 Prompt 6: SVG 预览生成

输入：

- Slide Plan
- Slide IR
- 风格 token

输出：

- 1280 x 720 SVG

用途：

- 预览视觉。
- 作为复杂装饰参考。
- 不作为主内容最终编辑源。

### 10.7 Prompt 7: 质量检查与修复

输入：

- Slide IR
- 页面约束

输出：

- 问题列表
- 修复后的 Slide IR
- 是否建议拆页

## 11. Functional Requirements

### 11.1 项目创建

- 用户可以创建 PPT 项目。
- 创建成功后必须返回真实 projectId。
- 前端必须跳转到真实项目地址。
- 创建失败时显示中文错误。

### 11.2 Gemini API 接入

- 后端读取 GEMINI_API_KEY。
- 前端不得接触 API Key。
- API 不可用时返回中文错误。
- 支持 Mock Adapter 和 Real Gemini Adapter 切换。
- 支持结构化 JSON 输出校验。

### 11.3 页面生成

- 支持按页生成。
- 支持单页重试。
- 支持单页重生成。
- 支持保存每页 Slide Plan、Slide IR、SVG Preview。

### 11.4 PPTX 导出

- 导出文件为 .pptx。
- 标题、正文、卡片、表格、流程线优先为 PowerPoint 原生对象。
- 导出路径需要记录在项目中。
- 前端展示下载链接。

### 11.5 错误处理

需要覆盖：

- 数据库不可用。
- Gemini API Key 缺失。
- Gemini API 调用失败。
- Gemini 返回 JSON 不合法。
- Slide IR 校验失败。
- PPTX 渲染失败。
- 页面内容过多。

错误文案必须面向普通用户。

## 12. Non-Functional Requirements

### 12.1 可编辑性

正式导出的 PPTX 中：

- 正文必须是普通文本框。
- 卡片必须是普通形状。
- 表格优先使用原生表格或形状网格。
- SVG 不得承载主要正文信息。

### 12.2 稳定性

- 模型输出必须经过 schema 校验。
- 不合格输出必须重试或修复。
- 重试次数需要限制，避免成本失控。

### 12.3 性能

MVP 目标：

- 6 页以内 PPT，生成时间可接受目标为 1-3 分钟。
- 单页重生成目标为 10-30 秒。

### 12.4 成本

- 默认减少高成本调用。
- SVG 预览可按需生成。
- 支持缓存每页中间结果。

### 12.5 安全

- API Key 仅保存在后端环境变量。
- 不在日志中打印完整密钥。
- 用户输入和模型输出需要基础长度限制。

## 13. Implementation Decisions

### 13.1 模块划分

建议模块：

- Agent Orchestration：负责 prompt chain、模型调用、重试、结构化输出。
- Source Processing：负责粘贴文本、未来 PDF/Word 的统一资料抽象。
- Slide Planning：负责大纲、单页策划、事实引用关系。
- Slide IR Schema：负责页面协议、Zod 校验、版本管理。
- SVG Preview Generator：负责每页视觉预览。
- PPT Renderer：负责将 Slide IR 渲染为原生 PPTX。
- Quality Checker：负责页面结构、文本长度、元素重叠、可编辑等级检查。
- Export Manager：负责导出记录、文件存储、下载链接。

### 13.2 技术路线

- Gemini 用于理解、策划、结构化生成和 SVG 预览。
- PptxGenJS 或同类库用于生成 PPTX。
- 后端集中封装 Gemini 调用。
- 前端只调用业务 API。
- Slide IR 是模型与渲染器之间的稳定契约。

### 13.3 为什么不让 Gemini 直接生成 PPTX

- PPTX 文件结构复杂。
- 直接生成文件稳定性低。
- 可编辑性和兼容性难保证。
- 不利于逐页重试、质检和自动修复。

### 13.4 为什么保留 SVG

- SVG 适合让 Gemini 表达视觉创意。
- SVG 适合作为页面预览。
- SVG 适合作为复杂背景和装饰兜底。
- SVG 不适合作为主内容的唯一编辑源。

## 14. Testing Decisions

### 14.1 测试原则

- 测试外部行为，不测试模型内部思考。
- 测试 schema 合法性、渲染结果、错误处理和用户流程。
- Mock Gemini 输出要覆盖成功、格式错误、内容过多、缺字段等情况。

### 14.2 必测模块

- Slide IR Schema 校验。
- PPT Renderer 映射。
- Quality Checker。
- Gemini Adapter 错误处理。
- 项目创建与页面流程。
- PPTX 导出链路。

### 14.3 验收测试

至少覆盖：

- 创建项目后跳转真实 projectId。
- 粘贴文本后可生成事实。
- 可生成大纲。
- 可生成单页策划。
- 可生成 Slide IR。
- 可导出 PPTX。
- 导出的 PPTX 中标题和正文为可编辑文本。
- 导出的 PPTX 中卡片为可编辑形状。
- Gemini API 缺失时显示中文错误。
- JSON 不合法时系统可以重试或提示。

## 15. UX Requirements

### 15.1 面向普通用户的主流程

页面不展示技术术语。

建议步骤：

1. 选择用途。
2. 粘贴资料。
3. 确认重点。
4. 查看页面草稿。
5. 生成 PPT。

### 15.2 不展示给普通用户的概念

- SVG
- Slide IR
- JSON
- prompt chain
- Gemini Adapter
- schema validation

### 15.3 用户可见文案原则

- 用中文解释问题。
- 给出下一步行动。
- 不暴露原始堆栈错误。

示例：

- “项目创建失败：数据库未初始化或无法打开，请检查后端数据库配置。”
- “页面内容过多，系统已建议拆成两页。”
- “AI 返回的页面结构不完整，正在重新生成。”

## 16. Metrics

### 16.1 产品指标

- 从输入资料到成功导出 PPTX 的完成率。
- 用户是否下载 PPTX。
- 用户是否重生成某页。
- 用户是否修改页面草稿。

### 16.2 质量指标

- PPTX 可编辑对象占比。
- 页面质检通过率。
- 文本溢出率。
- 模型输出 schema 合法率。
- 单页重试次数。

### 16.3 成本指标

- 每份 PPT 平均 Gemini 调用次数。
- 每份 PPT 平均生成耗时。
- 每份 PPT 平均 token 成本。

## 17. Milestones

### 17.1 M1: 稳定本地闭环

目标：

- 修复数据库和项目创建链路。
- 支持项目创建、资料输入、事实提取、大纲、单页策划、PPTX 导出。
- 使用 Mock Gemini Adapter。

### 17.2 M2: Slide IR 和原生 PPTX 渲染

目标：

- 定义 Slide IR v1。
- 改造 PPT Renderer 读取 Slide IR。
- 支持 text、card、metric、table、timeline、process。
- 确保主要内容可编辑。

### 17.3 M3: Gemini API 自动链路

目标：

- 接入 Real Gemini Adapter。
- 支持后端环境变量 GEMINI_API_KEY。
- 支持结构化 JSON 输出。
- 支持失败重试和中文错误。

### 17.4 M4: SVG 逐页预览

目标：

- 每页生成 SVG Preview。
- 前端展示预览。
- 支持用户按页重生成。

### 17.5 M5: 三个场景标准化

目标：

- 项目周报。
- 售前方案。
- 产品介绍。
- 每个场景有独立问题、结构、页面类型和质量规则。

## 18. Acceptance Criteria

MVP 完成标准：

- 用户可以创建真实项目。
- 用户可以粘贴资料。
- 系统可以基于资料生成大纲。
- 系统可以生成每页策划稿。
- 系统可以生成结构化 Slide IR。
- 系统可以导出 PPTX。
- PPTX 中主要文字为普通文本框。
- PPTX 中主要卡片为普通形状。
- SVG 只作为预览或装饰，不承载主要正文。
- 项目周报场景至少能生成 5-6 页完整 PPT。
- Gemini API Key 不暴露到前端。
- 模型失败、数据库失败、渲染失败都有中文错误提示。

## 19. Risks

### 19.1 Gemini 输出不稳定

应对：

- 使用 JSON Schema。
- 使用 Zod 校验。
- 设置重试和修复 prompt。
- 保留 Mock Adapter。

### 19.2 可编辑性和视觉质量冲突

应对：

- 第一阶段优先可编辑。
- 复杂视觉使用装饰兜底。
- 建立可编辑等级。

### 19.3 文本溢出

应对：

- 限制每类元素字数。
- 自动摘要。
- 自动拆页。
- 渲染前质量检查。

### 19.4 成本不可控

应对：

- 缓存中间结果。
- SVG 按需生成。
- 限制页数和重试次数。

### 19.5 Office/WPS 兼容差异

应对：

- 早期建立样例 PPTX。
- 在 PowerPoint 和 WPS 中手动验证。
- 避免过度依赖复杂透明、阴影和嵌套对象。

## 20. Further Notes

这款产品的核心护城河不是某一段提示词，而是：

- 场景化需求澄清。
- 结构化 PPT 策划流程。
- 可校验的 Slide IR。
- 原生 PPTX 渲染能力。
- SVG 视觉预览能力。
- 页面质检和修复能力。

一句话定位：

让不懂 AI 的普通用户，通过粘贴资料，生成一份视觉专业且真正可编辑的 PowerPoint。
