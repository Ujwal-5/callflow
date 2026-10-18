from fastapi import APIRouter, HTTPException, Query, UploadFile, File, status
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
    TranscriptResponse,
    EditTranscriptPayload,
)
from backend.app.stages_data import STAGES
from backend.app.db import db
from backend.app.llm import generate_call_summary
from backend.app.transcription import validate_audio, transcribe_audio

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


# ──────────────────────────────────────────────────────────────────────────────
# Transcript endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.get(
    "/calls/{call_id}/transcript",
    response_model=Optional[TranscriptResponse],
    tags=["Transcript"],
)
def get_transcript(call_id: str):
    """Return the current transcript record for a call, or null if none exists."""
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )
    return db.get_transcript(call_id)


@router.post(
    "/calls/{call_id}/transcript",
    response_model=TranscriptResponse,
    tags=["Transcript"],
)
async def upload_and_transcribe(
    call_id: str,
    audio: UploadFile = File(..., description="Audio recording from the browser MediaRecorder API"),
):
    """Upload an audio file and transcribe it using Gemini 3.5 Transcribe.

    - Validates call ownership, file type, and file size server-side.
    - Prevents duplicate transcription requests by resetting the existing record.
    - Returns transcript status immediately; if processing completes synchronously,
      status will be 'completed' with raw_transcript populated.
    - Audio is processed in memory and never stored on disk.
    - Retry: calling this endpoint again on a failed transcript resets and retries.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    # Read audio data
    audio_bytes = await audio.read()
    content_type = audio.content_type or "audio/webm"

    # Server-side validation of file type and size
    validation_error = validate_audio(audio_bytes, content_type)
    if validation_error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=validation_error,
        )

    # Mark as processing (idempotent — resets a previous failed attempt)
    db.upsert_transcript_pending(call_id)

    try:
        transcript_text, metadata = await transcribe_audio(audio_bytes, content_type)

        if not transcript_text:
            # Model returned empty output (e.g., silence or inaudible audio)
            result = db.complete_transcript(
                call_id,
                raw_transcript="",
                transcript_metadata=metadata,
            )
        else:
            result = db.complete_transcript(
                call_id,
                raw_transcript=transcript_text,
                transcript_metadata=metadata,
            )

    except RuntimeError as exc:
        # User-friendly error — no stack trace exposed
        error_msg = str(exc)
        result = db.fail_transcript(call_id, error_msg)

    except Exception as exc:
        # Unexpected error — log full details but only return a generic message
        import logging
        logging.getLogger("callflow.routes").exception("Unexpected transcription error")
        result = db.fail_transcript(call_id, "An unexpected error occurred during transcription.")

    return result


@router.put(
    "/calls/{call_id}/transcript",
    response_model=TranscriptResponse,
    tags=["Transcript"],
)
def save_edited_transcript(call_id: str, payload: EditTranscriptPayload):
    """Persist the user's edited version of the transcript.

    The original raw_transcript is never overwritten.
    Edits are stored in the separate edited_transcript column.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    result = db.update_edited_transcript(call_id, payload.edited_transcript)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No transcript record found for this call. Upload audio first.",
        )
    return result
