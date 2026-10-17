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


class CallDetailResponse(CallResponse):
    stage_results: List[StageResultResponse] = []


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
