# SmartDiagram 对标「测试组长 - AI Agent 方向（大模型）」定制简历与项目包装指南

> **目标岗位**：测试组长 - AI Agent 方向 - 大模型（25-40K · 14 薪）  
> **核心策略**：将「AI 全栈架构研发 + 质量工程（SDET）」复合背景，降维打击转化为大模型团队最稀缺的 **“懂 LangGraph 白盒状态机、能写确定性自愈护栏、具备全链路混沌注入与量化评测体系建设能力的 AI Agent 质量负责人 / 测试组长”**。  
> **事实基准**：本文所有技术栈、模块路径、脚本命令与量化指标均 100% 对应当前 `SmartDiagram` 仓库真实实现，面试官现场 Code Review 或追问细节均可对答如流、有据可查。

---

## 一、 岗位匹配策略与简历定位指南（为什么你是最佳人选）

### 1.1 破解 JD 背后的真实招聘痛点

招聘「AI Agent 测试组长（25-40K·14薪）」的团队，通常面临三大核心困境：
1. **传统黑盒测试测不动 Agent**：大模型输出具有概率性与非确定性，传统测试只会手工点页面或在 Excel 里记“回答不好”，既写不出自动化断言，也定位不出到底是 **Router 意图偏了、RAG 检索漏了、Prompt 越界了，还是前端画布解析崩了**。
2. **评测与工程脱节**：许多团队虽有零散的测试集，但依赖人工盲评或昂贵慢速的 LLM-as-a-Judge，无法嵌入 Git `pre-push` 与 CI/CD 成为秒级阻断红线，导致 Badcase 反复回潮。
3. **复杂链路无人能分层兜底**：办公 AI / 多模态 Agent 涉及「React 画布 / 流式 SSE → Nginx 网关 → FastAPI / LangGraph 编排 → Node 渲染侧车 → PostgreSQL 多库 / Redis 队列」。当线上出现“流式卡死”或“导出失败”时，急需一位能直接看懂前后端源码与编排图谱的测试领军人物。

### 1.2 你的核心竞争壁垒（“AI 全栈 + 测开”降维打击定位）

| 维度 | 普通测试组长候选人 | 你的差异化王牌（基于 SmartDiagram 真实落地） |
|------|-------------------|---------------------------------------------|
| **Agent 评测深度** | 停留在手工提问 + 人工打分，缺乏代码级评测框架 | 独立研发零外部 LLM 依赖的 `evaluator.py` + `multimodal_evaluator.py` 双轨确定性评测引擎，构建 **83 条跨模块基准与 Badcase 库（53 图表域 + 30 多模态：招聘 `Rubric-v3` 防幻觉/Knockout + 视频 Jeff 门控 + PPT `Send` 编排）**，单样本毫秒级执行，直接作为 CI `--strict` 准出红线并输出离线可交互 **`latest_qa_dashboard.html` 质量总控大盘** |
| **Badcase 治理能力** | 发现 Badcase 只能提单让算法改 Prompt，周期长且易复发 | 在 LangGraph 链路中构建 `Validator Agent` + `Repair Agent`（**19 项 AST/Schema 确定性自愈规则**），将可修复结构缺陷从 `Pass@1 (0%)` 拉升至 **`Pass@Repair (100%)`**；在招聘初筛落地 **原文证据定位防幻觉强制降级（`level>=2` 无证据降为 `level=1`）** 与 **学历/届次一票否决 `59` 分封顶** |
| **自动化与高并发压测** | 仅会常规接口断言与简单页面点击，遇流式 SSE 即束手无策 | 构建 `Pytest`（**207 项**白盒/接口单测 + 7 大业务域冒烟）+ `Playwright` 跨模块 E2E，独创 **`SSE Fault Injector` 6 场景流式混沌注入器** 与 **`sse_concurrency_bench.py` 50 路并发 SSE 压测（`3,611+ streams/s`、`92,951+ chunks/s`）+ 100 并发多租户突发限流（精度 `100%`）** |
| **白盒排查与 DevOps** | 黑盒提单，依赖研发看日志 | 熟悉 `LangGraph` 状态机、三库（`smartdiagram`/`ppt_agent`/`vidgrab`）与 Docker 编排，落地 **8 秒本地 `pre-push` 门禁 + GitHub Actions + 远端部署 `ERR` Trap 脱敏诊断与多渠道 Webhook 闭环** |
| **AI 编程提效与管理** | 偶尔用 AI 写简单正则或单测片段 | 基于 `Claude Code` / `Cursor` + `.trellis` Spec 规范工作流 + `CodeGraph` 语义图谱，建立团队 AI 辅助用例生成、Badcase 4 步闭环 SOP 与分层质量规范 |

---

## 二、 个人优势 / 个人总结模板（3 个版本，按投递侧重点任选）

