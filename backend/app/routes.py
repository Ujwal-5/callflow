from fastapi import APIRouter, HTTPException, Query, status
from typing import List, Optional, Dict, Any
from backend.app.models import (
    CallCreate,
    CallResponse,
    CallDetailResponse,
    StageResultUpdate,
    StageResultResponse,
    CallClose,
    StageDefinition,
    AISummary,
)
from backend.app.stages_data import STAGES
from backend.app.db import db
from backend.app.llm import generate_call_summary

router = APIRouter()


@router.get("/stages", response_model=List[StageDefinition], tags=["Stages"])
def get_stages():
    """Return all eight cold-call workflow stage definitions."""
    return STAGES


@router.post("/calls", response_model=CallResponse, status_code=status.HTTP_201_CREATED, tags=["Calls"])
def create_call(payload: CallCreate):
    """Create a new cold call session."""
    if not payload.company_name or not payload.company_name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Company name is required."
        )
    created = db.create_call(
        company_name=payload.company_name,
        contact_name=payload.contact_name,
        phone_number=payload.phone_number,
        context=payload.context,
    )
    return created


@router.get("/calls", response_model=List[CallResponse], tags=["Calls"])
def list_calls(
    search: Optional[str] = Query(None, description="Search by company or contact name"),
    outcome: Optional[str] = Query(None, description="Filter by final outcome"),
    stage: Optional[int] = Query(None, ge=1, le=8, description="Filter by highest stage reached"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by call status (in_progress, completed)"),
):
    """List calls with optional search and filters."""
    calls = db.list_calls(
        search=search,
        outcome=outcome,
        stage=stage,
        status=status_filter,
    )
    return calls


@router.get("/calls/{call_id}", response_model=CallDetailResponse, tags=["Calls"])
def get_call(call_id: str):
    """Retrieve call details including all recorded stage results."""
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )
    return call


@router.put("/calls/{call_id}/stages/{stage_number}", response_model=StageResultResponse, tags=["Stages"])
def update_stage_result(call_id: str, stage_number: int, payload: StageResultUpdate):
    """Create or update a stage result for a call. Validates stage number 1-8."""
    if stage_number < 1 or stage_number > 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stage number must be between 1 and 8. Received: {stage_number}"
        )

    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )

    res = db.upsert_stage_result(
        call_id=call_id,
        stage_number=stage_number,
        selected_outcome=payload.selected_outcome,
        prospect_exact_words=payload.prospect_exact_words,
        notes=payload.notes,
    )
    return res


@router.post("/calls/{call_id}/advance", response_model=CallDetailResponse, tags=["Calls"])
def advance_call_stage(call_id: str, stage_number: int = Query(..., ge=1, le=8)):
    """Advance the current active stage of the call."""
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )
    updated = db.advance_stage(call_id, stage_number)
    return updated


@router.post("/calls/{call_id}/close", response_model=CallDetailResponse, tags=["Calls"])
def close_call(call_id: str, payload: CallClose):
    """Close a call and record final outcome, next action, and follow-up details."""
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )

    closed = db.close_call(
        call_id=call_id,
        final_outcome=payload.final_outcome,
        next_action=payload.next_action,
        follow_up_time=payload.follow_up_time,
        follow_up_channel=payload.follow_up_channel,
    )
    return closed


@router.post("/calls/{call_id}/summary", tags=["LLM"])
async def summarize_call(call_id: str):
    """Generate concise AI call summary and suggested next actions via Gemini."""
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )

    result = await generate_call_summary(call)
    if result.get("available") and result.get("summary"):
        # Persist generated summary to call record
        db.update_call_summary(call_id, result["summary"])
        call["ai_summary"] = result["summary"]

    return {
        "call_id": call_id,
        "available": result.get("available", False),
        "error": result.get("error"),
        "summary": result.get("summary") or call.get("ai_summary"),
    }
