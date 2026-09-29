-- Add an explicit campus/social classification to recruiting jobs.
-- Existing jobs remain editable and are marked as unclassified until reviewed.
ALTER TABLE recruit_jobs
    ADD COLUMN recruitment_type VARCHAR(32) NOT NULL DEFAULT 'unspecified';

CREATE INDEX IF NOT EXISTS ix_recruit_jobs_recruitment_type
    ON recruit_jobs (recruitment_type);