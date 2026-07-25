# 执行文档：`npm run dev` 卡在「等待 PostgreSQL 就绪」

日期：2026-07-25

## 问题现象

`npm run dev` / `bash start-all.sh` 长时间停在：

```text
⏳ 等待 PostgreSQL 就绪...
```

## 方案对比

| 方案 | 做法 | 权重 | 说明 |
|------|------|------|------|
| A | 修 compose / 等待逻辑 + 顺带修启动链路上的后续阻断 | **92** | 根因在配置与脚本，不绕开 Docker |
| B | 跳过 Docker，改连本机 Postgres / 手工起库 | 45 | 偏离现有基础设施约定，维护成本高 |

**选用方案 A。**

## 根因拆解（不止数据库）

1. **等待循环假死（表象）**  
   `docker compose exec db pg_isready` 在 `docker-compose.yml` 解析失败时一直失败；DB 容器其实已 healthy。  
   触发点：`worker.environment` 里密钥与 `volumes:` 被粘在同一行，YAML 非法。

2. **compose 服务名非法**  
   服务名含 `/`（如 `apps/api-diagram`）导致 `depends_on` 校验失败，阻塞 `ppt-db-init` 等后续步骤。

3. **`.env` 未加引号**  
   `KNOWLEDGE_SECURITY_TRUSTED_TERMS=...quote process` 被 `source` 时执行 `process`，报 `command not found`，污染 PPT 子进程环境加载。

4. **Python `.venv` shebang 指向旧路径**  
   - `apps/api-diagram/.venv` → 已删除的 `backend/.venv`  
   - `apps/api-ppt/.venv` → 旧 `PPT-Agent/.../apps/api-python/.venv`  
   导致 `uv run uvicorn` 落到系统 uvicorn，出现 `ModuleNotFoundError: langchain_core`。

5. **前端入口路径**  
   FSD 后入口为 `src/app/main.tsx`，`index.html` 仍引用 `/src/main.tsx`。

6. **PPT 迁移脚本 / Prisma 客户端**  
   `apply-migrations.ts` 与 `prisma.ts` 使用顶层 `await`，在根目录 `tsx`（cjs）下失败。

## 已执行修改

- `docker-compose.yml`：修复 worker YAML；服务名改为 `api-diagram` / `web`
- `dev.sh`：`wait_for_database` 优先 `docker exec smartdiagram-db pg_isready`
- `.env` / `.env.example`：含空格的信任词列表加引号
- 重建 `apps/api-diagram/.venv`、`apps/api-ppt/.venv`（`rm -rf .venv && uv sync`）
- `apps/web/index.html` → `/src/app/main.tsx`
- `prisma/apply-migrations.ts`：改为 `main().then(...).catch(...)`
- `apps/service-ppt-renderer/src/lib/prisma.ts`：去掉顶层 `await import`，改为静态 `PrismaClient` 导入（env 仍在 `new PrismaClient()` 前加载）

## 验证结果

| 服务 | 地址 | 结果 |
|------|------|------|
| Diagram API | http://localhost:8000/docs | 200 |
| PPT Agent | http://localhost:4000/docs | 200 |
| PPT Renderer | http://127.0.0.1:4010 | 进程 listening（根路径可无业务路由） |
| Web | http://localhost:5173 | 200 |
| PostgreSQL 等待 | — | 数秒内通过 |

## 经验（可复用）

1. **「等 DB」卡住时先查三件事**：容器 `pg_isready`、`docker compose config -q`、compose 是否 YAML 合法。  
2. **monorepo 挪目录后必重建 `.venv`**：旧 shebang 会导致「依赖已装却 ModuleNotFound」。  
3. **根 `.env` 若被 bash `source`，含空格/逗号的值必须加引号**。  
4. **compose 服务名不要用路径字符 `/`**；目录路径可以，服务名不行。

## 下次同类问题快速命令

```bash
docker exec smartdiagram-db pg_isready -U postgres -d smartdiagram
docker compose config -q
head -1 apps/api-diagram/.venv/bin/uvicorn
head -1 apps/api-ppt/.venv/bin/uvicorn
# shebang 若指向不存在路径：
rm -rf apps/api-diagram/.venv apps/api-ppt/.venv
(cd apps/api-diagram; uv sync)
(cd apps/api-ppt; uv sync)
```
