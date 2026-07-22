# 参考项目分析：ppt-master / svg2pptx-skill（2026-07-17）

## 1. 要不要拉下来？

### 方案对比

| 方案 | 做法 | 权重 | 说明 |
|------|------|------|------|
| A | 两个完整仓都 clone 进仓库并跟踪 | 35 | 体积大、脚本重复、污染主仓 |
| **B（选用）** | `references/` 浅克隆 + gitignore；skill 完整、ppt-master 只留 docs | **88** | 够对照学习，不拖垮仓库 |

已执行方案 B。

本地路径：

- `references/svg2pptx-skill/`（完整浅克隆）
- `references/ppt-master/`（稀疏：主要是文档）
- 根 `.gitignore` 已忽略整个 `references/`

## 2. 两个项目是什么关系？

```text
ppt-master（完整产品：文档→大纲→SVG→质检→DrawingML PPTX→动画/旁白/模板）
    └── svg2pptx-skill（抽出「最后一公里」：SVG → 可编辑 PPTX）
```

对当前 **PPT-Agent**（已有 TS 工作台 + Gemini + pptxgenjs）来说：

- **最值得学**：`svg2pptx-skill` 的质检契约与 DrawingML 编译管线
- **ppt-master 全量产品流程**：不必合并进本仓；文档级对照即可

## 3. 它们怎么做（原理）

统一思想：**不是把 SVG 当图片塞进 PPT，而是把「项目约定子集的 SVG」编译成 DrawingML 原生对象。**

```text
LLM 写「可编译 SVG」
  → svg_quality_checker（硬门禁，失败则改 SVG）
  → finalize_svg（图标嵌入、tspan 规整、roundRect→path 等）
  → svg_to_pptx（直接写 OOXML / DrawingML）
  → 打开即可编辑，无需 Office「转换为形状」
```

关键契约文件：`references/svg2pptx-skill/references/shared-standards.md`  
映射总表：`references/ppt-master/docs/powerpoint-svg-mapping.md`

支持较好的元素：`rect/circle/ellipse/line/path/polygon/polyline/text(+tspan)/image(部分)/渐变/箭头 marker`  
明确禁止：`style/class`、`mask`、`foreignObject`、`symbol+use`（图标例外）、`textPath`、动画脚本等。

## 4. 和当前 PPT-Agent 对照

| 维度 | PPT-Agent（现状） | svg2pptx-skill / ppt-master |
|------|-------------------|-----------------------------|
| 语言栈 | TypeScript + pptxgenjs | Python + 直接写 DrawingML XML |
| 中间态 | Gemini SVG（另有 Slide IR） | 项目约定 SVG（canonical SVG） |
| 解析 | 正则扫 `text/rect/circle/line/path` | XML 树 + 完整 convert 模块（~9k 行） |
| 质检 | sanitize 幻觉文本为主 | `svg_quality_checker` 硬门禁（~1.6k 行） |
| 渐变/箭头/分组 | 弱 / 部分 | 有系统映射（gradFill、headEnd、`<g>`→组） |
| 产品形态 | Web 工作台 + 事实确认流水线 | Agent skill / CLI 流水线 |
| 与本项目契合点 | 已选「SVG→原生」方向 | **同一赛道的更成熟编译器** |

结论：方向一致；参考价值在 **「可编译 SVG 契约 + 导出前质检 + DrawingML 能力边界」**，不是整仓搬迁。

## 5. 有没有必要「集成」进 PPT-Agent？

| 选项 | 建议 | 理由 |
|------|------|------|
| 把 Python 转换器当子进程直接调用 | 可试点，非第一优先 | 能力强，但多运行时、部署变重 |
| 把 `shared-standards` 规则迁到 TS 质检 | **推荐优先** | 与现有 `prompts.ts` / renderer 同栈 |
| 放弃 pptxgenjs，全面改 DrawingML | 暂不 | 重写成本高；先补契约与门禁 ROI 更高 |
| 把 ppt-master 整产品流程并进来 | 不建议 | 场景不同（文档 Agent vs 周报工作台） |

### 建议吸收清单（按 ROI）

1. **P0**：把 `shared-standards` 缩成「PPT-Agent 可编译 SVG 子集」，写进 Gemini 提示词 + 导出前检查  
2. **P0**：导出前硬门禁（禁止 `style`/`foreignObject`/`mask` 等），失败提示重生成，而不是静默丢元素  
3. **P1**：补齐箭头 marker、基础 linearGradient、`<g>` 分组语义（若继续走 SVG 主路径）  
4. **P2**：用 `examples/*.svg` 做回归：同一 SVG 分别跑 skill 与本仓 renderer，对比可编辑对象数  
5. **可选**：Python sidecar 仅作「高保真对照导出」，不替换主链路

## 6. 体积与维护提醒

- `svg2pptx-skill` ~2.3MB：值得保留、可随时 `git pull`
- `ppt-master` docs ~69MB：偏重；若磁盘紧，可只留  
  `docs/powerpoint-svg-mapping.md`、`docs/technical-design.md`、`docs/zh/`  
- **不要**把 `references/` 提交进主仓；需要时各自 clone

## 7. 一句话

值得拉 **作参考**，尤其是 `svg2pptx-skill`；不值得把两个完整产品仓并进主工程。  
PPT-Agent 应继续走「SVG→原生」方向，优先抄它们的 **契约与质检门禁**，而不是立刻换掉 TypeScript/pptxgenjs 栈。

## 8. 与 IR 的关系（补充）

不是 SVG 取代 IR。推荐策略见 [`HYBRID_IR_SVG_STRATEGY.md`](./HYBRID_IR_SVG_STRATEGY.md)：  
**IR 管内容骨架与降级，SVG 管视觉编排与丰富度，按页选用。**
