-- Resume lab drafts: structured resume document, AI coaching chat and score history.
-- Rows are isolated per account by (tenant_id, owner_id); owner_id is "user:<id>" or "guest:<id>".
-- Guest drafts are only written when RESUME_LAB_GUEST_PERSIST=true; otherwise they live in the browser.
CREATE TABLE IF NOT EXISTS recruit_resume_drafts (
    id VARCHAR NOT NULL PRIMARY KEY,
    tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
    owner_id VARCHAR NOT NULL,
    candidate_id VARCHAR REFERENCES recruit_candidates (id),
    job_id VARCHAR REFERENCES recruit_jobs (id),
    title VARCHAR NOT NULL DEFAULT '',
    -- {"basics": {...}, "summary": "", "education": [...], "experience": [...], ...}
    document_json JSON,
    -- [{"id", "role": user|assistant|score, "content", "changes", "before", "undone", "score_id", "created_at"}]
    messages_json JSON,
    -- [{"id", "label", "revision", "total_score", "max_score", "recommendation", "score_report", ...}]
    scores_json JSON,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_recruit_resume_drafts_tenant_id ON recruit_resume_drafts (tenant_id);
CREATE INDEX IF NOT EXISTS ix_recruit_resume_drafts_owner_id ON recruit_resume_drafts (owner_id);
CREATE INDEX IF NOT EXISTS ix_recruit_resume_drafts_candidate_id ON recruit_resume_drafts (candidate_id);
CREATE INDEX IF NOT EXISTS ix_recruit_resume_drafts_job_id ON recruit_resume_drafts (job_id);
CREATE INDEX IF NOT EXISTS ix_recruit_resume_drafts_created_at ON recruit_resume_drafts (created_at);
CREATE INDEX IF NOT EXISTS ix_recruit_resume_drafts_updated_at ON recruit_resume_drafts (updated_at);

-- Draft list / candidate lookup: WHERE tenant_id = ? AND owner_id = ? ORDER BY updated_at DESC.
CREATE INDEX IF NOT EXISTS ix_recruit_resume_drafts_owner_recent
    ON recruit_resume_drafts (tenant_id, owner_id, updated_at DESC);
