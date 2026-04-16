// lib/supabase/types.ts
export type UserRole = 'admin' | 'user'
export type FileType = 'pdf' | 'docx' | 'xlsx' | 'txt'
export type ParseStatus = 'pending' | 'parsing' | 'done' | 'needs_review' | 'failed'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TaskStatus = 'pending' | 'running' | 'retrying' | 'done' | 'abandoned'
export type NotificationType =
  | 'job_completed'
  | 'job_failed'
  | 'job_cancelled'
  | 'parse_done'
  | 'parse_failed'

export interface ParseConfig {
  model_id: string
  system_prompt: string
}

export interface UserPreferences {
  parse_model_id: string
  parse_system_prompt: string
  search_model_ids: string[]
  strategy_ids: string[]
  per_task_limit: number
  report_limit: number
  report_model_id: string
  report_system_prompt: string
}

export interface Profile {
  id: string
  role: UserRole
  display_name: string | null
  preferences: UserPreferences | null
  created_at: string
}

export interface AIModel {
  id: string
  owner_id: string | null
  name: string
  api_base_url: string
  api_key_encrypted: string
  model_id: string
  is_builtin: boolean
  usage_types: string[]
  capabilities: { deep_reasoning: boolean; web_search: boolean }
  created_at: string
}

export interface SearchStrategy {
  id: string
  owner_id: string | null
  name: string
  prompt_template: string
  is_builtin: boolean
  created_at: string
}

export interface PatentDocument {
  id: string
  user_id: string
  title: string
  file_url: string
  file_type: FileType
  parse_status: ParseStatus
  parsed_data: {
    tech_theme?: string
    applicant?: string
    inventor?: string
    filing_date?: string
    main_tech_steps?: string
    core_invention?: string
    custom_fields?: Record<string, string>
  } | null
  parse_config: ParseConfig | null
  quality_warning: boolean
  user_notes: string | null
  created_at: string
}

export interface SearchJob {
  id: string
  user_id: string
  document_id: string
  status: JobStatus
  scheduled_at: string | null
  config: {
    model_ids: string[]
    strategy_ids: string[]
    per_task_limit: number
    report_limit: number
    report_model_id: string
  }
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface SearchTask {
  id: string
  job_id: string
  model_id: string
  strategy_id: string
  status: TaskStatus
  retry_count: number
  results: Array<{
    title: string
    authors: string
    url: string
    pub_date: string
    relevance_desc: string
    citation_gb: string
  }> | null
  error_msg: string | null
  started_at: string | null
  completed_at: string | null
}

export interface Report {
  id: string
  job_id: string
  user_id: string
  html_content: string
  selected_docs: Array<{
    rank: number
    title: string
    authors: string
    url: string
    pub_date: string
    relevance_desc: string
    citation_gb: string
    source_platform: string
    source_strategy: string
    source_task_id: string
    user_rating: 'useful' | 'irrelevant' | null
  }>
  doc_count: number
  path_summary: Record<string, unknown>
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  job_id: string | null
  type: NotificationType
  message: string
  read_at: string | null
  created_at: string
}
