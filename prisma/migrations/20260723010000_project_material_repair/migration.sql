-- Repair drifted databases where the original material migration was recorded
-- but ProjectMaterial was removed or never created. Every statement is safe to
-- run against databases where the table already exists.
CREATE TABLE IF NOT EXISTS "ProjectMaterial" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "knowledgeDocumentId" TEXT NOT NULL,
    "knowledgeSourceId" TEXT NOT NULL,
    "ingestionJobId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "routeMode" TEXT NOT NULL DEFAULT 'auto',
    "status" TEXT NOT NULL DEFAULT 'processing',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectMaterial_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMaterial_projectId_knowledgeDocumentId_key"
ON "ProjectMaterial"("projectId", "knowledgeDocumentId");

CREATE INDEX IF NOT EXISTS "ProjectMaterial_projectId_createdAt_idx"
ON "ProjectMaterial"("projectId", "createdAt");

CREATE INDEX IF NOT EXISTS "ProjectMaterial_ingestionJobId_idx"
ON "ProjectMaterial"("ingestionJobId");
