# Compose 暂停容器部署时序修复设计

## 根因

部署脚本在数据库迁移前暂停写入服务，但把 `resume_writers` 放在 `docker compose up` 之后。当 Compose 配置或镜像变化需要重建 backend、worker 或 PPT API 时，Docker 无法重建 paused 容器并返回 `cannot start a paused container`。

## 方案

采用“迁移完成后恢复，再执行 Compose 切换”：

1. 暂停写入服务。
2. 执行非破坏性数据库迁移。
3. 恢复本次暂停的服务。
4. 扫描当前 Compose 项目内仍为 paused 的服务并自动恢复。
5. 确认没有 paused 服务后执行 `compose up -d --remove-orphans`。
6. 完成健康检查；任何步骤失败仍由 ERR trap 恢复本次暂停的服务并保留备份。

当 `--update` 拉取的新提交修改了 `deploy.sh` 本身时，当前 Bash 进程会携带原始参数自动 `exec` 新脚本。新进程再次检查更新（此时无新增提交）后继续部署，避免拉到修复却仍执行内存中的旧函数。

## 备选方案

- 停止而非暂停写入服务：不会触发 paused 冲突，但停机时间更长。
- 使用 `--no-recreate`：会跳过新镜像或 Compose 配置，不能满足更新部署要求。

## 数据安全

修复只改变容器运行状态与执行顺序，不修改迁移 SQL，不删除容器、命名卷、数据库或用户文件。部署前备份与失败恢复逻辑保持不变。

## 验证

- 回归测试锁定 `migrate -> resume -> ensure no paused -> compose up` 顺序。
- 回归测试确认部署脚本能检测并恢复遗漏的 paused Compose 服务。
- 回归测试确认脚本自更新后会使用原始参数重新执行，且有单次重启保护。
- 运行 Shell 语法检查、部署安全测试及 Compose 配置校验。
