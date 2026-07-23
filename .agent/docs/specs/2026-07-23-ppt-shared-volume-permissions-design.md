# PPT 共享卷权限自动初始化设计

## 背景与根因

`ppt-node-api` 与 `ppt-python-api` 共用 `pptdata:/data`。Node 镜像以 UID 1000 运行，Python 镜像以 UID 10001 运行。Docker 命名卷一旦创建，镜像构建阶段对 `/data` 的 `chown` 不会再次作用于该卷，因此先创建的 `/data/langgraph` 可能归 Node 所有，Python 启动时便无法创建 `checkpoints.sqlite`。

## 方案选择

- 采用：增加一次性 `ppt-storage-init` 服务。它以 root 运行，仅创建目录并校正属主与目录权限；两个 PPT API 在它成功完成后才启动。
- 不采用：让 Python API 永久以 root 运行。虽然简单，但扩大容器权限，不符合最小权限原则。
- 不采用：立即拆分为两个命名卷。新卷会引入现有 checkpoint 的迁移问题，风险和改动都更大。

## 数据安全

初始化过程不执行删除、覆盖或数据库迁移，只执行 `mkdir -p`、`chown` 与目录级 `chmod`。`/data/storage` 继续归 Node UID 1000，`/data/langgraph` 归 Python UID 10001，现有文件内容与命名卷均保留。

## 启动顺序

1. Compose 启动 `ppt-storage-init` 并挂载现有 `pptdata`。
2. 初始化服务校正两个子目录的权限并成功退出。
3. `ppt-node-api` 与 `ppt-python-api` 等待初始化成功后启动。
4. 现有 `deploy.sh` 继续执行网关与 PPT API 健康检查；失败时部署仍会明确报错。

## 验证

- 部署安全测试验证初始化服务无删除命令、UID 与目录映射正确、两个 API 都声明启动依赖。
- `docker compose config --quiet` 验证 Compose 配置有效。
- 运行现有部署安全测试，确保命名卷、备份和数据库迁移保护仍然成立。
