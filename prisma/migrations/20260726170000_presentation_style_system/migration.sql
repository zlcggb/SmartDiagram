ALTER TABLE "Project"
ADD COLUMN "presentationStyle" TEXT NOT NULL DEFAULT 'consulting';

ALTER TABLE "Slide"
ADD COLUMN "presentationStyle" TEXT;

ALTER TABLE "SlideDesignVersion"
ADD COLUMN "presentationStyle" TEXT;
