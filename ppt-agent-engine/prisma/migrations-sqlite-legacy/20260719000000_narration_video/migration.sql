CREATE TABLE "SlideNarration" (
  "id" TEXT NOT NULL PRIMARY KEY,
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
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SlideNarration_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "Slide" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SlideNarration_slideId_key" ON "SlideNarration"("slideId");
CREATE INDEX "SlideNarration_status_idx" ON "SlideNarration"("status");

CREATE TABLE "MediaExport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'video',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "optionsJson" TEXT NOT NULL DEFAULT '{}',
  "outputPath" TEXT,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MediaExport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MediaExport_projectId_idx" ON "MediaExport"("projectId");
CREATE INDEX "MediaExport_status_idx" ON "MediaExport"("status");
