# 经验：Monorepo 重命名后的环境变量与启动脚本

## 症状

`npm run dev` 报「缺少 xxx/.env」，但该目录在架构重命名后已经不存在。

## 做法

1. 先 `find` / `rg` 统计所有 `.env*` 与脚本里的旧路径（`ppt-agent-engine`、`backend`）。
2. 定分层：根 `.env` = 共享 + 跨服务模块；`apps/<service>/.env` = 仅该服务。
3. 启动脚本对「缺文件 / 缺键」自动从 `.env.example` 补齐，**禁止覆盖已有密钥**。
4. 含不同 `DATABASE_URL` 的服务，在**子 shell** 里 `source`，避免污染其它进程。

## 本仓库约定

- **唯一主配置**：仓库根 `.env`，三分区 Platform / Diagram / PPT
- `DIAGRAM_DATABASE_URL` vs `PPT_DATABASE_URL`（`DATABASE_URL` 对齐 PPT，供 Prisma）
- `apps/api-diagram/.env` 仅可选覆盖，默认可空
