export interface StageDefinition {
  stage_number: number;
  name: string;
  title: string;
  purpose: string;
  common_responses: string[];
  outcome_options: string[];
  next_stage_name: string | null;
  has_exact_words_prominent: boolean;
}

export interface StageResult {
  id?: string;
  call_id?: string;
  stage_number: number;
  selected_outcome: string | null;
  prospect_exact_words: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AISummary {
  summary: string;
  outcome_rationale: string;
  suggested_next_action: string;
  suggested_follow_up_timing: string | null;
  generated_at?: string;
}

export interface Call {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone_number: string | null;
  context: string | null;
  status: "in_progress" | "completed";
  current_stage: number;
  highest_stage: number;
  final_outcome: string | null;
  next_action: string | null;
  follow_up_time: string | null;
  follow_up_channel: string | null;
  ai_summary: AISummary | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  stage_results?: StageResult[];
}

export interface CreateCallPayload {
  company_name: string;
  contact_name?: string;
  phone_number?: string;
  context?: string;
}

export interface CloseCallPayload {
  final_outcome: string;
  next_action?: string;
  follow_up_time?: string;
  follow_up_channel?: string;
}

export interface SummaryResponse {
  call_id: string;
  available: boolean;
  error?: string | null;
  summary?: AISummary | null;
}
