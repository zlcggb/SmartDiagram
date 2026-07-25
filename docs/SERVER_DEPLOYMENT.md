# 服务器安全更新与数据库迁移

`deploy.sh` 面向一台安装了 Docker Compose V2 的 Linux 服务器。更新流程遵循：

1. 检查代码、环境和 Compose 配置；
2. 使用 `pg_dump` 备份 `smartdiagram` 与 `ppt_agent`；
3. 只读归档知识库、上传资料、PPT 音视频及导出文件卷；
4. 构建新镜像；
5. 检查迁移中是否含 `DROP`、`TRUNCATE` 或 `DELETE FROM`；
6. 执行增量迁移，再替换应用容器；
7. 检查主 API、统一网关和 PPT API。

脚本不会运行 `docker compose down -v`、`docker volume prune`，也不会重建数据库卷。
为保证数据库与文件备份处于一致时间点，备份和最终迁移切换时会短暂停止业务写入，完成后自动恢复；镜像构建期间服务仍保持在线。

## 宝塔面板与国内镜像

项目不会修改 `/etc/docker/daemon.json`，避免覆盖宝塔维护的 Docker 设置。深圳等国内服务器建议在宝塔面板进入：

```text
Docker → 设置 → 修改加速 URL → https://docker.1ms.run → 保存 → 重启 Docker
```

重启后先做真实拉取检查：

```bash
./deploy.sh --check-mirror
```

检查通过后再运行更新。部署脚本也会在备份和迁移前自动执行同一检查，因此镜像网络异常不会影响数据库和业务容器。国内环境会自动把构建所需的 `ghcr.io/astral-sh/uv` 切换为 `ghcr.1ms.run/astral-sh/uv`，并预拉取实际使用的两个 UV 镜像；海外环境保持官方 GHCR 地址。

宝塔站点只需反向代理统一 **gateway**，不要直接代理 `web` 或 `api-diagram`。根目录 `.env` 保持：

```dotenv
GATEWAY_PORT=9237
```

宝塔反向代理目标为 `http://127.0.0.1:9237`。该端口由 gateway 独占，再在 Docker 内网中分流到 `web`、主 API、PPT API 和 Draw.io；`web` 不再直接发布宿主机端口。旧服务器如果 `.env` 仍是 `GATEWAY_PORT=80`，更新前必须改为 9237，否则会与宝塔 Nginx/Apache 冲突。

如果使用自建 Harbor 或其他代理，可以在根目录 `.env` 覆盖：

```dotenv
UV_IMAGE=你的镜像仓库/astral-sh/uv:0.10.5
UV_PYTHON_IMAGE=你的镜像仓库/astral-sh/uv:python3.13-bookworm-slim
```

脚本还会检查旧版 `smartdiagram-backend` 是否把上传文件留在容器内部。如果 `/app/storage` 有文件但没有挂载命名卷，会先复制到本次备份目录，再仅在 `knowledgedata` 目标卷为空时自动导入。目标卷已有内容时会停止，绝不覆盖现有文件。

## 已部署服务器的一键更新

在服务器项目目录运行：

```bash
cd /你的路径/SmartDiagram
git status --short
./deploy.sh --update --with-worker
```

如果之前启用了 Qdrant，更新时继续带上相同 profile：

```bash
./deploy.sh --update --with-worker --with-qdrant
```

`--update` 会拉取 `origin/main`，自动备份、迁移、更新并健康检查。服务器工作区有未提交修改时会主动停止，避免覆盖服务器文件。

若代码已由 CI、面板或人工提前拉取，只需：

```bash
./deploy.sh --with-worker
```

## 首次部署

```bash
cp .env.example .env
```

根目录 `.env` 按 **Platform / Diagram / PPT** 三分区统一管理全部密钥。
`apps/api-diagram/.env` 仅可选本机覆盖，默认留空即可。
填写密钥后运行：

```bash
./deploy.sh --with-worker
```

生产环境第一次初始化前必须替换根目录 `.env` 的 `DB_PASSWORD`。已经部署过的服务器必须继续使用原来的数据库密码；直接修改 Compose 环境变量不会修改 PostgreSQL 卷内保存的用户密码。

## 单独备份

```bash
./deploy.sh --backup
```

每次备份位于 `backups/<UTC时间>/`，目录权限为 `0700`，包括：

- `smartdiagram.dump`：主业务库；
- `ppt_agent.dump`：PPT 项目库；
- `roles.sql`：数据库角色与权限；
- `user-volumes.tar.gz`：上传、知识库、PPT 生成文件和 Qdrant 文件；
- `MANIFEST.txt` 与 `SHA256SUMS`：版本信息和完整性校验。

建议定期把整个备份目录同步到另一台机器或对象存储。只把备份留在同一块服务器磁盘上，无法防止磁盘损坏。

## 失败时如何处理

迁移或健康检查失败时，脚本立即退出并显示备份路径，不会删除数据库或用户卷。先检查：

```bash
./deploy.sh --status
./deploy.sh --logs
```

数据库恢复会覆盖当前状态，因此脚本不提供无确认的一键恢复。需要恢复时，应先保留故障现场，再由运维人员使用对应备份执行 `pg_restore`；不要直接删除 `pgdata`、`pptdata` 或 `knowledgedata` 卷。

## 安全停止与磁盘清理

```bash
./deploy.sh --down
./deploy.sh --clean
```

`--down` 只停止并移除容器网络，保留命名卷。`--clean` 只清理悬空镜像、旧构建缓存和停止的容器，不清理数据卷。
