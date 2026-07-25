-- AlterTable
ALTER TABLE "Fact" ADD COLUMN "evidenceJson" TEXT;

-- CreateTable
CREATE TABLE "ProjectMaterial" (
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

    CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMaterial_projectId_knowledgeDocumentId_key"
ON "ProjectMaterial"("projectId", "knowledgeDocumentId");

-- CreateIndex
CREATE INDEX "ProjectMaterial_projectId_createdAt_idx"
ON "ProjectMaterial"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectMaterial_ingestionJobId_idx"
ON "ProjectMaterial"("ingestionJobId");

-- AddForeignKey
ALTER TABLE "ProjectMaterial"
ADD CONSTRAINT "ProjectMaterial_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
