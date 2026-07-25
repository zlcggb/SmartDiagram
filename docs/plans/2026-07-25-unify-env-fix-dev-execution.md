# 统一环境变量并修复 npm run dev — 执行说明

日期：2026-07-25

## 结论

环境变量收成 **两处**：

| 文件 | 职责 |
|------|------|
| 仓库根 `.env` | 平台共享（`DB_PASSWORD`、`PPT_INTERNAL_API_SECRET`）+ PPT（AI/TTS/`DATABASE_URL=ppt_agent`） |
| `apps/api-diagram/.env` | 仅图表后端 |

已删除对已消失目录 `ppt-agent-engine/.env` 的硬依赖；`npm run dev` 不再因此退出。

## 改动摘要

- 扩写 [`.env.example`](../../.env.example)（Platform + PPT 分区）
- 新增 [`scripts/ensure-root-env.sh`](../../scripts/ensure-root-env.sh)：缺文件则复制，缺键则追加（不覆盖已有值）
- 重写 [`dev.sh`](../../dev.sh) / [`start-all.sh`](../../start-all.sh)：启动 `apps/api-ppt` + `apps/service-ppt-renderer`
- [`docker-compose.yml`](../../docker-compose.yml) `env_file` → `./.env`
- [`deploy.sh`](../../deploy.sh) prisma 路径 → `prisma/migrations`
- 根 [`package.json`](../../package.json) 增加 `dev:ppt-*` / `db:generate` / `db:migrate:ppt` 与 prisma/tsx
- [`prisma/apply-migrations.ts`](../../prisma/apply-migrations.ts) import 指向 `apps/service-ppt-renderer`

## 本地用法

```bash
# 首次：根 .env 会自动从 example 补齐；把 PPT 的真实 Key 填进根 .env
# 图表 Key 仍在 apps/api-diagram/.env
npm run dev
```

若你还有旧的 `ppt-agent-engine/.env` 备份，把 `OPENAI_COMPATIBLE_*` / `GEMINI_*` / `TTS_*` 粘到根 `.env` 即可。

## 经验

- Monorepo 重命名后，启动脚本里的「幽灵路径」会比代码 import 更早炸；env 路径要和 apps 新名字一起改。
- 根 `.env` 的 `DATABASE_URL`（ppt_agent）与 `apps/api-diagram/.env` 的 `DATABASE_URL`（smartdiagram）不要混进同一进程：PPT 子进程单独 `source` 根 `.env`。