> **使用建议**：投递偏重管理与体系建设的岗位选 **版本 A**；投递偏重硬核框架开发与自动化的岗位选 **版本 B**；若简历中研发经历占比较高、需丝滑解释为何竞聘 QA Lead 选 **版本 C**。

### 版本 A：AI Agent 质量负责人 / 测试组长型（首推，100% 贴合 JD 主线）

- **AI Agent 全链路质量体系与准出标准制定者**：深耕多模态办公 AI 与多智能体（Multi-Agent）系统质量工程，主导覆盖 **10 路图表意图路由、AI 招聘初筛 `Rubric-v3`、视频学习助手快慢思考门控、PPT LangGraph `Send` 并行编排、多轮上下文记忆、RAG 知识门控与企业安全护栏** 的端到端测试方案与 `--strict` 量化准出红线（意图路由准确率 $\ge 95\%$、知识与简历证据抗幻觉率 $100\%$、安全红队拦截率 $100\%$）。
- **双轨评测基准集（83 样本）与确定性自愈工程专家**：擅长解决大模型“非确定性输出与幻觉”测试难题，从 0 到 1 构建 **83 条双轨 JSONL 评测基准集（53 图表域 + 30 跨模块多模态）**；首创在 LangGraph 编排层嵌入零 Token 开销的 `Validator + Repair + Consistency` 确定性护栏（沉淀 **19 项语法与 Schema 自愈算子**，将 `Pass@1 (0%)` 提升至 **`Pass@Repair 100%`**），并在招聘初筛落地 **原文证据缺失强制降级（`level=1`）与一票否决 `59` 分硬顶封顶**。
- **全栈自动化框架（Pytest 207 项 + Playwright）与流式高并发压测**：主导搭建双栈四层测试金字塔（**207 项 Pytest 白盒/接口测试**、7 大业务域冒烟套件、6 包 TypeScript 契约测试、Playwright 6 场景 UI 自动化），针对大模型 SSE 流式交互研发 **流式故障注入器（Fault Injector）** 与 **50 路异步 SSE 并发压测引擎（吞吐量 `3,611+ streams/s`、100 并发租户限流精度 `100%`）**，并构建单文件离线可交互 **`latest_qa_dashboard.html` 质量总控大盘**。
- **AI 原生提效与测试团队赋能**：深度应用 `Claude Code`、`Cursor`、`.trellis` Spec 规范流与 `CodeGraph` 推进测试工程化，将自动化脚本与评测集构建效率提升 **300%+**；具备 2-5 人测试团队管理、Badcase 闭环 SOP 沉淀、跨前后端/网关/模型/数据库分层排障与 CI/CD 质量门禁落地经验。

---

### 版本 B：AI 测试开发专家（SDET / 质量效能架构）型（突出硬核代码与工程深度）

- **硬核 AI 测试开发与白盒护栏架构**：精通 Python（FastAPI / Pytest / Asyncio）与 TypeScript（Playwright / React / Node.js），具备深厚的 `LangGraph` 状态机白盒测试与代码级改造能力；不仅能构建 **83 样本双轨离线量化评测引擎**（图表域 P50 `0.033ms` / 多模态 P50 `1.284ms`），更能直接编写 AST/Schema 级校验器、19 项确定性修复算子与 `Rubric-v3` 原文证据防幻觉核验器根治线上 Badcase。
- **流式协议混沌测试与异步高并发性能基准**：针对 AI 应用特有的 SSE（Server-Sent Events）流式传输与多画布渲染，基于内置 `SpaTestServer` 与 Playwright `page.route` 构建 **6 大 SSE 混沌故障注入套件**（429/502/半途断流/畸形截断帧，总耗时 `2.93s`）；基于 `asyncio` 研发 **50 路并发 SSE 分片压测（`3,611+ streams/s`、`92,951+ chunks/s`）** 与 **100 并发多租户限流 / 30 并发死循环熔断 / 40 并发 Redis 断连 Fail-Open 压测**。
- **Shift-Left 左移门禁、脱敏自诊断与可视化大盘**：构建 `local-preflight.sh`（8 秒本地 `pre-push` 快速门禁）、Prisma 破坏性 SQL 静态审计、GitHub Actions 4 阶段并发流水线、基于 Bash `ERR` Trap 的部署故障自诊断与飞书/企微/钉钉/Slack 脱敏告警系统，以及零外部 CDN 依赖的 **`latest_qa_dashboard.html` 可交互质量总控大盘**。

---

### 版本 C：AI 全栈研发赋能质量工程型（突出白盒排障与复合降维优势）

