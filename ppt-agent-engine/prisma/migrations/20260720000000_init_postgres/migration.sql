-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 6,
    "theme" TEXT NOT NULL DEFAULT 'unilumin-blue',
    "mode" TEXT NOT NULL DEFAULT 'paste',
    "topic" TEXT,
    "briefJson" TEXT,
    "researchJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceText" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceText_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourceText" TEXT NOT NULL,
    "sourceLocation" TEXT NOT NULL,
    "canUseInPpt" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slide" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "slideGoal" TEXT NOT NULL,
    "keyMessage" TEXT NOT NULL,
    "contentPoints" TEXT NOT NULL DEFAULT '[]',
    "recommendedLayout" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isContentLocked" BOOLEAN NOT NULL DEFAULT false,
    "isLayoutLocked" BOOLEAN NOT NULL DEFAULT false,
    "planJson" TEXT,
    "irJson" TEXT,
    "svgPreview" TEXT,
    "searchJson" TEXT,
    "partTitle" TEXT,
    "generationStatus" TEXT NOT NULL DEFAULT 'draft',
    "renderStrategy" TEXT,
    "strategyLocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Slide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlideNarration" (
    "id" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "scriptText" TEXT NOT NULL,
    "ttsText" TEXT NOT NULL,
    "voice" TEXT NOT NULL DEFAULT 'Kore',
    "model" TEXT NOT NULL DEFAULT 'gemini-3.1-flash-tts-preview',
    "prompt" TEXT,
    "languageCode" TEXT NOT NULL DEFAULT 'cmn-CN',
    "audioPath" TEXT,
    "audioDurationMs" INTEGER,
    "sourceHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlideNarration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlideSource" (
    "slideId" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "usageType" TEXT NOT NULL DEFAULT 'supporting',

    CONSTRAINT "SlideSource_pkey" PRIMARY KEY ("slideId","factId")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionName" TEXT NOT NULL,
    "pptxPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaExport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'video',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "optionsJson" TEXT NOT NULL DEFAULT '{}',
    "outputPath" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceText_projectId_idx" ON "SourceText"("projectId");

-- CreateIndex
CREATE INDEX "Fact_projectId_idx" ON "Fact"("projectId");

-- CreateIndex
CREATE INDEX "Fact_status_idx" ON "Fact"("status");

-- CreateIndex
CREATE INDEX "Slide_projectId_idx" ON "Slide"("projectId");

-- CreateIndex
CREATE INDEX "Slide_sortOrder_idx" ON "Slide"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SlideNarration_slideId_key" ON "SlideNarration"("slideId");

-- CreateIndex
CREATE INDEX "SlideNarration_status_idx" ON "SlideNarration"("status");

-- CreateIndex
CREATE INDEX "SlideSource_factId_idx" ON "SlideSource"("factId");

-- CreateIndex
CREATE INDEX "Export_projectId_idx" ON "Export"("projectId");

-- CreateIndex
CREATE INDEX "MediaExport_projectId_idx" ON "MediaExport"("projectId");

-- CreateIndex
CREATE INDEX "MediaExport_status_idx" ON "MediaExport"("status");

-- AddForeignKey
ALTER TABLE "SourceText" ADD CONSTRAINT "SourceText_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slide" ADD CONSTRAINT "Slide_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlideNarration" ADD CONSTRAINT "SlideNarration_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "Slide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlideSource" ADD CONSTRAINT "SlideSource_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "Slide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlideSource" ADD CONSTRAINT "SlideSource_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaExport" ADD CONSTRAINT "MediaExport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

