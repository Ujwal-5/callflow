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
    CommitmentCreate,
    CommitmentUpdate,
    CommitmentResponse,
    MissedOpportunityCreate,
    MissedOpportunityUpdate,
    MissedOpportunityResponse,
    RadarAnalysisResponse,
    RadarAnalyzePayload,
    HistoricalMatch,
    ConversationGapCreate,
    ConversationGapUpdate,
    ConversationGapResponse,
    GapAnalyzePayload,
    ConversationGapsAnalysisResponse,
)
from backend.app.stages_data import STAGES
from backend.app.db import db
from backend.app.llm import generate_call_summary
from backend.app.transcription import validate_audio, transcribe_audio
from backend.app.radar import analyze_transcript_with_radar
from backend.app.historical_radar import find_relevant_historical_matches
from backend.app.gap_detector import analyze_transcript_for_gaps


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
async def close_call(call_id: str, payload: CallClose):
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

    # Trigger initial conversation gaps analysis if complete transcript is available
    transcript_rec = db.get_transcript(call_id)
    if transcript_rec and (transcript_rec.get("edited_transcript") or transcript_rec.get("raw_transcript")):
        try:
            await analyze_conversation_gaps_endpoint(call_id)
            closed = db.get_call(call_id)
        except Exception:
            pass

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


# ──────────────────────────────────────────────────────────────────────────────
# Commitment Radar endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post(
    "/calls/{call_id}/radar/analyze",
    response_model=RadarAnalysisResponse,
    tags=["Commitment Radar"],
)
async def analyze_call_radar(
    call_id: str,
    payload: Optional[RadarAnalyzePayload] = None,
):
    """
    Analyze conversation dialogue to extract candidate commitments,
    detect potential missed opportunities, and find historical comparisons.
    - Uses the latest available transcript (user-edited transcript prioritized).
    - Can also accept dialogue text directly in request body.
    - Idempotent: repeated analysis updates details without duplicating records
      or overwriting manual user confirmations/completions/dismissals.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    # 1. Retrieve dialogue text
    dialogue_text = ""
    if payload and payload.transcript and payload.transcript.strip():
        dialogue_text = payload.transcript.strip()
    else:
        transcript_rec = db.get_transcript(call_id)
        if transcript_rec:
            dialogue_text = (
                transcript_rec.get("edited_transcript")
                or transcript_rec.get("raw_transcript")
                or ""
            ).strip()


    # Fallback to manual stage notes if audio transcript was not recorded
    if not dialogue_text:
        stage_notes = []
        for sr in call.get("stage_results", []):
            words = sr.get("prospect_exact_words")
            notes = sr.get("notes")
            if words:
                stage_notes.append(f"PROSPECT: {words}")
            if notes:
                stage_notes.append(f"NOTES: {notes}")
        dialogue_text = "\n".join(stage_notes)

    # 2. Run analysis engine
    radar_data = await analyze_transcript_with_radar(
        transcript=dialogue_text,
        call_id=call_id,
        call_started_at=call.get("started_at"),
        company_name=call.get("company_name"),
        contact_name=call.get("contact_name"),
    )

    # 3. Idempotently persist extracted commitments and missed opportunities
    saved_commitments = db.upsert_commitments_batch(
        call_id=call_id, candidate_commitments=radar_data["commitments"]
    )
    saved_opps = db.upsert_missed_opportunities_batch(
        call_id=call_id, candidate_opportunities=radar_data["missed_opportunities"]
    )

    return {
        "call_id": call_id,
        "commitments": saved_commitments,
        "missed_opportunities": saved_opps,
        "historical_matches": radar_data.get("historical_matches", []),
        "analysis_summary": radar_data.get("analysis_summary", ""),
    }


@router.get(
    "/calls/{call_id}/radar",
    response_model=RadarAnalysisResponse,
    tags=["Commitment Radar"],
)
def get_call_radar(call_id: str):
    """
    Retrieve current extracted commitments and potential missed opportunities for a call.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    commitments = db.list_commitments(call_id)
    missed_opps = db.list_missed_opportunities(call_id)

    transcript_rec = db.get_transcript(call_id)
    text = ""
    if transcript_rec:
        text = transcript_rec.get("edited_transcript") or transcript_rec.get("raw_transcript") or ""

    historical_matches = find_relevant_historical_matches(
        transcript_text=text,
        commitments=commitments,
        missed_opportunities=missed_opps,
        limit=2,
    )

    summary = f"Tracking {len(commitments)} commitment(s) and {len(missed_opps)} potential opportunity."

    return {
        "call_id": call_id,
        "commitments": commitments,
        "missed_opportunities": missed_opps,
        "historical_matches": historical_matches,
        "analysis_summary": summary,
    }