- **“懂架构、能写码、善评测”的复合型 AI 质量领军人**：兼具多模态办公 AI 平台（智能图表 + AI 演示文稿 + AI 招聘初筛 + 视频学习助手）核心架构视野与质量保障落地经验，熟悉 **前端 SPA → Nginx 网关 → FastAPI/LangGraph 编排 → Node 渲染侧车 → PostgreSQL 三库 & Redis** 全链路拓扑。
- **分层精准排障与根因治理**：能够跨越前后端边界，快速定位多轮会话状态漂移、`Jeff` 零样本意图误判、简历初筛模型幻觉抬分、RAG 跨租户权限越界、Token 预算三级熔断降级及流式死循环（`StreamLoopGuard`）等深水区缺陷，推动团队从“黑盒事后发现”向“白盒前置防御 + 自动化评测驱动（Eval-Driven Development）”升级。
- **AI Engineering 实践先锋**：善用 `Claude Code` / `Cursor` 结合仓库级 `.trellis` 规范体系与 `CodeGraph` 调用链分析，带领测试团队高效生成高覆盖率测试脚本（207 项 Pytest + 83 项 Eval 样本）、清洗合成评测数据并持续沉淀可复用的测试资产库。

---

## 三、 专业技能清单（5 大模块分类，可直接复制到简历「专业技能」栏）

1. **AI Agent 双轨专项评测与质量门禁（83 样本）**：
   - 精通 Multi-Agent（基于 **LangGraph**）端到端测试方案设计，覆盖 **图表多智能体（53 样本：意图路由、多轮记忆、Planner/RAG 门控、19 算子自愈、知识一致性抗幻觉）** 与 **跨模块多模态办公 Agent（30 样本：AI 招聘 `Rubric-v3` 原文证据防幻觉降级与一票否决 `59` 分封顶、视频学习助手 System 1/2 门控修正与 4 题型判分、PPT LangGraph `Send` 并行编排与单页异常隔离）**。
   - 熟练构建结构化 **Golden Dataset（黄金基准集）** 与 **Badcase 回归库（JSONL）**；擅长设计 `Pass@1` vs `Pass@Repair` 对比评测体系，落地零外部 LLM 依赖的毫秒级离线评测套件（`eval:agent` & `eval:multimodal`）与单文件离线可交互 **`latest_qa_dashboard.html` 质量总控大盘**。
   - 熟悉大模型安全红队评测与运行时护栏验证：覆盖 Prompt 注入、HTML/SVG XSS 注入、`javascript:` 伪协议、ECharts 函数注入拦截，以及租户滑动窗口限流、Token 预算三级矩阵（正常/降级/硬阻断）与 `StreamLoopGuard` 流式死循环防护测试。
2. **自动化测试、流式混沌注入与高并发压测（Pytest / Playwright / Asyncio）**：
   - **服务端与白盒自动化**：精通 **Python + Pytest** 异步测试框架，熟练编写 FastAPI 接口契约测试、LangGraph 节点级白盒单测、多租户 RBAC/配额边界测试及 7 大业务域端到端 Smoke 冒烟脚本（**207 项 Python 自动化单测** + 6 包 TS 单测）。
   - **UI 自动化与流式异常注入**：熟练使用 **Playwright（Headless Chromium）+ 内置 `SpaTestServer`** 构建跨模块端到端 UI 自动化；独创基于 `page.route` 的 **SSE 流式网络故障注入器（6 大场景，耗时 `2.93s`）**，支持模拟 HTTP `429` 限流、`502` 网关崩溃、流式半途断流（Mid-stream Error）与畸形截断载荷，验证前端状态机容错自愈能力。
   - **异步 SSE 高并发与韧性压测**：研发 `sse_concurrency_bench.py`（`npm run bench:sse`），实测 **50 路并发 SSE 流吞吐 `3,611+ streams/s`（`92,951+ chunks/s`，TTFT P50 `0.19~0.21ms`）**、**100 并发 5 租户突发限流 `100%` 精度**、30 并发死循环熔断与 40 并发 Redis 断连 `memory_fallback` Fail-Open 容灾。
3. **全栈白盒排查与基础设施（FastAPI / React / 三库 / 容器网络）**：
   - 具备从前端（React 19 + Zustand + 9 大画布引擎）、网关（Nginx 反向代理与 SSE 流式透传）、后端编排（FastAPI + LangGraph + Node/Prisma 渲染侧车 + `Jeff :8001`）到底层存储（PostgreSQL 三库隔离 + Redis 队列）的 **全链路分层排查能力**。
   - 熟悉数据库迁移安全审计（静态拦截 `DROP TABLE` / `TRUNCATE` / `DELETE FROM` 等破坏性 SQL）与双库/三库事务一致性验证。
4. **CI/CD 质量流水线与部署可观测性（DevOps）**：
   - 熟练搭建 **Git Pre-push 本地左移门禁**（8 秒快速预检）与 **GitHub Actions** 多阶段并发质量流水线，实现评测报告自动注入 `$GITHUB_STEP_SUMMARY` 与红线自动阻断。
   - 熟悉 Docker Compose 容器化编排、SSH 远程平滑发布（`remote-deploy.sh`）、基于 Bash `ERR` Trap 的部署异常捕获、结构化脱敏诊断报告生成（`0600` 权限控制）及 **飞书 / 企业微信 / 钉钉 / Slack 多渠道 Webhook** 实时告警闭环。
