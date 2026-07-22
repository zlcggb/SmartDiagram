-- AlterTable
ALTER TABLE "Project" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'paste';
ALTER TABLE "Project" ADD COLUMN "topic" TEXT;
ALTER TABLE "Project" ADD COLUMN "briefJson" TEXT;
ALTER TABLE "Project" ADD COLUMN "researchJson" TEXT;

-- AlterTable
ALTER TABLE "Slide" ADD COLUMN "searchJson" TEXT;
ALTER TABLE "Slide" ADD COLUMN "partTitle" TEXT;