@router.post(
    "/calls/{call_id}/commitments",
    response_model=CommitmentResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Commitment Radar"],
)
def create_manual_commitment(call_id: str, payload: CommitmentCreate):
    """Manually add a confirmed or tracked commitment to a call."""
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    res = db.create_commitment(
        call_id=call_id,
        action=payload.action,
        responsible_party=payload.responsible_party,
        commitment_status=payload.commitment_status,
        due_at=payload.due_at,
        relative_due=payload.relative_due,
        channel=payload.channel,
        evidence_quote=payload.evidence_quote,
        confidence=payload.confidence,
        needs_confirmation=payload.needs_confirmation,
        status=payload.status,
    )
    return res


@router.patch(
    "/calls/{call_id}/commitments/{commitment_id}",
    response_model=CommitmentResponse,
    tags=["Commitment Radar"],
)
def update_commitment_status(
    call_id: str, commitment_id: str, payload: CommitmentUpdate
):
    """Update a commitment status (confirm, edit, complete, dismiss)."""
    comm = db.get_commitment(commitment_id)
    if not comm or comm.get("call_id") != call_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Commitment '{commitment_id}' not found for call '{call_id}'.",
        )

    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    res = db.update_commitment(commitment_id, updates)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Commitment '{commitment_id}' could not be updated.",
        )
    return res


@router.delete(
    "/calls/{call_id}/commitments/{commitment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Commitment Radar"],
)
def delete_commitment(call_id: str, commitment_id: str):
    """Delete a commitment record."""
    comm = db.get_commitment(commitment_id)
    if not comm or comm.get("call_id") != call_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Commitment '{commitment_id}' not found for call '{call_id}'.",
        )
    db.delete_commitment(commitment_id)
    return None


@router.patch(
    "/calls/{call_id}/missed-opportunities/{opportunity_id}",
    response_model=MissedOpportunityResponse,
    tags=["Commitment Radar"],
)
def update_missed_opportunity(
    call_id: str, opportunity_id: str, payload: MissedOpportunityUpdate
):
    """Update a potential missed opportunity (confirm, edit, dismiss)."""
    opp = db.get_missed_opportunity(opportunity_id)
    if not opp or opp.get("call_id") != call_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Missed opportunity '{opportunity_id}' not found for call '{call_id}'.",
        )

    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    res = db.update_missed_opportunity(opportunity_id, updates)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Missed opportunity '{opportunity_id}' could not be updated.",
        )
    return res


@router.delete(
    "/calls/{call_id}/missed-opportunities/{opportunity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Commitment Radar"],
)
def delete_missed_opportunity(call_id: str, opportunity_id: str):
    """Delete a missed opportunity record."""
    opp = db.get_missed_opportunity(opportunity_id)
    if not opp or opp.get("call_id") != call_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Missed opportunity '{opportunity_id}' not found for call '{call_id}'.",
        )
    db.delete_missed_opportunity(opportunity_id)
    return None


@router.get(
    "/radar/historical-matches",
    response_model=List[HistoricalMatch],
    tags=["Commitment Radar"],
)
def get_historical_matches(query: Optional[str] = Query(None, description="Search query or transcript excerpt")):
    """Retrieve up to 2 relevant historical cold-call examples from the 100 historical calls."""
    if not query:
        return []
    return find_relevant_historical_matches(transcript_text=query, limit=2)