5. **AI 辅助工程提效与测试团队管理**：
   - 深度掌握 **Cursor、Claude Code** 等 AI 编程工具，结合 `.trellis` Spec 规范工作流与 `CodeGraph` 静态调用图谱，高效驱动测试框架搭建、复杂 Mock 构造、Badcase 数据扩充与回归脚本生成。
   - 具备测试团队（2-5 人）日常管理、版本准出评审、线上 Badcase 四步闭环 SOP 制定及团队 AI 测开技能赋能经验。

---

## 四、 核心项目经历（STAR 法则精修版，可直接复制进简历）

> **排版说明**：
> - **方案一（推荐，双项目拆解法）**：将 `SmartDiagram` 拆分为 **「AI Agent 双轨专项评测（83 样本）与确定性自愈体系」** 与 **「全栈自动化（207 单测 + Playwright）、50 路 SSE 并发压测与 CI/CD 可观测性工程」** 两段层层递进的王牌经历，全面铺开测试组长的“评测深度”与“工程广度”。
> - **方案二（单项目浓缩法）**：适合简历版面有限、需要与其他过往工作经历并列时使用（见 4.3 节）。

---

### 4.1 项目一：SmartDiagram 多模态办公 AI Agent 平台 — 双轨专项评测（83 样本）与全链路抗幻觉自愈体系建设

- **项目角色**：测试组长 / AI Agent 质量负责人（主导双轨评测架构、确定性自愈护栏、多模态抗幻觉门禁与质量总控大盘）
- **技术栈**：Python 3.13 · LangGraph · FastAPI · Pytest · JSONL Evaluation Harness (83 Cases) · AST/Schema Validation · Rubric-v3 Anti-Hallucination · PostgreSQL · Redis

#### 【Situation（背景与挑战）】
`SmartDiagram` 是一套集成了 **智能图表（9 大渲染引擎）、AI 演示文稿（PPT 扇出扇入并行编排）、AI 招聘初筛（ATS & `Rubric-v3`）与视频学习助手（System 1/2 快慢思考）** 的企业级多模态办公 AI 平台。在高频迭代中，团队面临三大核心质量痛点：
1. **模型输出非确定性导致画布渲染崩溃**：LLM 生成的 Mermaid、Draw.io XML、React Flow、Excalidraw、ECharts 等代码常夹带多余 Markdown 围栏、缺失必填 JSON 节点/边数组或未闭合 XML 标签，导致前端画布白屏或报错。
2. **多模态跨模块幻觉与路由误判缺乏量化门禁**：AI 招聘初筛中 LLM 偶发“无中生有”编造候选人项目经历抬高打分或忽略学历/届次硬性门槛；视频学习助手中本地零样本小模型 `Jeff` 可能将普通提问误判为功能操作（如 `download` / `seek_player`）；企业图表生成可能遗漏 RAG 知识库强约束审批节点。
3. **办公产物存在安全注入风险**：HTML 邮件（`html_email`）、网页报告（`web_report_html`）与 ECharts 存在被注入 `<script>`、`javascript:` 伪协议或可执行 `function()` 回调的隐患。

#### 【Task（核心目标）】
全面负责平台端到端质量保障，制定多模态 AI Agent 准出标准；从 0 到 1 搭建可嵌入 CI 的毫秒级双轨量化评测框架（Evaluation Harness，共 83 样本）与离线可交互 HTML 质量总控大盘；并在 LangGraph 及各业务编排层构建确定性自愈与抗幻觉护栏，彻底根治非确定性输出与模型幻觉引发的交付故障。

#### 【Action（关键行动与技术落地）】
1. **构建 83 样本双轨 JSONL 评测基准集与离线确定性评测引擎**：
   - 在 `apps/api-diagram/evals/` 下构建 **图表多智能体基准集（53 条 = `golden_cases.jsonl` 33 条 + `badcases.jsonl` 20 条）** 与 **跨模块多模态办公 Agent 评测集（`multimodal_cases.jsonl` 30 条 = 招聘 10 + 视频 13 + PPT 7）**。
   - 研发 `evaluator.py` 与 `multimodal_evaluator.py`（`npm run eval:agent` & `npm run eval:multimodal`），剥离外部公网 LLM 波动，直接对核心状态机节点进行毫秒级 `--strict` 门禁考核。
2. **首创图表域 `Validator + Repair` 确定性自愈护栏（19 项修复算子）**：
   - 在 `orchestrator.py` 生成节点后置入零 Token 消耗的 `validator_agent` 与 `repair_agent`（`output_validation.py` / `output_repair.py`）。
   - 针对 9 大引擎沉淀 **19 项确定性自愈规则**（如 `common.strip_code_fences` 剥离围栏、`drawio.add_missing_closing_mxfile` 补齐闭合标签、`flow.add_missing_nodes`/`edges` 补齐拓扑结构、`excalidraw.wrap_single_element` 容器封装、`mermaid.quote_flowchart_edge_labels` 边标签括号转义、`office.normalize_unsafe_href` 危险外链清洗），修复后自动触发二次校验（Re-validation）。
