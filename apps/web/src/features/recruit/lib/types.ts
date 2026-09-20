export interface RecruitDimensionScore {
  key: string
  label: string
  score: number
  max_score: number
  reason: string
}

export interface RecruitScreeningSummary {
  screening_id: string
  total_score: number
  max_score: number
  recommendation: string
  overall_summary: string
  evaluation_mode: 'ai' | 'fallback' | string
  matched_signals: string[]
  strengths: string[]
  risks: string[]
  interview_questions: string[]
  dimension_scores: RecruitDimensionScore[]
  evidence_excerpt: string
  created_at: string
}

export interface RecruitJobSummary {
  job_id: string
  title: string
  department: string
  location: string
  employment_type: string
  status: string
  hiring_manager: string
  recruiter: string
  priority: string
  headcount: number
  description: string
  requirements: string
  stage_config: Array<{ key: string; label: string }>
  tags: string[]
  candidate_count: number
  created_at: string
  updated_at: string
}

export interface RecruitCandidateSummary {
  candidate_id: string
  job_id: string
  job_title: string
  full_name: string
  email: string
  phone: string
  current_company: string
  location: string
  source_channel: string
  status: string
  current_stage: string
  ranking: string
  portfolio_url: string
  linkedin_url: string
  summary: string
  notes: string
  tags: string[]
  latest_screening: RecruitScreeningSummary | null
  interview_count: number
  created_at: string
  updated_at: string
}

export interface RecruitInterviewRecord {
  interview_id: string
  interview_type: string
  stage: string
  interviewer: string
  scheduled_at: string | null
  decision: string
  score: number | null
  notes: string
  summary: string
  created_at: string
  updated_at: string
  candidate_name?: string
  job_id?: string
}

export interface RecruitQuestionSet {
  question_set_id: string
  title: string
  questions: string[]
  source: string
  created_at: string
}

export interface RecruitResumeRecord {
  resume_id: string
  filename: string
  mime_type: string
  route_mode: string
  processing_status: string
  parsed_text: string
  created_at: string
}

export interface RecruitActivityRecord {
  activity_id: string
  activity_type: string
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface RecruitJobDetail {
  job: RecruitJobSummary
  pipeline: Array<{ stage: string; label: string; count: number }>
  candidates: RecruitCandidateSummary[]
}

export interface RecruitCandidateDetail {
  candidate: RecruitCandidateSummary
  job: RecruitJobSummary | null
  resumes: RecruitResumeRecord[]
  screenings: RecruitScreeningSummary[]
  interviews: RecruitInterviewRecord[]
  question_sets: RecruitQuestionSet[]
  activities: RecruitActivityRecord[]
}

export interface RecruitDashboard {
  summary: {
    job_count: number
    candidate_count: number
    interview_count: number
    strong_match_count: number
  }
  pipeline: Array<{ stage: string; count: number }>
  sources: Array<{ source: string; count: number }>
  recent_candidates: RecruitCandidateSummary[]
  open_jobs: RecruitJobSummary[]
}

export interface RecruitAnalytics {
  average_score: number
  stage_breakdown: Array<{ stage: string; count: number }>
  source_breakdown: Array<{ source: string; count: number }>
  job_breakdown: Array<{
    job_id: string
    title: string
    candidate_count: number
    screen_pass_count: number
    offer_count: number
  }>
  interview_load: Array<{ stage: string; count: number }>
}

export interface CreateRecruitJobInput {
  title: string
  department: string
  location: string
  employment_type: string
  status: string
  hiring_manager: string
  recruiter: string
  priority: string
  headcount: number
  description: string
  requirements: string
  tags: string
}

export interface CreateRecruitCandidateInput {
  job_id: string
  full_name: string
  email: string
  phone: string
  current_company: string
  location: string
  source_channel: string
  portfolio_url: string
  linkedin_url: string
  summary: string
  notes: string
  tags: string
  resume_text: string
  file: File | null
}

export interface CreateInterviewInput {
  interview_type: string
  stage: string
  interviewer: string
  scheduled_at: string
  decision: string
  score: string
  notes: string
  summary: string
}
