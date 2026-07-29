-- Restore the Slide IR column declared by the initial schema and extend
-- design history so SVG and SmartSlide versions can share one navigator.
ALTER TABLE "Slide"
ADD COLUMN IF NOT EXISTS "irJson" TEXT;

ALTER TABLE "SlideDesignVersion"
ADD COLUMN IF NOT EXISTS "irJson" TEXT;

ALTER TABLE "SlideDesignVersion"
ADD COLUMN IF NOT EXISTS "renderStrategy" TEXT NOT NULL DEFAULT 'svg';