3. **落地跨模块多模态抗幻觉、意图门控与并行容错护栏**：
   - **AI 招聘 `Rubric-v3` 原文证据防幻觉与一票否决（10 样本）**：后置 `_evidence_exists_in_resume` 核验——当 LLM 评出高分（`level >= 2`）但简历原文无支撑或有效证据 `< 4` 字符时，**强制降级为 `level = 1`**；当学历或毕业届次未通过一票否决项（Knockout）时，即便能力分高达 `94` 分也强制触发 `capped = True` **封顶至 `<= 59` 分（D 档淘汰）**。
   - **视频助手 System 1/2 意图先验与 `Jeff` 零样本门控修正（13 样本）**：验证第一层正则先验秒级分流，以及第二层 `Jeff` 零样本分类将普通内容提问误判为 `download` 或低置信度（`< 0.78`）判为 `seek_player` 时，由语义锚点门控 **100% 修正回 `video_qa`**，并覆盖单选/多选/判断/简答 4 题型确定性判分。
   - **PPT LangGraph `Send` 扇出扇入并行编排与单页容错（7 样本）**：验证 `topic`/`paste`/`draft` 多模式路由、单页 `design_page` 渲染异常隔离（不阻断其余页面并发完成）及全页检索失败短路熔断。
4. **落地企业 RAG 知识一致性抗幻觉与运行时安全红队防线**：
   - 设计 `consistency_agent` 强约束拦截：自动核对生成代码与企业知识库切片的 `required_terms`（必须包含）和 `forbidden_terms`（禁止包含），违规时将状态置为 `needs_user_input` 阻断自动导出并回传文档 `citations`。
   - 验证 ECharts `function()`/`=>` 注入与 HTML `<script>`/`javascript:` 100% 阻断。
5. **研发单文件离线可交互 HTML 质量总控大盘与 Badcase 四步闭环 SOP**：
   - 研发 `generate_qa_dashboard.py`（`npm run qa:dashboard`），自动聚合四大评测/压测 JSON 报告生成零外部 CDN 依赖、严格防 XSS 转义的 `latest_qa_dashboard.html`。

#### 【Result（量化成果）】
- **83 样本双轨评测 100% 达标**：图表域 **53/53 (`100.00%`)** 通过（离线耗时 P50 **`0.033ms`** / P95 **`0.203ms`**），跨模块多模态 **30/30 (`100.00%`)** 通过（P50 **`1.284ms`**），其中招聘证据防幻觉降级率、Knockout 封顶率、视频 Jeff 误判归正率与 PPT 并行容错率均为 **`100.00%`**。
- **Badcase 交付合格率质变**：17 类典型可修复大模型结构缺陷样本的首次合格率（`Pass@1`）从 `0.00%` 提升至自愈后合格率（**`Pass@Repair`**）**`100.00%`**（单样本自愈耗时 `0.035ms`），前端画布因语法越界导致的崩溃率降为 **0**。
- **安全合规零漏检**：高危安全红队样本（JS 函数注入、`javascript:` 伪协议、`<script>` 标签）**拦截率达 `100.00%`**。

---

### 4.2 项目二：全栈自动化框架（207 单测 + Playwright）、50 路 SSE 并发压测与 CI/CD 可观测性工程

- **项目角色**：AI 测试开发负责人（SDET Lead）
- **技术栈**：Python · Pytest (207 Cases) · Playwright (Headless Chromium) · Asyncio SSE Benchmark · GitHub Actions · Bash (`ERR` Trap) · Docker Compose · Nginx · Claude Code / Cursor

#### 【Situation（背景与挑战）】
随着 `SmartDiagram` 演进为包含统一桌面端 SPA（`apps/web`）、四大后端服务与三数据库的 Monorepo 架构，传统手工回归与单点脚本面临严峻挑战：
1. **流式交互、弱网异常与高并发吞吐极难自动化验证**：AI 绘图通过 `/api/chat/stream`（SSE 协议）流式推送 `<design_concept>` 与 `<code>`，真实调用大模型不仅慢且贵，无法稳定复现 **HTTP 429 限流、502 网关崩溃、SSE 半途断流（Mid-stream Error）及截断畸形帧**；同时缺乏高并发下多租户限流水位线精度、死循环熔断与 Redis 宕机回退的量化压测基准。
2. **多服务发布链路黑盒化**：生产环境经由 Nginx 网关（`:9237`）聚合多容器，亟需防止代码编译失败时反复全量备份撑爆磁盘、拦截破坏性数据库迁移，并实现部署异常的秒级脱敏自诊断告警。

