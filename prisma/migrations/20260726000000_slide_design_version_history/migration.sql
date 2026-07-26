-- AlterTable
ALTER TABLE "Slide" ADD COLUMN "activeDesignVersionId" TEXT;

-- CreateTable
CREATE TABLE "SlideDesignVersion" (
    "id" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "svgPreview" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "theme" TEXT,
    "accentId" TEXT,
    "surfaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlideDesignVersion_pkey" PRIMARY KEY ("id")
);

-- Backfill one legacy version for every existing SVG.
WITH "legacyVersions" AS (
    INSERT INTO "SlideDesignVersion" (
        "id",
        "slideId",
        "svgPreview",
        "source",
        "theme",
        "createdAt"
    )
    SELECT
        CONCAT('legacy_', MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT || "Slide"."id")),
        "Slide"."id",
        "Slide"."svgPreview",
        'legacy',
        "Project"."theme",
        CURRENT_TIMESTAMP
    FROM "Slide"
    INNER JOIN "Project" ON "Project"."id" = "Slide"."projectId"
    WHERE "Slide"."svgPreview" IS NOT NULL
      AND BTRIM("Slide"."svgPreview") <> ''
    RETURNING "id", "slideId"
)
UPDATE "Slide"
SET "activeDesignVersionId" = "legacyVersions"."id"
FROM "legacyVersions"
WHERE "Slide"."id" = "legacyVersions"."slideId";

-- CreateIndex
CREATE INDEX "Slide_activeDesignVersionId_idx" ON "Slide"("activeDesignVersionId");

-- CreateIndex
CREATE INDEX "SlideDesignVersion_slideId_createdAt_idx" ON "SlideDesignVersion"("slideId", "createdAt");

-- AddForeignKey
ALTER TABLE "SlideDesignVersion"
ADD CONSTRAINT "SlideDesignVersion_slideId_fkey"
FOREIGN KEY ("slideId") REFERENCES "Slide"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slide"
ADD CONSTRAINT "Slide_activeDesignVersionId_fkey"
FOREIGN KEY ("activeDesignVersionId") REFERENCES "SlideDesignVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
