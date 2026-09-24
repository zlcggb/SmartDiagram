-- Add queryable, explainable ATS evidence to persisted screening results.
-- The SQLModel bootstrap creates new installations; this migration upgrades
-- existing PostgreSQL databases without dropping rows.
ALTER TABLE recruit_screening_results
    ADD COLUMN IF NOT EXISTS keyword_match_score DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE recruit_screening_results
    ADD COLUMN IF NOT EXISTS skills_coverage_score DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE recruit_screening_results
    ADD COLUMN IF NOT EXISTS section_completeness_score DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE recruit_screening_results
    ADD COLUMN IF NOT EXISTS score_version VARCHAR(32) NOT NULL DEFAULT 'hybrid-v1';

CREATE INDEX IF NOT EXISTS ix_recruit_screening_keyword_match
    ON recruit_screening_results (keyword_match_score);

CREATE INDEX IF NOT EXISTS ix_recruit_screening_skills_coverage
    ON recruit_screening_results (skills_coverage_score);

CREATE INDEX IF NOT EXISTS ix_recruit_screening_section_completeness
    ON recruit_screening_results (section_completeness_score);