#### 【Task（核心目标）】
主导搭建覆盖“白盒单测（207 Pytest + TS）→ 双轨 Agent 评测（83 样本）→ Playwright 流式混沌 E2E（6 场景）→ 异步 SSE 高并发压测（5 场景）→ 7 大业务冒烟”的自动化测试体系；打通本地 8 秒 `pre-push`、GitHub Actions CI 与远程部署自诊断告警闭环。

#### 【Action（关键行动与技术落地）】
1. **搭建 Python (207 项) + TypeScript (6 包) 双栈自动化测试金字塔**：
   - 主导建设 `apps/api-diagram/tests` 与 `apps/api-ppt/tests` 共 **207 个 Pytest 自动化测试**（涵盖部署安全、告警脱敏、双轨评测、并发压测、大盘防 XSS、Playwright E2E、多租户配额、知识库权限、ATS 招聘初筛等），以及跨 6 个 TS 包（含 `svgSpatialQuality.ts` 计算几何碰撞检测）的契约单测与 **7 大业务域 Smoke 冒烟套件**。
2. **基于 Playwright + `SpaTestServer` 研发 6 大跨模块 E2E 与 `SSE Fault Injector` 流式混沌注入**：
   - 内置轻量级 `SpaTestServer` 托管前端构建产物，利用 Playwright `page.route` 拦截 `/api/chat/stream` 注入确定性二进制 SSE 帧序列，在 **`2.93s`** 内零 LLM 开销完成 **6 大场景验证（`6/6 PASS`）**：多工作台路由挂载、标准全链路遥测流、**流中途 `StreamLoopGuard` Error 事件注入（断言 `isStreaming` 复位不转圈死锁）**、**半截损坏 JSON 帧容错恢复**、**HTTP 429 突发限流提示**、**HTTP 502 网关故障一键重试自愈**。
3. **研发 `sse_concurrency_bench.py` 异步多租户 SSE 高并发与混沌韧性压测套件**：
   - 基于 `asyncio.gather` 构建 5 大高并发压测基准（`npm run bench:sse`，总耗时 `~50ms`）：
     - **50 路并发 SSE 分片解析压测**：横跨 4 大引擎 `1,287` 个随机碎片 Chunk，实测流吞吐量 **`3,611.17 streams/s`**、分片吞吐量 **`92,951.59 chunks/s`**、首字延迟 **TTFT P50 `0.207ms`**、增量提取 `65` 个图元，成功率 **`100% (50/50)`**；
     - **100 并发 5 租户突发限流精度压测**：单窗口配额 `limit=8`、每租户并发打入 `20` 请求，实测精确放行 **`40/40`**、精确拦截 **`60/60`**（**限流精度 `100.0%`，跨租户串扰 `0`**）；
     - **30 并发 `StreamLoopGuard` 死循环熔断压测**：15 路正常流 `0%` 误杀，15 路死循环流 `100%` 熔断（拦截 `4,040` 个无效事件）；
     - **40 并发 Token 预算三级矩阵压测**：`18k` 软降级与 `32k` 硬阻断分类准确率 **`100% (40/40)`**；
     - **40 并发 Redis 断连混沌注入压测**：注入 `ConnectionRefusedError`/`TimeoutError`，**`100%` 自动触发 `memory_fallback` Fail-Open 回退本地内存限流**（放行 `24/24`，拦截 `16/16`，零未捕获异常）。
4. **构建本地 8 秒左移门禁、镜像预构建防呆与部署故障脱敏 Webhook 闭环**：
   - 开发 `scripts/local-preflight.sh` 挂载至 `.git/hooks/pre-push`（8 秒内完成 Env 契约、`bash -n`、Prisma 破坏性 SQL 拦截、207 项 Pytest 与 `--strict` 评测）；搭建 `.github/workflows/qa-ci.yml` 自动将评测报表渲染至 `$GITHUB_STEP_SUMMARY`。
   - 改造 `deploy.sh` 实行 **“先预构建应用镜像、成功后才执行数据库备份与迁移”** 防呆策略；利用 Bash `ERR` Trap 自动生成 `0600` 权限且经 `scrub_text` 正则脱敏（掩码 `[REDACTED]`）的 `deploy-latest.md` 诊断报告，由 `remote-deploy.sh` 拉回本地终端并推送飞书/企微/钉钉/Slack 机器人。

#### 【Result（量化成果）】
- **高并发与流式韧性 100% 达标**：50 路并发 SSE 吞吐突破 **`3,611+ streams/s`**，100 并发多租户限流精度、Redis 断连 Fail-Open 回退率与 Playwright 6 大流式故障恢复率全部达到 **`100.0%`**，CI 偶发抖动（Flaky）率降为 **`0%`**。
- **研发质效大幅跃升**：本地 `pre-push` 门禁控制在 **`8 秒`** 以内；结合 `Claude Code` / `Cursor` + `.trellis` Spec 工作流 + `CodeGraph`，测试脚本与评测集开发效率提升 **`300%+`**。
- **发布故障秒级定位**：线上/预发部署异常从“人工登录服务器翻日志 30 分钟”缩短至 **Webhook 脱敏告警卡片 + 自诊断报告 `10 秒` 内直达故障行号与回滚命令**。

