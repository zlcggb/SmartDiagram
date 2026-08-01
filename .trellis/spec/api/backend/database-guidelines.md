# api (service-ppt-renderer) — Database Guidelines

## ORM: Prisma (Node.js)

### Client

```typescript
// lib/prisma.ts — singleton Prisma client
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export default prisma;
```

### Schema Location

Prisma schema: `apps/service-ppt-renderer/prisma/schema.prisma`

### Database

- **Database**: `ppt_agent` (PostgreSQL)
- **Env var**: `DATABASE_URL`

### Migration

```bash
cd apps/service-ppt-renderer
npx prisma migrate dev --name <name>
```

### Transaction Pattern

Design version writes use a transaction helper:

```typescript
// lib/slideDesignVersions.ts
export async function createDesignVersion(
  prisma: PrismaClient,
  data: DesignVersionInput
) {
  return prisma.$transaction(async (tx) => {
    // ... multi-step write
  });
}
```

### Forbidden

- ❌ Raw SQL unless Prisma can't express the query
- ❌ Creating PrismaClient instances outside `lib/prisma.ts`
- ❌ Accessing `smartdiagram` database from this service (use `ppt_agent` only)
