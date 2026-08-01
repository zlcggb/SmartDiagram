# api (service-ppt-renderer) — Frontend Guidelines

> 此包的 "frontend" 层指 Fastify 路由层和 lib 层（对外 HTTP API 接口）

---

## Pre-Development Checklist

1. [ ] Read `src/app.ts` for route registration pattern
2. [ ] Check `lib/response.ts` for standard response helpers: `ok()`, `fail()`
3. [ ] Authorization via `lib/pptAuthorization.ts` — `getPptPrincipal()`
4. [ ] Shared types from `@ppt-agent/shared`

---

## Architecture

```
apps/service-ppt-renderer/src/
├── index.ts              # 服务入口
├── app.ts                # Fastify app builder (routes, plugins, auth)
├── routes/
│   ├── projects.ts       # 项目 CRUD + AI 生成调度
│   ├── materials.ts      # 素材上传 / 管理
│   ├── media.ts          # 媒体文件 (图片/视频)
│   ├── progress.ts       # SSE 进度流
│   └── slideDesignVersions.ts  # 设计版本历史 API
└── lib/
    ├── prisma.ts         # Prisma client 单例
    ├── ai.ts             # AI provider 配置
    ├── response.ts       # ok() / fail() 标准响应
    ├── pptAuthorization.ts     # 认证中间件
    ├── pptPrincipal.ts         # 用户身份解析
    ├── slideDesignVersions.ts  # 设计版本事务逻辑
    ├── paths.ts          # 存储路径
    └── ...
```

### Response Pattern

```typescript
import { ok, fail } from "../lib/response.js";

// ✅ Standard success
return ok(reply, { project });

// ✅ Standard error
return fail(reply, 404, "Project not found");
```

### Authorization

```typescript
import { getPptPrincipal } from "../lib/pptAuthorization.js";

const principal = getPptPrincipal(request);
if (!principal) return fail(reply, 401, "Unauthorized");
```

### Quality Check

1. [ ] Route handlers use `ok()` / `fail()` for responses
2. [ ] Auth check via `getPptPrincipal()` on protected routes
3. [ ] Design version writes use `slideDesignVersions.ts` transaction helper
4. [ ] Tests colocated: `*.test.ts` next to source