---

### 4.3 【备选】单项目高密度浓缩版（适合简历篇幅受限时二合一使用）

> **SmartDiagram 多模态办公 AI Agent 平台 — 质量保障体系、83 样本双轨评测与高并发自动化工程（测试组长 / AI QA Lead）**
> - **项目概述**：面向集成了 9 大图表渲染引擎、AI 演示文稿（PPT）、AI 招聘初筛与视频学习助手的企业级多智能体平台（React + Nginx Gateway + FastAPI/LangGraph + Node/Prisma + PG 三库 + Redis），全面主导端到端质量标准、双轨 Agent 专项评测、确定性自愈护栏、全栈自动化、SSE 高并发压测及 CI/CD 告警体系建设。
> - **核心职责与业绩**：
>   1. **83 样本双轨 Agent 评测与 Badcase 闭环**：构建 **图表多智能体（53 样本）+ 跨模块多模态（30 样本：招聘 `Rubric-v3` 防幻觉/Knockout + 视频 Jeff 门控 + PPT `Send` 并行编排）** 离线确定性评测框架，总通过率 **`100% (83/83)`**，图表域 P50 耗时仅 **`0.033ms`**；配套研发零 CDN 依赖的离线可交互 **`latest_qa_dashboard.html` 质量总控大盘**。
>   2. **非确定性输出自愈（Pass@Repair 100%）与多模态抗幻觉**：在 LangGraph 链路设计零 LLM 开销的 `Validator + Repair + Consistency` 护栏，沉淀 **19 项 AST/Schema 自愈算子**，将可修复 Badcase 从 `Pass@1 (0%)` 拉升至 **`Pass@Repair 100%`**；在招聘初筛落地 **无简历原文证据强制降级（`level=1`）与学历/届次一票否决 `59` 分封顶**；安全红队（XSS/JS 函数注入）**拦截率 `100%`**。
>   3. **207 项 Pytest + Playwright 流式混沌注入 + 50 路 SSE 并发压测**：搭建 **207 项 Pytest 单测**、6 包 TS 单测（含 SVG 几何碰撞检测）与 7 大业务域冒烟；基于内置 `SpaTestServer` 与 `SSE Fault Injector` 在 **`2.93s`** 内验证 6 大断流/坏帧/429/502 场景；研发异步并发压测套件，实测 **50 路 SSE 吞吐 `3,611+ streams/s`（`92,951+ chunks/s`）**、**100 并发租户限流精度 `100%`** 及 40 并发 Redis 断连 `memory_fallback` 100% 容灾。
>   4. **CI/CD 左移门禁与 AI 提效管理**：落地 **8 秒 Git `pre-push` 门禁**、Prisma 破坏性 SQL 审计、GitHub Actions Step Summary 自动报表、`deploy.sh` 镜像预构建后再备份防呆，以及基于 `ERR` Trap 的 `[REDACTED]` 脱敏自诊断与飞书/企微/钉钉 Webhook 告警；引入 `Claude Code` / `Cursor` + `.trellis` Spec 工作流，带领团队提效 **300%+**。

---

## 五、 简历关键词（ATS 高频词）命中自查表（20 项核心词 100% 映射）

> 企业 HR 与招聘系统（包括 SmartDiagram 自身的 ATS 评分引擎）在筛选「AI Agent 测试组长」简历时，会对以下 **20 个高频关键词** 进行权重匹配。将上文模板拷入简历后，你的命中率即为 **100%**：

