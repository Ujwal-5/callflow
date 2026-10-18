from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class CallCreate(BaseModel):
    company_name: str = Field(..., min_length=1, description="Company or prospect organization name")
    contact_name: Optional[str] = Field(None, description="Contact person name")
    phone_number: Optional[str] = Field(None, description="Phone number")
    context: Optional[str] = Field(None, description="Brief call background or lead context")


class StageResultUpdate(BaseModel):
    selected_outcome: Optional[str] = Field(None, description="Selected mutually exclusive stage outcome")
    prospect_exact_words: Optional[str] = Field(None, description="Prospect's verbatim words")
    notes: Optional[str] = Field(None, description="Additional notes for this stage")


class StageResultResponse(BaseModel):
    id: str
    call_id: str
    stage_number: int
    selected_outcome: Optional[str] = None
    prospect_exact_words: Optional[str] = None
    notes: Optional[str] = None
    created_at: str
    updated_at: str


class CallClose(BaseModel):
    final_outcome: str = Field(..., min_length=1, description="Final call outcome")
    next_action: Optional[str] = Field(None, description="Agreed next step or action")
    follow_up_time: Optional[str] = Field(None, description="Follow-up date/time")
    follow_up_channel: Optional[str] = Field(None, description="Follow-up channel e.g. Email, WhatsApp, Phone")


class AISummary(BaseModel):
    summary: str
    outcome_rationale: str
    suggested_next_action: str
    suggested_follow_up_timing: Optional[str] = None
    generated_at: Optional[str] = None


class CallResponse(BaseModel):
    id: str
    company_name: str
    contact_name: Optional[str] = None
    phone_number: Optional[str] = None
    context: Optional[str] = None
    status: str
    current_stage: int
    highest_stage: int
    final_outcome: Optional[str] = None
    next_action: Optional[str] = None
    follow_up_time: Optional[str] = None
    follow_up_channel: Optional[str] = None
    ai_summary: Optional[Dict[str, Any]] = None
    started_at: str
    ended_at: Optional[str] = None
    created_at: str
    updated_at: str



class StageDefinition(BaseModel):
    stage_number: int
    name: str
    title: str
    purpose: str
    common_responses: List[str]
    outcome_options: List[str]
    next_stage_name: Optional[str] = None
    has_exact_words_prominent: bool = False


class HealthResponse(BaseModel):
    status: str
    service: str
    database_mode: str
    gemini_configured: bool
    version: str = "1.0.0"


class TranscriptResponse(BaseModel):
    id: str
    call_id: str
    status: str  # pending | processing | completed | failed
    raw_transcript: Optional[str] = None
    edited_transcript: Optional[str] = None
    transcript_metadata: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    created_at: str
    updated_at: str


class EditTranscriptPayload(BaseModel):
    edited_transcript: str = Field(..., description="User-edited transcript text to persist")


class CommitmentCreate(BaseModel):
    action: str = Field(..., min_length=1, description="Concise description of what must happen")
    responsible_party: str = Field("unknown", description="caller, prospect, another_person, or unknown")
    commitment_status: str = Field("uncertain", description="explicitly_agreed, promised, requested, suggested, or uncertain")
    due_at: Optional[str] = Field(None, description="Exact ISO date/time if reliably established")
    relative_due: Optional[str] = Field(None, description="Phrases preserving original wording, e.g., 'in 30 minutes'")
    channel: str = Field("unknown", description="phone, email, WhatsApp, Google Meet, or unknown")
    evidence_quote: str = Field(..., min_length=1, description="Exact supporting words from transcript")
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    needs_confirmation: bool = Field(False)
    status: str = Field("pending", description="pending, confirmed, completed, or dismissed")


class CommitmentUpdate(BaseModel):
    action: Optional[str] = None
    responsible_party: Optional[str] = None
    commitment_status: Optional[str] = None
    due_at: Optional[str] = None
    relative_due: Optional[str] = None
    channel: Optional[str] = None
    confidence: Optional[float] = None
    needs_confirmation: Optional[bool] = None
    status: Optional[str] = None


