# 宝塔国内服务器 Docker 镜像策略

## 决策

服务器的 Docker daemon 与镜像加速由宝塔面板统一管理，项目部署脚本不得写入或替换 `/etc/docker/daemon.json`。国内环境优先使用宝塔当前合作加速节点 `https://docker.1ms.run`，但项目不把第三方节点硬编码为镜像名称，基础镜像仍保持标准 Docker Hub 名称，由 daemon mirror 代理。

PPT Dockerfile 不再声明远程 `docker/dockerfile` frontend，改用 Docker Engine 随 BuildKit提供的内置 frontend。这样能够保留 `RUN --mount` 构建能力，同时避免解析 Dockerfile 之前直接访问 `registry-1.docker.io`。

部署顺序增加网络前置检查：检测国内网络、只读显示当前 registry mirror，再真实拉取极小的 `hello-world` 镜像。失败时在数据库备份、迁移和业务容器替换之前终止，并对宝塔服务器输出明确的面板操作路径。该检查也可以通过 `./deploy.sh --check-mirror` 单独运行。

## 备选方案

- 项目内把每个镜像改成 `docker.1ms.run/...`：绕过 daemon 配置，但与单一第三方服务强耦合，不采用。
- 自建 Harbor/Registry pull-through cache：稳定性最佳，适合后续多服务器生产集群，本次单机部署暂不增加这套运维成本。

## 验证

- Shell 语法及 Compose 配置检查；
- 回归测试确保 Dockerfile 不再声明远程 frontend；
- 回归测试确保部署脚本不写 `daemon.json`；
- 国内服务器运行 `./deploy.sh --check-mirror`，确认实际 pull 成功后再更新。
