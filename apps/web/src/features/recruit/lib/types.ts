export interface RecruitDimensionScore {
  key: string
  label: string
  score: number
  max_score: number
  reason: string
}

export interface RecruitScreeningResult {
  candidate_name: string
  channel: string
  total_score: number
  max_score: number
  recommendation: string
  overall_summary: string
  job_summary: string
  matched_signals: string[]
  strengths: string[]
  risks: string[]
  interview_questions: string[]
  dimension_scores: RecruitDimensionScore[]
  evidence_excerpt: string
  source_name: string
  evaluation_mode: 'ai' | 'fallback'
  resume_filename: string
  parsed_blocks: number
}

export interface InterviewRecord {
  id: string
  stage: string
  interviewer: string
  decision: string
  score: number | null
  notes: string
  createdAt: string
}

export interface RecruitCandidateRecord {
  id: string
  candidateName: string
  channel: string
  jdTitle: string
  jdText: string
  resumeDraft: string
  createdAt: string
  screening: RecruitScreeningResult
  interviews: InterviewRecord[]
}
