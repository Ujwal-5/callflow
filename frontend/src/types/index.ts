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

export type StageStatus = "completed" | "skipped" | "not_applicable" | "in_progress" | "pending";

export interface StageResult {
  id?: string;
  call_id?: string;
  stage_number: number;
  selected_outcome: string | null;
  prospect_exact_words: string | null;
  notes: string | null;
  status?: StageStatus | string | null;
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
  referral_name?: string | null;
  referral_contact?: string | null;
  objection?: string | null;
  prospect_statement?: string | null;
  ai_summary: AISummary | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  stage_results?: StageResult[];
  commitments?: Commitment[];
  missed_opportunities?: MissedOpportunity[];
  conversation_gaps?: ConversationGap[];
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
  referral_name?: string;
  referral_contact?: string;
  objection?: string;
  prospect_statement?: string;
}

export interface StageSuggestion {
  has_suggestion: boolean;
  suggested_stage_number?: number | null;
  suggested_stage_name?: string | null;
  evidence_quote?: string | null;
  reason?: string | null;
  confidence: number;
}

export interface StageAssistRecommendation {
  stage_number: number;
  suggested_excerpt: string | null;
  excerpt_speaker: "prospect" | "caller" | "unknown";
  excerpt_uncertain: boolean;
  suggested_outcome: string | null;
  outcome_reason: string | null;
  evidence_quote: string | null;
  confidence: number;
}

export interface SummaryResponse {
  call_id: string;
  available: boolean;
  error?: string | null;
  summary?: AISummary | null;
}

export type TranscriptStatus = "pending" | "processing" | "completed" | "failed";

export interface Transcript {
  id: string;
  call_id: string;
  status: TranscriptStatus;
  raw_transcript: string | null;
  edited_transcript: string | null;
  transcript_metadata: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type CommitmentStatus =
  | "explicitly_agreed"
  | "promised"
  | "requested"
  | "suggested"
  | "uncertain";

export type ResponsibleParty = "caller" | "prospect" | "another_person" | "unknown";

export type CommitmentRecordStatus = "pending" | "confirmed" | "completed" | "dismissed";

export interface Commitment {
  id: string;
  call_id: string;
  action: string;
  responsible_party: ResponsibleParty;
  commitment_status: CommitmentStatus;
  due_at: string | null;
  relative_due: string | null;
  channel: string;
  evidence_quote: string;
  confidence: number;
  needs_confirmation: boolean;
  status: CommitmentRecordStatus;
  created_at: string;
  updated_at: string;
}

export type MissedOpportunityType =
  | "need_not_explored"
  | "objection_unresolved"
  | "question_unanswered"
  | "referral_untracked"
  | "meeting_unconfirmed"
  | "no_next_step";

export interface MissedOpportunity {
  id: string;
  call_id: string;
  type: MissedOpportunityType;
  severity: "low" | "medium" | "high";
  description: string;
  evidence_quote: string;
  why_it_matters: string;
  suggested_action: string;
  confidence: number;
  needs_confirmation: boolean;
  status: "pending" | "confirmed" | "dismissed";
  created_at: string;
  updated_at: string;
}

export interface HistoricalMatch {
  transcript_id: string;
  company?: string | null;
  recorded_outcome: string;
  quote: string;
  relevance: string;
  category?: string | null;
}

export interface RadarAnalysisResponse {
  call_id: string;
  commitments: Commitment[];
  missed_opportunities: MissedOpportunity[];
  historical_matches: HistoricalMatch[];
  analysis_summary: string;
}

export type ConversationGapType =
  | "missed_discovery"
  | "unresolved_question"
  | "unconfirmed_agreement"
  | "unaddressed_objection"
  | "unexplored_referral";

export type ConversationGapStatus = "open" | "resolved" | "dismissed";

export interface ConversationGap {
  id: string;
  call_id: string;
  type: ConversationGapType;
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  evidence_quote: string;
  context_quote?: string | null;
  why_it_matters: string;
  suggested_action: string;
  confidence: number;
  status: ConversationGapStatus;
  commitment_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationGapsResponse {
  call_id: string;
  findings: ConversationGap[];
  total_gaps: number;
  summary: string;
}

export interface Prospect {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone_number: string | null;
  context: string | null;
  is_custom: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProspectPayload {
  company_name: string;
  contact_name?: string;
  phone_number?: string;
  context?: string;
}

export interface FollowUpItem {
  id: string;
  call_id: string;
  company_name: string;
  contact_name: string | null;
  phone_number: string | null;
  action: string;
  due_at: string | null;
  relative_due: string | null;
  channel: string | null;
  evidence_quote: string | null;
  confidence: number;
  status: "pending" | "confirmed" | "completed" | "dismissed";
  created_at: string;
  updated_at: string | null;
  source: "commitment" | "call_next_action";
}

export interface UpdateFollowUpPayload {
  status?: string;
  due_at?: string;
  relative_due?: string;
  action?: string;
  channel?: string;
}

export type MainNavigationArea = "overview" | "prospects" | "followups" | "history" | "active";



