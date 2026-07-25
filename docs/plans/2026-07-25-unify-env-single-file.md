# 统一到单一根目录 .env（分类管理）— 补充说明

日期：2026-07-25

## 约定

**唯一主配置**：仓库根 `.env`，按三分区维护：

1. **Platform / Deploy** — `DB_PASSWORD`、`PPT_INTERNAL_API_SECRET`、`GATEWAY_PORT`…
2. **Diagram** — `apps/api-diagram`（`DIAGRAM_DATABASE_URL`、`OPENAI_API_KEY`、Auth…）
3. **PPT** — `PPT_DATABASE_URL` / `DATABASE_URL`、`OPENAI_COMPATIBLE_*`、`TTS_*`…

`apps/api-diagram/.env` 仅可选覆盖，默认空 stub。旧文件已备份为 `apps/api-diagram/.env.migrated-backup`（勿提交）。

## 数据库键

| 键 | 用途 |
|----|------|
| `DIAGRAM_DATABASE_URL` | 图表库 `smartdiagram` |
| `PPT_DATABASE_URL` | PPT 库 `ppt_agent` |
| `DATABASE_URL` | 与 PPT 相同（Prisma/Node 约定） |

## 代码改动要点

- `apps/api-diagram/app/core/config.py`：正确加载仓库根 `.env`；优先读 `DIAGRAM_DATABASE_URL`
- `apps/service-ppt-renderer/.../prisma.ts`：可用 `PPT_DATABASE_URL` 回填 `DATABASE_URL`
- `docker-compose.yml` / `deploy.sh` / `dev.sh`：一律以根 `.env` 为准
