# api (service-ppt-renderer) — Backend Development Guidelines

> PPT Node 侧车服务：Fastify + Prisma + PPTX 渲染

---

## Pre-Development Checklist

1. [ ] Read the Prisma schema at `prisma/schema.prisma`
2. [ ] Check existing routes in `src/routes/`
3. [ ] Shared types come from `@ppt-agent/shared` package
4. [ ] Database is `ppt_agent`，env var is `DATABASE_URL`

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Database Guidelines](./database-guidelines.md) | Prisma patterns, migrations | Filled |
| [Error Handling](./error-handling.md) | Error types, handling strategies | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

---

## Quality Check

1. [ ] Schema changes reflected in `prisma/schema.prisma` + migration run
2. [ ] Shared DTOs defined in `packages/shared` not duplicated locally
3. [ ] Design version writes go through `lib/slideDesignVersions.ts` transaction helper
4. [ ] File storage uses `STORAGE_DIR` env var, not hardcoded paths

---

**Language**: English for code.