# ──────────────────────────────────────────────────────────────────────────────
# Conversation Gap Detector endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post(
    "/calls/{call_id}/gaps/analyze",
    response_model=ConversationGapsAnalysisResponse,
    tags=["Conversation Gap Detector"],
)
async def analyze_conversation_gaps_endpoint(
    call_id: str,
    payload: Optional[GapAnalyzePayload] = None,
):
    """
    Analyze call dialogue to detect potential missed discovery opportunities,
    unresolved questions, unconfirmed agreements, unaddressed objections,
    and unexplored referrals.
    - Idempotent: repeated analysis updates details without duplicating records
      or overriding manual salesperson resolutions/dismissals.
    - Validates quotes against the source transcript.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    # 1. Retrieve dialogue text
    dialogue_text = ""
    if payload and payload.transcript and payload.transcript.strip():
        dialogue_text = payload.transcript.strip()
    else:
        transcript_rec = db.get_transcript(call_id)
        if transcript_rec:
            dialogue_text = (
                transcript_rec.get("edited_transcript")
                or transcript_rec.get("raw_transcript")
                or ""
            ).strip()

    # Fallback to manual stage notes if audio transcript was not recorded
    if not dialogue_text:
        stage_notes = []
        for sr in call.get("stage_results", []):
            words = sr.get("prospect_exact_words")
            notes = sr.get("notes")
            if words:
                stage_notes.append(f"PROSPECT: {words}")
            if notes:
                stage_notes.append(f"NOTES: {notes}")
        dialogue_text = "\n".join(stage_notes)

    # Enforce safe length boundary
    if len(dialogue_text) > 200_000:
        dialogue_text = dialogue_text[:200_000]

    existing_commitments = db.list_commitments(call_id)

    # 2. Run Gap Detector engine
    gaps_data = await analyze_transcript_for_gaps(
        transcript=dialogue_text,
        call_id=call_id,
        existing_commitments=existing_commitments,
        company_name=call.get("company_name"),
        contact_name=call.get("contact_name"),
    )

    # 3. Idempotently persist extracted findings
    saved_gaps = db.upsert_conversation_gaps_batch(
        call_id=call_id, candidate_gaps=gaps_data["findings"]
    )

    return {
        "call_id": call_id,
        "findings": saved_gaps,
        "total_gaps": len(saved_gaps),
        "summary": gaps_data.get("summary", "No significant conversation gaps detected."),
    }


@router.get(
    "/calls/{call_id}/gaps",
    response_model=ConversationGapsAnalysisResponse,
    tags=["Conversation Gap Detector"],
)
async def get_conversation_gaps_endpoint(call_id: str):
    """
    Retrieve existing conversation gap findings for a call.
    If no findings exist yet and a transcript is available, runs initial analysis.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    gaps = db.list_conversation_gaps(call_id)

    # If no findings yet, run initial analysis if transcript exists
    if not gaps:
        transcript_rec = db.get_transcript(call_id)
        has_dialogue = bool(
            transcript_rec and (transcript_rec.get("edited_transcript") or transcript_rec.get("raw_transcript"))
        ) or any(sr.get("prospect_exact_words") for sr in call.get("stage_results", []))

        if has_dialogue:
            res = await analyze_conversation_gaps_endpoint(call_id)
            return res

    summary = (
        f"Tracking {len(gaps)} conversation gap finding(s)."
        if gaps
        else "No significant conversation gaps detected."
    )

    return {
        "call_id": call_id,
        "findings": gaps,
        "total_gaps": len(gaps),
        "summary": summary,
    }


@router.patch(
    "/calls/{call_id}/gaps/{gap_id}",
    response_model=ConversationGapResponse,
    tags=["Conversation Gap Detector"],
)
def update_conversation_gap_endpoint(
    call_id: str, gap_id: str, payload: ConversationGapUpdate
):
    """Update finding status (open, resolved, dismissed) or details."""
    gap = db.get_conversation_gap(gap_id)
    if not gap or gap.get("call_id") != call_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation gap '{gap_id}' not found for call '{call_id}'.",
        )

    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    res = db.update_conversation_gap(gap_id, updates)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation gap '{gap_id}' could not be updated.",
        )
    return res


@router.post(
    "/calls/{call_id}/gaps/{gap_id}/create-followup",
    response_model=ConversationGapResponse,
    tags=["Conversation Gap Detector"],
)
def create_gap_followup_endpoint(call_id: str, gap_id: str):
    """
    Create a concrete follow-up commitment from a conversation gap finding,
    linking the commitment to the finding and marking the gap as resolved.
    Does not duplicate commitments if clicked repeatedly.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )
    gap = db.get_conversation_gap(gap_id)
    if not gap or gap.get("call_id") != call_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation gap '{gap_id}' not found for call '{call_id}'.",
        )

    commitment_id = gap.get("commitment_id")
    if not commitment_id:
        existing_commitments = db.list_commitments(call_id)
        matched_comm = None
        for comm in existing_commitments:
            if (
                comm.get("action", "").strip().lower() == gap["suggested_action"].strip().lower()
                or comm.get("evidence_quote", "").strip().lower() == gap["evidence_quote"].strip().lower()
            ):
                matched_comm = comm
                break

        if matched_comm:
            commitment_id = matched_comm["id"]
        else:
            new_comm = db.create_commitment(
                call_id=call_id,
                action=gap["suggested_action"],
                responsible_party="caller",
                commitment_status="promised",
                channel="phone",
                evidence_quote=gap["evidence_quote"],
                confidence=gap.get("confidence", 0.9),
                needs_confirmation=False,
                status="pending",
            )
            commitment_id = new_comm["id"]

    updated_gap = db.update_conversation_gap(
        gap_id,
        {
            "status": "resolved",
            "commitment_id": commitment_id,
        },
    )
    return updated_gap


@router.delete(
    "/calls/{call_id}/gaps/{gap_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Conversation Gap Detector"],
)
def delete_conversation_gap_endpoint(call_id: str, gap_id: str):
    """Delete a conversation gap finding."""
    gap = db.get_conversation_gap(gap_id)
    if not gap or gap.get("call_id") != call_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation gap '{gap_id}' not found for call '{call_id}'.",
        )
    db.delete_conversation_gap(gap_id)
    return None

