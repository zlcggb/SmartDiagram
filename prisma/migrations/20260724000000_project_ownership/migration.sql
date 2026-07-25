-- Existing rows cannot be attributed safely. Quarantine them as legacy instead
-- of exposing them to the first user who happens to request their ID.
ALTER TABLE "Project"
ADD COLUMN IF NOT EXISTS "ownerType" TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE "Project"
ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

ALTER TABLE "Project"
ADD COLUMN IF NOT EXISTS "ownerKey" TEXT;

ALTER TABLE "Project"
ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Project_ownerType_tenantId_ownerKey_updatedAt_idx"
ON "Project"("ownerType", "tenantId", "ownerKey", "updatedAt");

CREATE INDEX IF NOT EXISTS "Project_ownerType_expiresAt_idx"
ON "Project"("ownerType", "expiresAt");