| 序号 | JD 核心关键词 / 考察点 | 简历对应落点（模块 / 指标 / 仓库真实凭证） | 命中状态 |
|:----:|----------------------|-------------------------------------------|:--------:|
| 1 | **AI Agent 测试 / 多智能体** | 图表 10 路 LangGraph 编排 + 招聘/视频/PPT 跨模块多模态 **83 样本双轨评测 (`100%`)** | ✅ 100% |
| 2 | **办公 AI（Office AI）** | 智能图表（9 大引擎）、AI PPT 演示文稿、办公 HTML 邮件/网页报告、AI 招聘初筛、视频学习助手 | ✅ 100% |
| 3 | **测试组长 / 端到端准出标准** | 制定 `--strict` 准出红线、四层测试金字塔、Badcase 4 步闭环 SOP 与 `latest_qa_dashboard.html` | ✅ 100% |
| 4 | **多轮对话 / 记忆上下文** | `golden_cases.jsonl` (`IR-011~014`) 验证多轮局部修改保持 `current_engine` 及中途显式/自然切题 | ✅ 100% |
| 5 | **意图识别 / 快慢思考门控** | 图表路由准确率 `100%` + 视频助手 System 1/2 先验与 `Jeff` 零样本误判门控修正率 `100% (9/9)` | ✅ 100% |
| 6 | **工具调用 / Workflow / 并行编排** | `planner_agent.py` 复杂度分级 + PPT LangGraph `Send` 多页扇出扇入并行编排与单页异常隔离 `100%` | ✅ 100% |
| 7 | **RAG 知识库 / 简历防幻觉评测** | `consistency_agent` 强约束词抗幻觉 `100%` + 招聘 `Rubric-v3` 无原文证据强制降级 (`level=1`) & `59` 分封顶 | ✅ 100% |
| 8 | **效果稳定性 / 异常兜底** | `Validator + Repair Agent` 19 项确定性自愈算子，将 `Pass@1 (0%)` 拉升至 `Pass@Repair (100%)` | ✅ 100% |
| 9 | **安全合规 / 红队评测** | 拦截 ECharts `function()`/`=>` 注入、HTML `<script>`/`javascript:`、RAG 反投毒（拦截率 `100%`） | ✅ 100% |
| 10 | **Golden Dataset & 多模态基准** | `golden_cases.jsonl` (33 条) + `multimodal_cases.jsonl` (30 条跨模块多模态样本) | ✅ 100% |
| 11 | **Badcase 库与回归闭环** | `badcases.jsonl`（20 条真实结构缺陷与安全红队样本，100% 强制门禁零回退） | ✅ 100% |
| 12 | **可量化评测报告 / HTML 总控大盘** | 自动生成 Markdown/JSON 报告与单文件离线可交互 `latest_qa_dashboard.html`（图表 P50 `0.033ms`） | ✅ 100% |
| 13 | **Python / Pytest 接口与白盒测试** | `apps/api-diagram/tests` + `apps/api-ppt/tests`（**207 项用例**）+ 7 大业务域 `smoke_*.py` | ✅ 100% |
| 14 | **Playwright UI 自动化** | 内置 `SpaTestServer` + Headless Chromium 跨模块 E2E（6 大场景总耗时 `2.93s`，`6/6 PASS`） | ✅ 100% |
| 15 | **SSE 流式混沌注入 & 高并发压测** | `SSE Fault Injector` (429/502/断流/坏帧) + **50 路并发 SSE 压测 (`3,611+ streams/s`) + 100 并发限流 (`100%`)** | ✅ 100% |
| 16 | **CI/CD 流水线与质量门禁** | `.github/workflows/qa-ci.yml` + `scripts/local-preflight.sh`（8 秒 `pre-push` 门禁 + `$GITHUB_STEP_SUMMARY`） | ✅ 100% |
| 17 | **AI 编程工具（Cursor / Claude Code）** | 结合 `.trellis` Spec 规范流与 `CodeGraph` 辅助编写自动化测试脚本、清洗数据，提效 `300%+` | ✅ 100% |
| 18 | **全链路分层排查（前后端/网关/三库）** | 覆盖 React 19 → Nginx `:9237` → FastAPI/LangGraph → Node 渲染侧车 → PG 三库 & Redis 分层排障 | ✅ 100% |
| 19 | **数据库迁移安全与镜像预构建防呆** | 静态扫描 Prisma 迁移破坏性 SQL（`DROP`/`TRUNCATE`/`DELETE`）+ `deploy.sh` 镜像预构建后再备份 | ✅ 100% |
| 20 | **可观测性 / 脱敏告警反馈闭环** | `deploy-notify.sh` 捕获 `ERR` Trap 生成 `0600` 权限 `[REDACTED]` 脱敏诊断报告，对接飞书/企微/钉钉/Slack | ✅ 100% |

---

## 六、 简历投递与面试联动速查（投递前最后 3 步）

1. **职位名称对齐**：在简历顶部求职意向栏明确填写：**`测试组长 / QA Lead（AI Agent 与大模型方向）`** 或 **`资深 AI 测试开发专家（SDET Lead）`**。
2. **作品集 / 附件加持**：可将仓库中的离线可交互质量总控大盘 [`latest_qa_dashboard.html`](../../apps/api-diagram/evals/reports/latest_qa_dashboard.html)、[`latest_eval_report.md`](../../apps/api-diagram/evals/reports/latest_eval_report.md)（53 样本）、[`latest_multimodal_eval_report.md`](../../apps/api-diagram/evals/reports/latest_multimodal_eval_report.md)（30 样本）与 [`AI智能体专项评测与全链路质量工程白皮书.md`](./AI智能体专项评测与全链路质量工程白皮书.md) 导出为 PDF 附在简历后，面试官一眼即可识别出你具备完整的工业级 AI Agent 质量体系落地能力。
3. **现场演示准备**：面试前只需在本地运行 `npm run eval:agent`、`npm run eval:multimodal`、`npm run bench:sse` 与 `npm run qa:dashboard`（全部在 1~2 秒内完成），并打开 `latest_qa_dashboard.html`，即可向面试官实时演示毫秒级 83 样本双轨评测、50 路 SSE 并发压测与 Git 门禁拦截效果。
