# 迁移差异审计（2026-07-25）

## 结论先说

**现有数据库里的业务数据不会因为这次目录迁移而被自动清空或改库**，前提是根 `.env` 保持当前「双库分离」配置。

真正需要警惕的是：**路径/资源漏迁移**、**环境变量混用**、**测试与部署脚本仍指向旧目录**——这些会导致「服务起不来 / 功能不可用」，而不是 silent 删库。

---

## 1. 数据库：当前状态与风险

### 实际库（已验证）

| 库名 | 用途 | 表数量 | 迁移方式 |
|------|------|--------|----------|
| `smartdiagram` | 图表 / 企业 / Auth | 29 | `apps/api-diagram/scripts/migrate_database.py`（仅 `CREATE TABLE IF NOT EXISTS`，**不删数据**） |
| `ppt_agent` | PPT 项目 / Prisma | 10 | `prisma/apply-migrations.ts` + Docker `ppt-db-init` 建库 |

PPT 已应用迁移：`init_postgres` → `project_material_*` → `project_ownership`。

### 环境变量约定（迁移后）

```env
DIAGRAM_DATABASE_URL=postgresql+asyncpg://...@localhost:5432/smartdiagram
PPT_DATABASE_URL=postgresql://...@127.0.0.1:5432/ppt_agent?schema=public
DATABASE_URL=postgresql://...@127.0.0.1:5432/ppt_agent?schema=public  # Prisma 约定
```

| 进程 | 读哪个库 | 机制 |
|------|----------|------|
| `apps/api-diagram` | `smartdiagram` | `config.py`：**优先** `DIAGRAM_DATABASE_URL` |
| `apps/service-ppt-renderer` / Prisma | `ppt_agent` | 根 `.env` 的 `DATABASE_URL` |
| PPT FastAPI 网关 | 不直连 PG | 转发到 Node 侧车 |

`dev.sh` 对 PPT 子进程单独 `source` 根 `.env`，图表后端不整进程 source，避免 `DATABASE_URL=ppt_agent` 污染 Diagram——**设计是对的**。

### 会影响数据库的唯一高风险

若有人**删掉** `DIAGRAM_DATABASE_URL`，只留 `DATABASE_URL=ppt_agent`，则 `api-diagram` 会连错库（`config.py` 会 fallback 到 `DATABASE_URL`）。

**建议**：永远保留 `DIAGRAM_DATABASE_URL`；不要把 Diagram 密钥写进 `apps/api-diagram/.env` 的 `DATABASE_URL` 覆盖项。

### 不会发生的事

- 迁移脚本**不会** `DROP TABLE` / 清库（Diagram 侧已明确非 destructive）
- 两个库**不会**因为 FSD 前端改动而自动合并
- LangGraph checkpoint（`storage/langgraph/checkpoints.sqlite`）与 PG **无关**，是本地 SQLite 文件

---

## 2. 目录 / 路径迁移差异

### 旧 → 新（意图）

| 旧路径 | 新路径 |
|--------|--------|
| `frontend/` | `apps/web/` |
| `backend/` | `apps/api-diagram/` |
| `ppt-agent-engine/apps/api` | `apps/service-ppt-renderer/` |
| `ppt-agent-engine/apps/api-python` | `apps/api-ppt/` |
| 根目录分散 `.env` | **根 `.env` 三分区** |

### 已在本会话修复的运行时问题

- 前端静态资源：`MacOSIcons` / `HomePage` 壁纸 → `@/assets/...`
- 漏拷贝资源：`macos-aqua-lake-wallpaper.jpg`、`recent-folder-384.png`、`NotoSansCJKsc-Regular.otf`
- 字幕字体源目录：`apps/api/assets/fonts` → `apps/service-ppt-renderer/assets/fonts`
- FFmpeg：`PATH` / `FFMPEG_PATH` / Homebrew 探测
- `docker-compose` 服务名 `apps/api-diagram` → `api-diagram`（`depends_on` 合法）
- Python `.venv` shebang 指向旧 `backend/`、`PPT-Agent/` → 已重建

### 仍指向旧路径（尚未改代码）

| 位置 | 问题 | 影响 |
|------|------|------|
| `apps/api-diagram/tests/test_deployment_safety.py` | 读 `ppt-agent-engine/`、`backend/`、`frontend/` | **CI/部署测试失败**，不影响本地 dev 数据 |
| `apps/service-ppt-renderer/src/lib/subtitleFonts.test.ts` | 断言 `apps/api/assets/fonts` | 单元测试失败 |
| `packages/ppt-renderer/src/subtitleOverlay.test.ts` | 硬编码旧字体路径 | 单元测试失败 |
| `materialPersistence.test.ts` | `apps/api/src/lib/prisma.ts` | 单元测试失败 |
| `knowledgeGateway.ts` | Header `x-origin-system: ppt-agent-engine` | 仅标识字符串，**不影响 DB** |

### Git 未跟踪（换机器 clone 会丢）

```
?? apps/web/src/assets/
?? apps/service-ppt-renderer/assets/
```

含壁纸、macOS 图标、16MB 字体。新环境 `git clone` 后 PPT 视频/桌面 UI 会再坏，**与数据库无关**。

---

## 3. 启动脚本差异

| 能力 | `dev.sh` | `start-all.sh` |
|------|----------|----------------|
| 等待 PostgreSQL | ✅ `wait_for_database` | ❌ 仅 grep 容器名 |
| Diagram DB migrate | ✅ | ❌ |
| PPT DB migrate | ✅ | ⚠️ 失败仅 warn |
| Homebrew PATH / FFmpeg | ✅（已加） | ❌ |
| 前端 | Vite HMR :5173 | 预构建 + 网关 :8080 |

用 `start-all.sh` 时若 Diagram 表未建全，需手动跑一次 Diagram migrate。

---

## 4. 存储与 checkpoint（非 PostgreSQL）

| 路径 | 内容 |
|------|------|
| `storage/exports/` | PPT 导出视频/PPTX（Node 侧车） |
| `storage/fonts/` | 运行时复制的字幕字体 |
| `storage/langgraph/checkpoints.sqlite` | PPT 流水线 LangGraph 状态 |
| Docker 内 `STORAGE_DIR=/data/storage` | 生产 compose 挂载 |

迁移目录**不会**搬这些文件；旧数据仍在原 `storage/` 卷或本机目录。

---

## 5. 对你问题的直接回答

> 会不会影响「修改数据库」？

- **不会**因为改了前端 FSD 路径而改到错误的数据库——只要 `DIAGRAM_DATABASE_URL` 与 `PPT_DATABASE_URL`/`DATABASE_URL` 保持分离。
- **不会**因为迁移而自动删表删数据；当前 migrate 策略是增量建表。
- **会**影响的是：连错库（配置误改）、迁移脚本跑失败（compose/Prisma 报错）、新机器缺资源/FFmpeg 导致功能不可用——这些看起来像「坏了」，但不是 silent 数据损坏。

---

## 6. 建议后续（按优先级）

1. **把 `apps/web/src/assets` 与 `apps/service-ppt-renderer/assets/fonts` 纳入 git**（或 LFS），避免 clone 即缺资源。
2. **更新 deployment / subtitle 相关测试**中的旧路径。
3. **`start-all.sh` 对齐 `dev.sh`**：PATH、`wait_for_database`、Diagram migrate。
4. **根 `.env.example` 注释强调**：切勿删除 `DIAGRAM_DATABASE_URL`。