class CommitmentResponse(BaseModel):
    id: str
    call_id: str
    action: str
    responsible_party: str
    commitment_status: str
    due_at: Optional[str] = None
    relative_due: Optional[str] = None
    channel: str
    evidence_quote: str
    confidence: float
    needs_confirmation: bool
    status: str
    created_at: str
    updated_at: str


class MissedOpportunityCreate(BaseModel):
    type: str = Field(..., description="need_not_explored, objection_unresolved, question_unanswered, referral_untracked, meeting_unconfirmed, or no_next_step")
    severity: str = Field("medium", description="low, medium, or high")
    description: str = Field(..., min_length=1)
    evidence_quote: str = Field(..., min_length=1)
    why_it_matters: str = Field(..., min_length=1)
    suggested_action: str = Field(..., min_length=1)
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    needs_confirmation: bool = Field(False)
    status: str = Field("pending", description="pending, confirmed, or dismissed")


class MissedOpportunityUpdate(BaseModel):
    severity: Optional[str] = None
    description: Optional[str] = None
    suggested_action: Optional[str] = None
    status: Optional[str] = None


class MissedOpportunityResponse(BaseModel):
    id: str
    call_id: str
    type: str
    severity: str
    description: str
    evidence_quote: str
    why_it_matters: str
    suggested_action: str
    confidence: float
    needs_confirmation: bool
    status: str
    created_at: str
    updated_at: str


class CallDetailResponse(CallResponse):
    stage_results: List[StageResultResponse] = []
    commitments: List[CommitmentResponse] = []
    missed_opportunities: List[MissedOpportunityResponse] = []
    conversation_gaps: List["ConversationGapResponse"] = []



class HistoricalMatch(BaseModel):
    transcript_id: str
    company: Optional[str] = None
    recorded_outcome: str
    quote: str
    relevance: str
    category: Optional[str] = None


class RadarAnalyzePayload(BaseModel):
    transcript: Optional[str] = Field(None, description="Optional dialogue text to analyze. If omitted, uses the latest saved transcript.")


class RadarAnalysisResponse(BaseModel):
    call_id: str
    commitments: List[CommitmentResponse]
    missed_opportunities: List[MissedOpportunityResponse]
    historical_matches: List[HistoricalMatch]
    analysis_summary: str


class ConversationGapCreate(BaseModel):
    type: str = Field(..., description="missed_discovery, unresolved_question, unconfirmed_agreement, unaddressed_objection, unexplored_referral")
    severity: str = Field("medium", description="low, medium, or high")
    title: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    evidence_quote: str = Field(..., min_length=1)
    context_quote: Optional[str] = None
    why_it_matters: str = Field(..., min_length=1)
    suggested_action: str = Field(..., min_length=1)
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    status: str = Field("open", description="open, resolved, or dismissed")
    commitment_id: Optional[str] = None


class ConversationGapUpdate(BaseModel):
    severity: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    why_it_matters: Optional[str] = None
    suggested_action: Optional[str] = None
    confidence: Optional[float] = None
    status: Optional[str] = None
    commitment_id: Optional[str] = None


class ConversationGapResponse(BaseModel):
    id: str
    call_id: str
    type: str
    severity: str
    title: str
    description: str
    evidence_quote: str
    context_quote: Optional[str] = None
    why_it_matters: str
    suggested_action: str
    confidence: float
    status: str
    commitment_id: Optional[str] = None
    created_at: str
    updated_at: str


class GapAnalyzePayload(BaseModel):
    transcript: Optional[str] = Field(None, description="Optional dialogue text to analyze. If omitted, uses the latest saved transcript.")


class ConversationGapsAnalysisResponse(BaseModel):
    call_id: str
    findings: List[ConversationGapResponse]
    total_gaps: int
    summary: str


