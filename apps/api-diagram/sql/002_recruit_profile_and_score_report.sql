-- Persist structured resume evidence and the explainable screening report.
-- Existing rows remain readable; legacy rows can be backfilled on detail read.
ALTER TABLE recruit_resumes
    ADD COLUMN IF NOT EXISTS profile_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE recruit_screening_results
    ADD COLUMN IF NOT EXISTS report_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE recruit_screening_results
    ALTER COLUMN score_version SET DEFAULT 'evidence-v2';
