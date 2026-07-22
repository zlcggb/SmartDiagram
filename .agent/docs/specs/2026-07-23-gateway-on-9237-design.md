# 统一网关使用 9237 端口

## 背景

宝塔已将公网域名反向代理到 `127.0.0.1:9237`。当前 Compose 却把该宿主机端口分配给只提供 SPA、`/api` 和 `/drawio` 的 frontend 容器；包含 `/ppt-api` 路由的 gateway 默认尝试绑定已被宝塔占用的 80 端口。

## 已批准设计

- 宝塔保持反向代理 `127.0.0.1:9237`，无需修改域名或证书。
- gateway 独占宿主机 9237，统一路由 `/`、`/api/`、`/ppt-api/` 和 `/drawio/`。
- frontend 取消宿主机端口映射，只通过 Docker 内网的 `frontend:80` 供 gateway 访问。
- 根目录 `.env` 的 `GATEWAY_PORT` 仍可覆盖，默认值从 80 改为 9237。

## 切换与回滚

Compose 在同一次 `up -d` 中重建 frontend 和 gateway：先释放 frontend 的宿主机 9237，再由 gateway 绑定。切换后检查 gateway、主 API 和 PPT API 健康端点。如需回滚，恢复上一提交并重新 `docker compose up -d`，数据卷不受端口映射变更影响。

## 验收标准

- Compose 解析后 frontend 没有宿主机端口映射。
- gateway 默认发布 `9237:80`。
- `http://127.0.0.1:9237/nginx-health` 、`/api/health` 和 `/ppt-api/api/health` 均可用。
- 数据库、用户文件卷和宝塔反代配置不变。
