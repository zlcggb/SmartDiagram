# SmartDiagram — AI Agent 入口

> **稳定文档**：只规定读什么、用什么工具。**架构、目录、定位表、env、部署细节 → 一律查 [`smartdiagram_architecture.md`](./smartdiagram_architecture.md)**（结构变更只更新那份，本文尽量不改）。

---

## 1. 阅读顺序

| 顺序 | 文档 | 用途 |
|------|------|------|
| ① | 本文 | 工具与流程 |
| ② | [`smartdiagram_architecture.md`](./smartdiagram_architecture.md) | 架构真相源：目录地图、链路、§8 改动定位表 |
| ③ | [`README.md`](./README.md) | 启动、部署、npm 命令 |
| ④ | [`.trellis/workflow.md`](./.trellis/workflow.md) | Trellis 工程工作流（Plan → Execute → Finish） |
| 按需 | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) · [`.env.example`](./.env.example) · [`docs/README.md`](./docs/README.md)（文档中心） | 部署 / 环境变量 / 执行记录索引 |

---

## 2. 文档分工（去哪找）

| 问题 | 去看 |
|------|------|
| 项目结构、模块边界、改哪个文件 | 架构 doc（尤其 **§8**） |
| 怎么跑、怎么部署 | `README.md` |
| 编码规范、质量基线 | `.trellis/spec/<package>/<layer>/index.md` |
| 任务管理、跨会话记忆 | `.trellis/tasks/` · `.trellis/workspace/` |
| CodeGraph 官方安装说明 | <https://colbymchenry.github.io/codegraph/getting-started/installation/> |

---

## 3. 查代码

### 3.1 CodeGraph 前置（必做）

索引目录：仓库根 **`.codegraph/`**（在 `.gitignore`，新 clone 需本地 `init`）。

```bash
test -d .codegraph && codegraph status   # 有 db 即就绪
```

| 情况 | Agent 做法 | 提示用户 |
|------|------------|----------|
| 无 `.codegraph/`，无 `codegraph` 命令 | 暂用 `Grep` + `Read` | 需安装 CLI 后 `codegraph init`（见官方文档） |
| 无 `.codegraph/`，CLI 已有 | 仓库根执行 `codegraph init`，完成后再用 | 「正在建立索引，首次可能需数分钟」 |
| 已有索引 | 直接用下方工具 | — |
| 索引异常 | `codegraph sync`，不行则 `codegraph init -f` | 正在修复索引 |

**本机首次安装（概要）**：`npm i -g @colbymchenry/codegraph` → `codegraph install --target=cursor --yes` → 重启 Cursor → 仓库根 `codegraph init`。若已有 `.cursor/mcp.json` 可跳过 install。

### 3.2 工具选择

| 意图 | 工具 |
|------|------|
| 理解功能 / 跨文件流程 | `codegraph_explore` 或 `codegraph explore "…"` |
| 读符号或整文件 + callers | `codegraph_node` 或 `codegraph node …` |
| 谁调用 / 改动影响面 | `codegraph_callers` |
| 配置、文档、未索引文件 | `Read` |
| 最后手段全文搜索 | `Grep` |
| React/TS 改完 | `ReadLints` |
| 跑 dev / 部署 | Shell（见 `README.md`） |

索引就绪时：**先 CodeGraph，再 Read**；勿无地图全盘 grep。

### 3.3 MCP 调用格式

Cursor 里通过 `CallMcpTool` 调用 CodeGraph 时，`server` / `toolName` 与 `arguments` **同级**；工具参数一律放在 `arguments` 内（server id 以 `GetMcpTools` 为准，常见为 `user-codegraph`）：

```json
{
  "server": "<codegraph-server-id>",
  "toolName": "codegraph_explore",
  "arguments": { "query": "AuthService login session" }
}
```

| 现象 | 做法 |
|------|------|
| `server: Required, toolName: Required` | 调用格式错误，修正层级后重试；勿误判为索引或 MCP 故障 |
| 部分工具成功、部分报上条错 | 同上，逐次检查每次调用的格式 |
| 响应带索引滞后横幅 | 仅对列出的文件用 `Read`，其余仍信 CodeGraph |

调用失败时：**先查格式 → 再查索引 → 最后才 Grep**。

---

## 4. 改代码（最少约定）

1. 最小 diff，匹配现有风格。
2. 结构 / 路径 / 模块变更 → **只更新** `smartdiagram_architecture.md`；操作步骤 → `README.md`。
3. 勿泄露根 `.env` 密钥；勿未经要求 `git commit` / `push`。
4. Shell 勿用 `&&` 链命令（macOS 用户规则）。

---

## 5. Trellis 工程工作流

本项目使用 [Trellis](https://github.com/mindfold-ai/Trellis) 管理 AI 编码会话的规范、任务和记忆。

### 5.1 核心结构

| 目录 | 用途 |
|------|------|
| `.trellis/spec/` | 按包分层的编码规范（前端/后端/质量） |
| `.trellis/tasks/` | 任务目录：PRD、设计、实施计划、研究 |
| `.trellis/workspace/` | 开发者个人日志，跨会话记忆 |
| `.trellis/workflow.md` | 完整工作流定义（Plan → Execute → Finish） |

### 5.2 任务生命周期

```bash
# 创建任务
python3 ./.trellis/scripts/task.py create "<title>" --slug <name>
# 激活任务
python3 ./.trellis/scripts/task.py start <name>
# 查看当前任务
python3 ./.trellis/scripts/task.py current --source
# 归档任务
python3 ./.trellis/scripts/task.py archive <name>
```

### 5.3 Spec 规范查询

```bash
# 列出所有包和规范层
python3 ./.trellis/scripts/get_context.py --mode packages
# 查看特定工作流步骤指引
python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1
```

### 5.4 与现有文档的关系

- **Trellis spec ≠ 架构文档**：`.trellis/spec/` 存放的是编码规范（命名、错误处理、状态管理等）；架构决策仍在 `smartdiagram_architecture.md`。
- **任务 ≠ Git Issue**：Trellis 任务是 AI 会话粒度的工作单元，比 Issue 更细。
- **工作流是可选的**：简单对话和快速修复不需要走 Trellis 流程。

---

<!-- CODEGRAPH_START -->
## CodeGraph

存在 `.codegraph/` 时，**先于 grep/Read** 使用 MCP（`codegraph_explore`、`codegraph_node`）或 Shell（`codegraph explore`、`codegraph node`）。MCP 格式见 **§3.3**。

若无索引：查代码前先 `codegraph init`（CLI 已装时）并提示用户；否则降级 `Grep` + `Read`。安装见 §3.1 或[官方文档](https://colbymchenry.github.io/codegraph/getting-started/installation/)。
<!-- CODEGRAPH_END -->
