# Excalidraw 自动布局调研报告

## 问题分析

从截图和代码来看，当前 Excalidraw 图表绘制混乱的**根本原因**是：

> **LLM 在手动计算每个元素的 `x, y` 坐标 —— 这是一项 LLM 天生不擅长的工作。**

查看 [excalidraw_agent.py](file:///Users/zora/app/DeepDiagram-Pro/SmartDiagram/backend/app/agents/excalidraw_agent.py)，prompt 要求 LLM 直接输出带精确坐标的 JSON 数组，包含 `x, y, width, height, points` 等数值。对于复杂图表（如微服务架构图），LLM 需要同时算对十几个节点的位置和箭头路由 —— **这就是连线杂乱、布局混乱的核心原因**。

## 现有方案对比

| 方案 | 原理 | 代码量影响 | 渲染性能 | 推荐度 |
|------|------|-----------|---------|--------|
| **① 当前：LLM 直接输出坐标** | LLM 手算 x/y | 最少 | 快 | ⭐ 差 |
| **② Mermaid → Excalidraw** | LLM 输出 Mermaid 文本 → 前端自动布局 | 新增 ~100 行 | 快 | ⭐⭐⭐⭐⭐ |
| **③ elkjs/dagre 手动集成** | LLM 输出节点+边 → 前端用布局引擎算坐标 | 新增 ~300 行 | 快 | ⭐⭐⭐⭐ |
| **④ excalidraw-dsl** | 需要 Rust 编译的 CLI 工具 | 引入外部依赖 | 快 | ⭐⭐ |

### ① 当前方案问题（LLM 直接输出坐标）

```
LLM prompt → 生成完整 ExcalidrawElement[] JSON（含 x, y, points）→ 前端直接渲染
```

- LLM 不善精确数值计算，尤其对复杂图的布局
- 节点越多越乱，箭头路由全靠 LLM "猜"
- 输出 JSON 很长（一个节点 ~10 行），token 消耗大

### ② 推荐方案：Mermaid → Excalidraw（最佳性价比）

```
LLM prompt → 输出 Mermaid 文本 → parseMermaidToExcalidraw() → convertToExcalidrawElements() → 渲染
```

**关键优势：**
- **LLM 只需输出简短的 Mermaid 文本**，不需要计算坐标（如 `A[客户端] --> B[API 网关]`）
- **自动布局由 Mermaid + dagre 引擎处理**，布局算法成熟稳定
- 项目已安装 `@excalidraw/mermaid-to-excalidraw` 包
- 官方 Excalidraw 团队维护的库，API 稳定
- Token 消耗大幅降低（Mermaid 文本 vs 完整 JSON 可达 **10:1** 压缩）
- 支持 flowchart、sequence、class 等常见图表类型

**代码量评估：**
- 后端 prompt 改为输出 Mermaid：改动 ~30 行
- 前端新增 Mermaid→Excalidraw 转换逻辑：新增 ~80 行
- 总计约 **100 行改动**

**渲染性能：**
- `parseMermaidToExcalidraw()` 解析 + 布局通常 < 200ms
- 与当前大量 JSON 解析相比，甚至更快

### ③ elkjs/dagre 手动集成

```
LLM prompt → 输出 { nodes: [...], edges: [...] } 结构化数据 → elkjs 计算布局 → 生成 Excalidraw elements → 渲染
```

- 灵活度最高，可自定义布局策略
- 但需要手写「结构数据 → Excalidraw elements」的转换代码 ~300 行
- 适合需要高度定制布局的场景

### ④ excalidraw-dsl

- 需要安装 Rust 编译的 CLI 工具
- 不适合 web 项目的前端集成
- 不推荐

## 结论与建议

> [!TIP]
> **强烈推荐方案 ②：Mermaid → Excalidraw**

理由：
1. **从根本上解决问题** —— 布局交给专业算法引擎（dagre），LLM 只负责语义内容
2. **代码改动最小** —— ~100 行，依赖库已经安装
3. **LLM 输出更可靠** —— Mermaid 是文本 DSL，LLM 生成准确率远高于裸 JSON 坐标
4. **Token 消耗降低 ~90%** —— Mermaid 文本极简
5. **渲染速度相当** —— 布局引擎处理很快
6. **可与现有 Excalidraw 画布完美集成** —— 转换后仍是标准 Excalidraw elements

**实施路径：**
1. 修改后端 `excalidraw_agent.py` prompt：Excalidraw agent 输出 Mermaid DSL 而非 JSON
2. 前端在 `ExcalidrawCanvas.tsx` 或新增工具函数：接收 Mermaid 文本 → `parseMermaidToExcalidraw` → `convertToExcalidrawElements` → 渲染
3. 保留现有 JSON 路径作为 fallback（兼容编辑模式）
