# 启动脚本统一 — 执行记录

**日期**: 2026-07-25  
**目标**: `dev.sh` / `start-all.sh` / `package.json` 行为一致，消除「有的能用、有的不能用」。

## 问题分析

| 能力 | 原 dev.sh | 原 start-all.sh |
|------|-----------|-----------------|
| 等 PostgreSQL | ✅ | ❌ 只 grep 容器名 |
| Diagram DB migrate | ✅ | ❌ |
| PPT migrate 失败处理 | 硬失败 | 静默 warn |
| Homebrew PATH / FFmpeg | ✅ | ❌ |
| 端口冲突检测 | ✅ | ❌ |
| 网关前端路径 | N/A | ❌ `frontend/dist` 已不存在 |

## 方案对比

| 方案 | 描述 | 评分 |
|------|------|------|
| A. 抽公共 `scripts/dev-common.sh` | 两脚本 source，差异仅 Vite vs 网关 | **9/10** ✅ |
| B. 只补 start-all.sh 缺项 | 快但双份逻辑会继续漂移 | 5/10 |

**选择**: 方案 A。

## 实施内容

### 新增

- `scripts/dev-common.sh` — 基础设施、等库、迁移、pnpm、启动 API 等公共函数
- `scripts/run-with-root-env.sh` — npm 子命令加载根 `.env`
- `scripts/db-wait.sh` — 单独等库（`npm run db:wait`）

### 精简

- `dev.sh` — 只保留 Vite HMR 模式特有逻辑
- `start-all.sh` — 与 dev 共用 bootstrap，额外 `ensure_frontend_build` + 网关

### package.json

| 脚本 | 说明 |
|------|------|
| `dev` | Vite :5173（不变） |
| `dev:gateway` | 聚合网关 :8080（新增） |
| `db:up` | 含 drawio |
| `db:wait` | 启动并等 PostgreSQL |
| `db:migrate:diagram` | SmartDiagram 增量建表 |
| `db:migrate:ppt` | 带根 `.env` 的 Prisma 迁移 |
| `db:prepare` | PPT init + 双库 migrate |
| `dev:ppt-*` | 经 `run-with-root-env.sh` 注入环境 |

### 其它修复

- `gateway/dev-gateway.mjs` → `apps/web/dist`
- 部署安全测试 / 字体路径测试 → 新 monorepo 路径

## 使用方式

```bash
# 日常开发（热更新）
npm run dev

# 生产式网关（预构建 SPA + :8080）
npm run dev:gateway

# 仅数据库
npm run db:up
npm run db:wait
npm run db:prepare
```

## 经验

- **本地启动脚本应单一事实来源**：Docker 等待、双库 migrate、PATH 补全只写一处。
- **网关 dev 路径要随 FSD 迁移同步**：`frontend/dist` → `apps/web/dist`。
- **PPT 相关 npm script 必须 source 根 `.env`**，否则 `DATABASE_URL` 与 Diagram 库冲突。
