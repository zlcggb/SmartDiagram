# Draw.io 加载性能优化 — 统一域名反代 + iframe 持久化

## 问题根因

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| 1 | 加载慢（30s+） | 前端硬编码 `localhost:9022`，部署后浏览器访问的是用户自己电脑，必定超时 30s 后 fallback 到 `embed.diagrams.net` 在线版 | 每次至少等 30s |
| 2 | 在线 fallback 也慢 | diagrams.net CDN 在国内访问慢，整个编辑器 ~10MB JS/CSS | 额外 10-30s |
| 3 | 每次切换都重新加载 | `DrawioCanvas` 组件在 switch 中条件渲染，切换引擎时被卸载/重挂载，iframe 销毁重建 | 重复等待 |
| 4 | nginx 缺 drawio 代理 | `nginx.conf` 只代理了 `/api`，没有 drawio 路径 | 根本无法从域名访问 drawio |

## 方案设计

### 核心思路

```
用户浏览器 → yourdomain.com/drawio/ → nginx 反代 → drawio 容器(:8080)
```

与现有 `/api` 代理模式完全一致，drawio 挂载到同域名的 `/drawio/` 路径下。

### 架构变化

```diff
  ┌──────────────┐
  │  Nginx 前端   │
  │  location /   │ → 静态文件
  │  location /api│ → backend:8000
+ │  location /drawio/ │ → drawio:8080
  └──────────────┘
```

---

## 变更清单

### 1. [MODIFY] [nginx.conf](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/nginx.conf)

新增 `/drawio/` 反向代理块，指向 docker 内网 `drawio:8080`：

```nginx
# Draw.io 反向代理
location /drawio/ {
    proxy_pass http://drawio:8080/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # 缓存 draw.io 静态资源
    proxy_cache_valid 200 1d;
}
```

> [!IMPORTANT]
> `proxy_pass http://drawio:8080/;` 尾部 `/` 很关键 — 它会把 `/drawio/xxx` 映射为 `http://drawio:8080/xxx`（自动去掉前缀）。

同时需要在 `docker-compose.yml` 中让 frontend 容器依赖 drawio（确保启动顺序）。

---

### 2. [MODIFY] [docker-compose.yml](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/docker-compose.yml)

- frontend depends_on 增加 `drawio`
- drawio 的 `ports: - "9022:8080"` 可以保留（开发用）也可以去掉（生产不需要暴露）

---

### 3. [MODIFY] [DrawioCanvas.tsx](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/components/canvas/DrawioCanvas.tsx)

**简化为单 URL 策略**：

```typescript
// 开发环境用 localhost:9022（docker 直连），生产用 /drawio/（nginx 反代）
const DRAWIO_BASE = import.meta.env.DEV ? 'http://localhost:9022/' : '/drawio/';
const FALLBACK_URL = 'https://embed.diagrams.net/';
```

- 去掉 `source` state（local/remote 双源逻辑）
- 去掉 `iframeKey` 强制重挂载
- 保留 fallback：如果主 URL 30s 超时，再 fallback 到在线版（兜底）
- 超时从 30s 缩短到 10s（反代场景下几秒即可加载）

---

### 4. [MODIFY] [CanvasPanel.tsx](file:///Volumes/WorkData/项目app/app/DeepDiagram-Pro/SmartDiagram/frontend/src/components/layout/CanvasPanel.tsx)

**iframe 持久化**：drawio 首次激活后常驻 DOM，通过 CSS `display:none` 隐藏。

```tsx
// 记录 drawio 是否曾被激活
const [drawioMounted, setDrawioMounted] = useState(false);

useEffect(() => {
  if (canvasEngine === 'drawio') setDrawioMounted(true);
}, [canvasEngine]);

// 在 renderCanvas switch 中，drawio case 返回 null（因为它在外面独立渲染了）
// 在 canvas area 末尾追加：
{drawioMounted && (
  <div style={{ display: canvasEngine === 'drawio' ? 'contents' : 'none' }}
       className="absolute inset-0">
    <Suspense fallback={<CanvasLoader />}><DrawioCanvas /></Suspense>
  </div>
)}
```

这样切换到其他引擎再切回来时，iframe 不会被销毁重建，**几乎秒切**。

---

## 验证计划

### 本地验证
1. `npm run dev` — 确认开发环境仍然走 `localhost:9022` 正常工作
2. 在不同引擎间切换 — 确认 drawio iframe 不会重新加载

### 服务器验证
1. `docker compose up --build` — 重建部署
2. 浏览器访问 `yourdomain.com/drawio/` — 确认能直接打开 draw.io 编辑器
3. 使用 AI 生成架构图 — 确认 iframe 正常加载并渲染 XML
4. 切换到 mermaid 再切回 drawio — 确认**不重新加载**
