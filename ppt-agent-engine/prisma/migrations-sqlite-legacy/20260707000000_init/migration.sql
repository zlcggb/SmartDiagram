-- CreateTable
CREATE TABLE "Project" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "pageCount" INTEGER NOT NULL DEFAULT 6,
  "theme" TEXT NOT NULL DEFAULT 'unilumin-blue',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourceText" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceText_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Fact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "confidence" REAL NOT NULL,
  "sourceText" TEXT NOT NULL,
  "sourceLocation" TEXT NOT NULL,
  "canUseInPpt" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Fact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Slide" (
  "id" TEXT NOT NULL PRIMARY KEY,
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
  CONSTRAINT "Slide_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlideSource" (
  "slideId" TEXT NOT NULL,
  "factId" TEXT NOT NULL,
  "usageType" TEXT NOT NULL DEFAULT 'supporting',
  CONSTRAINT "SlideSource_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "Slide" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SlideSource_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY ("slideId", "factId")
);

-- CreateTable
CREATE TABLE "Export" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "versionName" TEXT NOT NULL,
  "pptxPath" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Export_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SourceText_projectId_idx" ON "SourceText" ("projectId");

-- CreateIndex
CREATE INDEX "Fact_projectId_idx" ON "Fact" ("projectId");

-- CreateIndex
CREATE INDEX "Fact_status_idx" ON "Fact" ("status");

-- CreateIndex
CREATE INDEX "Slide_projectId_idx" ON "Slide" ("projectId");

-- CreateIndex
CREATE INDEX "Slide_sortOrder_idx" ON "Slide" ("sortOrder");

-- CreateIndex
CREATE INDEX "SlideSource_factId_idx" ON "SlideSource" ("factId");

-- CreateIndex
CREATE INDEX "Export_projectId_idx" ON "Export" ("projectId");
