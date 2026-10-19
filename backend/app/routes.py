from fastapi import APIRouter, HTTPException, Query, UploadFile, File, status, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
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
    ProspectCreate,
    ProspectResponse,
    StageSuggestion,
    StageSuggestPayload,
    StageAssistPayload,
    StageAssistRecommendation,
    FollowUpResponse,
    FollowUpUpdate,
)
from backend.app.stages_data import STAGES
from backend.app.db import db
from backend.app.llm import generate_call_summary
from backend.app.transcription import validate_audio, transcribe_audio, run_live_transcription
from backend.app.radar import analyze_transcript_with_radar
from backend.app.historical_radar import find_relevant_historical_matches
from backend.app.gap_detector import analyze_transcript_for_gaps
from backend.app.stage_suggester import suggest_stage_from_transcript
from backend.app.radar import verify_quote_in_transcript
from backend.app.config import settings

import asyncio
import base64
import json
import logging

_logger = logging.getLogger("callflow.routes")

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


@router.delete("/calls/{call_id}", tags=["Calls"])
def delete_call_endpoint(call_id: str):
    """Delete a call record and all associated transcripts, stage results, commitments, and opportunities."""
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )
    db.delete_call(call_id)
    return {"deleted": True, "id": call_id}



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
        status=payload.status,
    )
    return res


@router.post("/calls/{call_id}/stages/{stage_number}/skip", response_model=StageResultResponse, tags=["Stages"])
def skip_stage(call_id: str, stage_number: int, not_applicable: bool = Query(False)):
    """Mark a stage as skipped or not applicable."""
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

    st = "not_applicable" if not_applicable else "skipped"
    res = db.upsert_stage_result(
        call_id=call_id,
        stage_number=stage_number,
        status=st,
    )
    return res


@router.post("/calls/{call_id}/advance", response_model=CallDetailResponse, tags=["Calls"])
def advance_call_stage(call_id: str, stage_number: int = Query(..., ge=1, le=8)):
    """Advance or manually switch the current active stage of the call."""
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )
    updated = db.advance_stage(call_id, stage_number)
    return updated


@router.get("/calls/{call_id}/stage-suggestion", response_model=StageSuggestion, tags=["Stages"])
async def get_stage_suggestion(call_id: str):
    """
    Suggest stage change based on current dialogue with supporting evidence.
    Does NOT change stage automatically; requires user confirmation.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )

    transcript_rec = db.get_transcript(call_id)
    dialogue = ""
    if transcript_rec:
        dialogue = (
            transcript_rec.get("edited_transcript")
            or transcript_rec.get("raw_transcript")
            or ""
        ).strip()

    # Fallback to stage notes if no audio transcript
    if not dialogue:
        notes_lines = []
        for sr in call.get("stage_results", []):
            if sr.get("prospect_exact_words"):
                notes_lines.append(f"PROSPECT: {sr['prospect_exact_words']}")
            if sr.get("notes"):
                notes_lines.append(f"NOTES: {sr['notes']}")
        dialogue = "\n".join(notes_lines)

    suggestion = await suggest_stage_from_transcript(
        transcript=dialogue,
        current_stage=call.get("current_stage", 1),
    )
    return suggestion


@router.post("/calls/{call_id}/stage-suggestion", response_model=StageSuggestion, tags=["Stages"])
async def post_stage_suggestion(call_id: str, payload: Optional[StageSuggestPayload] = None):
    """
    Analyze provided or stored transcript dialogue to suggest a stage change with supporting evidence.
    Does NOT mutate call stage automatically.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found."
        )

    current_st = (
        payload.current_stage
        if (payload and payload.current_stage is not None)
        else call.get("current_stage", 1)
    )

    dialogue = (payload.transcript if payload and payload.transcript else "").strip()
    if not dialogue:
        transcript_rec = db.get_transcript(call_id)
        if transcript_rec:
            dialogue = (
                transcript_rec.get("edited_transcript")
                or transcript_rec.get("raw_transcript")
                or ""
            ).strip()

    if not dialogue:
        notes_lines = []
        for sr in call.get("stage_results", []):
            if sr.get("prospect_exact_words"):
                notes_lines.append(f"PROSPECT: {sr['prospect_exact_words']}")
            if sr.get("notes"):
                notes_lines.append(f"NOTES: {sr['notes']}")
        dialogue = "\n".join(notes_lines)

    suggestion = await suggest_stage_from_transcript(
        transcript=dialogue,
        current_stage=current_st,
    )
    return suggestion


@router.post(
    "/calls/{call_id}/stage-assist",
    response_model=StageAssistRecommendation,
    tags=["Stages"],
)
async def get_stage_assist_recommendation(call_id: str, payload: StageAssistPayload):
    """Return advisory, quote-grounded help for the currently viewed stage.

    This endpoint never writes a stage result. The caller must explicitly copy
    an excerpt or confirm an outcome in the UI.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Call with ID '{call_id}' not found.")

    transcript = payload.transcript.strip()
    stage = next((item for item in STAGES if item["stage_number"] == payload.stage_number), None)
    empty = {
        "stage_number": payload.stage_number,
        "suggested_excerpt": None,
        "excerpt_speaker": "unknown",
        "excerpt_uncertain": False,
        "suggested_outcome": None,
        "outcome_reason": None,
        "evidence_quote": None,
        "confidence": 0.0,
    }
    if not transcript or not stage or not settings.gemini_configured:
        return empty

    from google.genai import types as genai_types
    from backend.app.gemini_pool import text_model_pool

    prompt = f'''You are assisting a cold-call representative. Review the FINALIZED transcript for this one workflow stage.
Stage {stage["stage_number"]}: {stage["name"]}
Purpose: {stage["purpose"]}
Allowed outcomes: {json.dumps(stage["outcome_options"])}

Return strict JSON with this schema:
{{
  "suggested_excerpt": "an exact verbatim prospect quote relevant to this stage, or null",
  "excerpt_speaker": "prospect" | "caller" | "unknown",
  "excerpt_uncertain": true | false,
  "suggested_outcome": "one allowed outcome or null",
  "outcome_reason": "brief evidence-based reason or null",
  "evidence_quote": "exact verbatim quote supporting the outcome or null",
  "confidence": 0.0
}}

Rules: Do not paraphrase or invent. Prefer prospect speech. If speaker identity is unclear, set excerpt_uncertain=true. Return null outcome when evidence is insufficient or conflicting. A transition between stages is never proof of an outcome.

Transcript:
{transcript}'''
    try:
        def _call(client, model_name: str):
            return client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=genai_types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"),
            )
        response = text_model_pool.execute_with_fallback(_call)
        data = json.loads((getattr(response, "text", "") or "{}").strip())
    except Exception as exc:
        _logger.warning("Stage assist recommendation failed for %s: %s", call_id, exc)
        return empty

    excerpt = (data.get("suggested_excerpt") or "").strip()
    evidence = (data.get("evidence_quote") or "").strip()
    if not excerpt or not verify_quote_in_transcript(excerpt, transcript):
        excerpt = None
    if not evidence or not verify_quote_in_transcript(evidence, transcript):
        evidence = None
    has_speaker_labels = any(line.lstrip().upper().startswith(("PROSPECT:", "CALLER:", "REPRESENTATIVE:", "CUSTOMER:", "AGENT:")) for line in transcript.splitlines())
    outcome = data.get("suggested_outcome")
    if outcome not in stage["outcome_options"] or not evidence:
        outcome = None

    return {
        "stage_number": payload.stage_number,
        "suggested_excerpt": excerpt,
        "excerpt_speaker": data.get("excerpt_speaker") if data.get("excerpt_speaker") in {"prospect", "caller", "unknown"} else "unknown",
        "excerpt_uncertain": bool(data.get("excerpt_uncertain", False)) or not has_speaker_labels,
        "suggested_outcome": outcome,
        "outcome_reason": (data.get("outcome_reason") or "").strip() or None,
        "evidence_quote": evidence,
        "confidence": max(0.0, min(1.0, float(data.get("confidence", 0.0) or 0.0))),
    }


@router.post("/calls/{call_id}/close", response_model=CallDetailResponse, tags=["Calls"])
async def close_call(call_id: str, payload: CallClose):
    """Close a call and record final outcome, next action, follow-up, referrals, objections, and verbatim statements."""
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
        referral_name=payload.referral_name,
        referral_contact=payload.referral_contact,
        objection=payload.objection,
        prospect_statement=payload.prospect_statement,
    )

    # Trigger initial conversation gaps analysis if complete transcript is available.
    # This is optional post-processing — errors here must never block the close response.
    try:
        transcript_rec = db.get_transcript(call_id)
        if transcript_rec and (transcript_rec.get("edited_transcript") or transcript_rec.get("raw_transcript")):
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

    # Summary generation is idempotent by default. This also protects against
    # duplicate UI submissions and retry races after a successful generation.
    if call.get("ai_summary"):
        return {
            "call_id": call_id,
            "available": True,
            "error": None,
            "summary": call["ai_summary"],
        }

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
    Analysis is explicit through the POST endpoint so a valid empty result does
    not trigger a paid LLM request every time the review panel is opened.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    gaps = db.list_conversation_gaps(call_id)

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


# ──────────────────────────────────────────────────────────────────────────
# Prospects Endpoints
# ──────────────────────────────────────────────────────────────────────────

@router.get("/prospects", response_model=List[ProspectResponse], tags=["Prospects"])
def list_prospects_endpoint(
    search: Optional[str] = Query(None, description="Search prospects by company, contact, or context")
):
    """Retrieve list of all available prospects populated from transcripts and added prospects."""
    return db.list_prospects(search=search)


@router.post("/prospects", response_model=ProspectResponse, status_code=status.HTTP_201_CREATED, tags=["Prospects"])
def create_prospect_endpoint(payload: ProspectCreate):
    """Create a new prospect and save to database. Rejects duplicate company names."""
    company_name = payload.company_name.strip()
    if not company_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Company name is required."
        )

    # Check for existing duplicate
    existing = db.get_prospect_by_company(company_name)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Prospect with company name '{company_name}' already exists."
        )

    try:
        created = db.create_prospect(
            company_name=company_name,
            contact_name=payload.contact_name,
            phone_number=payload.phone_number,
            context=payload.context,
            is_custom=True,
        )
        return created
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )


@router.get("/prospects/{prospect_id}", response_model=ProspectResponse, tags=["Prospects"])
def get_prospect_endpoint(prospect_id: str):
    """Retrieve details for a single prospect."""
    p = db.get_prospect(prospect_id)
    if not p:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prospect with ID '{prospect_id}' not found."
        )
    return p


@router.get("/prospects/{prospect_id}/calls", response_model=List[CallResponse], tags=["Prospects"])
def get_prospect_calls_endpoint(prospect_id: str):
    """Retrieve all historical calls associated with a given prospect."""
    p = db.get_prospect(prospect_id)
    if not p:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prospect with ID '{prospect_id}' not found."
        )
    comp_clean = p["company_name"].strip().lower()
    calls = db.list_calls()
    matched = [
        c for c in calls
        if (c.get("company_name") or "").strip().lower() == comp_clean
    ]
    return matched


@router.delete("/prospects/{prospect_id}", tags=["Prospects"])
def delete_prospect_endpoint(prospect_id: str):
    """Delete a prospect from the directory."""
    p = db.get_prospect(prospect_id)
    if not p:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prospect with ID '{prospect_id}' not found."
        )
    db.delete_prospect(prospect_id)
    return {"deleted": True, "id": prospect_id}



# ──────────────────────────────────────────────────────────────────────────
# Follow-up Management Endpoints
# ──────────────────────────────────────────────────────────────────────────

@router.get("/followups", response_model=List[FollowUpResponse], tags=["Followups"])
def list_followups_endpoint():
    """List all follow-up actions and commitments across all calls with prospect information."""
    calls_list = db.list_calls()
    calls_by_id = {c["id"]: c for c in calls_list}

    all_commitments = db.list_all_commitments()
    followups: List[Dict[str, Any]] = []
    seen_call_actions = set()

    # 1. From explicit commitments
    for comm in all_commitments:
        call = calls_by_id.get(comm.get("call_id"))
        comp_name = call.get("company_name") if call else "Unknown Company"
        contact_name = call.get("contact_name") if call else None
        phone_number = call.get("phone_number") if call else None
        action = comm.get("action", "")

        followups.append({
            "id": comm["id"],
            "call_id": comm["call_id"],
            "company_name": comp_name,
            "contact_name": contact_name,
            "phone_number": phone_number,
            "action": action,
            "due_at": comm.get("due_at"),
            "relative_due": comm.get("relative_due"),
            "channel": comm.get("channel"),
            "evidence_quote": comm.get("evidence_quote"),
            "confidence": comm.get("confidence", 1.0),
            "status": comm.get("status", "pending"),
            "created_at": comm.get("created_at"),
            "updated_at": comm.get("updated_at"),
            "source": "commitment",
        })
        if comm.get("call_id"):
            seen_call_actions.add((comm["call_id"], action.strip().lower()))

    # 2. From call close next_actions that aren't duplicate commitments
    for call in calls_list:
        next_act = (call.get("next_action") or "").strip()
        fup_time = (call.get("follow_up_time") or "").strip()
        if next_act or fup_time:
            # Check if this exact action was already extracted as a commitment
            if (call["id"], next_act.lower()) in seen_call_actions:
                continue
            followups.append({
                "id": f"call_{call['id']}",
                "call_id": call["id"],
                "company_name": call.get("company_name"),
                "contact_name": call.get("contact_name"),
                "phone_number": call.get("phone_number"),
                "action": next_act or "Scheduled follow-up",
                "due_at": None,
                "relative_due": fup_time or None,
                "channel": call.get("follow_up_channel"),
                "evidence_quote": call.get("prospect_statement") or None,
                "confidence": 1.0,
                "status": "pending",
                "created_at": call.get("created_at") or call.get("started_at"),
                "updated_at": call.get("updated_at"),
                "source": "call_next_action",
            })

    return followups


@router.patch("/followups/{followup_id}", response_model=FollowUpResponse, tags=["Followups"])
def update_followup_endpoint(followup_id: str, payload: FollowUpUpdate):
    """Update follow-up status (e.g. mark completed, reschedule). Persists directly to database."""
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}

    if followup_id.startswith("call_"):
        call_id = followup_id.replace("call_", "", 1)
        call = db.get_call(call_id)
        if not call:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Originating call not found.")

        new_status = updates.get("status", "completed")
        due_at = updates.get("due_at")
        relative_due = updates.get("relative_due", call.get("follow_up_time"))
        action = updates.get("action", call.get("next_action") or "Scheduled follow-up")
        channel = updates.get("channel", call.get("follow_up_channel") or "unknown")

        created_comm = db.create_commitment(
            call_id=call_id,
            action=action,
            responsible_party="caller",
            commitment_status="promised",
            due_at=due_at,
            relative_due=relative_due,
            channel=channel,
            evidence_quote=call.get("prospect_statement") or "Recorded in call close next action",
            confidence=1.0,
            needs_confirmation=False,
            status=new_status,
        )
        return {
            "id": created_comm["id"],
            "call_id": call_id,
            "company_name": call.get("company_name"),
            "contact_name": call.get("contact_name"),
            "phone_number": call.get("phone_number"),
            "action": created_comm["action"],
            "due_at": created_comm.get("due_at"),
            "relative_due": created_comm.get("relative_due"),
            "channel": created_comm.get("channel"),
            "evidence_quote": created_comm.get("evidence_quote"),
            "confidence": created_comm.get("confidence", 1.0),
            "status": created_comm.get("status", new_status),
            "created_at": created_comm.get("created_at"),
            "updated_at": created_comm.get("updated_at"),
            "source": "commitment",
        }

    comm = db.get_commitment(followup_id)
    if not comm:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Follow-up with ID '{followup_id}' not found."
        )

    updated = db.update_commitment(followup_id, updates)
    call = db.get_call(updated.get("call_id", ""))
    return {
        "id": updated["id"],
        "call_id": updated["call_id"],
        "company_name": call.get("company_name") if call else "Unknown Company",
        "contact_name": call.get("contact_name") if call else None,
        "phone_number": call.get("phone_number") if call else None,
        "action": updated["action"],
        "due_at": updated.get("due_at"),
        "relative_due": updated.get("relative_due"),
        "channel": updated.get("channel"),
        "evidence_quote": updated.get("evidence_quote"),
        "confidence": updated.get("confidence", 1.0),
        "status": updated.get("status", "pending"),
        "created_at": updated.get("created_at"),
        "updated_at": updated.get("updated_at"),
        "source": "commitment",
    }


@router.delete("/followups/{followup_id}", tags=["Followups"])
def delete_followup_endpoint(followup_id: str):
    """Delete a follow-up item. If synthesized from a call, clears call followup; if a commitment, removes it."""
    if followup_id.startswith("call_"):
        call_id = followup_id.replace("call_", "", 1)
        call = db.get_call(call_id)
        if not call:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Originating call for follow-up '{followup_id}' not found."
            )
        db.clear_call_followup(call_id)
        return {"deleted": True, "id": followup_id}

    comm = db.get_commitment(followup_id)
    if not comm:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Follow-up with ID '{followup_id}' not found."
        )
    db.delete_commitment(followup_id)
    return {"deleted": True, "id": followup_id}



# ──────────────────────────────────────────────────────────────────────────────
# Live Transcription WebSocket
# ──────────────────────────────────────────────────────────────────────────────


@router.websocket("/calls/{call_id}/transcribe-live")
async def transcribe_live(websocket: WebSocket, call_id: str):
    """
    WebSocket endpoint for real-time audio transcription via Gemini Live API.

    Protocol (browser → server):
      Each message is a JSON object:
        {"audio": "<base64-encoded signed 16-bit PCM @ 16 kHz mono>"}
      Or a control message:
        {"control": "stop"}

    Protocol (server → browser):
      Each response is a JSON object with one of these types:
        {"type": "connected", "call_id": "..."}
        {"type": "interim", "text": "..."}
        {"type": "final", "text": "..."}
        {"type": "error", "message": "..."}
        {"type": "done"}

    The endpoint persists the accumulated finalized transcript to the database
    when the session ends (either via control:stop or WebSocket disconnect).
    """
    await websocket.accept()

    # Validate call exists
    call = db.get_call(call_id)
    if not call:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": f"Call '{call_id}' not found.",
        }))
        await websocket.close(code=1008)
        return

    # Queue to feed audio chunks from the WebSocket into the transcription generator
    audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
    stop_event = asyncio.Event()

    accumulated_transcript: list[str] = []

    async def _audio_generator():
        """Yield raw PCM bytes from the WebSocket messages."""
        while not stop_event.is_set():
            try:
                chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.5)
                if chunk is None:
                    break  # sentinel
                yield chunk
            except asyncio.TimeoutError:
                continue
            except Exception:
                break

    async def _receive_from_browser():
        """Receive messages from the browser and push audio into the queue."""
        try:
            while not stop_event.is_set():
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                if msg.get("control") == "stop":
                    stop_event.set()
                    await audio_queue.put(None)  # sentinel
                    break

                audio_b64 = msg.get("audio")
                if audio_b64:
                    try:
                        pcm_bytes = base64.b64decode(audio_b64)
                        await audio_queue.put(pcm_bytes)
                    except Exception as exc:
                        _logger.warning("Failed to decode audio chunk: %s", exc)

        except WebSocketDisconnect:
            stop_event.set()
            await audio_queue.put(None)
        except Exception as exc:
            _logger.warning("WebSocket receive error: %s", exc)
            stop_event.set()
            await audio_queue.put(None)

    # Send "connected" acknowledgement
    await websocket.send_text(json.dumps({
        "type": "connected",
        "call_id": call_id,
    }))

    # Run receiver and transcription pipeline concurrently
    receiver_task = asyncio.create_task(_receive_from_browser())

    try:
        async for event in run_live_transcription(_audio_generator()):
            event_type = event.get("type")

            # Accumulate finalized text
            if event_type == "final" and event.get("text"):
                accumulated_transcript.append(event["text"])

            try:
                await websocket.send_text(json.dumps(event))
            except Exception:
                break  # WebSocket closed

            if event_type in ("done", "error"):
                break

    except Exception as exc:
        _logger.error("Live transcription pipeline error for call %s: %s", call_id, exc)
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": str(exc),
            }))
        except Exception:
            pass

    finally:
        stop_event.set()
        receiver_task.cancel()
        try:
            await receiver_task
        except (asyncio.CancelledError, Exception):
            pass

        # Persist accumulated transcript to the database
        if accumulated_transcript:
            full_text = "\n".join(accumulated_transcript)
            try:
                existing = db.get_transcript(call_id)
                if existing:
                    # Append to existing raw transcript
                    prev = existing.get("raw_transcript") or ""
                    merged = (prev + "\n" + full_text).strip() if prev else full_text
                    db.complete_transcript(
                        call_id,
                        raw_transcript=merged,
                        transcript_metadata={"source": "live_websocket"},
                    )
                else:
                    db.upsert_transcript_pending(call_id)
                    db.complete_transcript(
                        call_id,
                        raw_transcript=full_text,
                        transcript_metadata={"source": "live_websocket"},
                    )
            except Exception as exc:
                _logger.error("Failed to persist live transcript for call %s: %s", call_id, exc)

        try:
            await websocket.close()
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────────────
# Stage Notes Analysis Endpoint
# ──────────────────────────────────────────────────────────────────────────────


class StageNotesAnalysisPayload(BaseModel):
    transcript_segment: str = Field(..., description="Transcript text to classify into stages")
    segment_id: str = Field(..., description="Unique identifier to prevent duplicate analysis")


class StageNoteItem(BaseModel):
    stage_number: int
    stage_name: str
    note: str
    evidence_quote: str
    confidence: float
    needs_review: bool


class StageNotesAnalysisResponse(BaseModel):
    call_id: str
    segment_id: str
    stage_notes: list[StageNoteItem]
    unclassified_segments: list[str]


@router.post(
    "/calls/{call_id}/analyze-stage-notes",
    response_model=StageNotesAnalysisResponse,
    tags=["Stage Notes"],
)
async def analyze_stage_notes(call_id: str, payload: StageNotesAnalysisPayload):
    """
    Classify transcript segments into the 8 cold-call stages and generate
    concise, evidence-backed notes for each stage.

    Rules:
    - Never invent statements, needs, objections, dates, or commitments.
    - Distinguish explicit agreements from vague expressions of interest.
    - Preserve exact prospect wording in evidence_quote.
    - If a segment cannot be classified confidently, leave it unclassified.
    - Does not silently overwrite manually-edited stage notes.
    """
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call with ID '{call_id}' not found.",
        )

    transcript_segment = (payload.transcript_segment or "").strip()
    if not transcript_segment:
        return {
            "call_id": call_id,
            "segment_id": payload.segment_id,
            "stage_notes": [],
            "unclassified_segments": [],
        }

    from backend.app.gemini_pool import text_model_pool, make_gemini_client
    from google.genai import types as genai_types

    prompt = f"""You are a cold-call analysis assistant. Analyze the following transcript segment and classify useful information into the appropriate cold-call stages.

STAGES:
1. Opening: Who answered, role confirmation, introduction, whether intended person was reached.
2. Purpose: Why the caller is contacting the prospect, how the purpose is explained.
3. Permission: Whether the prospect is available or willing to continue the conversation.
4. Their Business: Company context, responsibilities, current processes, business priorities.
5. Their Need (in their words): Prospect's expressed needs, problems, and priorities. Preserve exact wording.
6. Objection: Concerns, refusals, hesitations, existing alternatives, prospect's reasons.
7. Next Step: Callbacks, requested info, referrals, agreed meetings, responsible parties, timing.
8. Close: Final outcome, closing statements, agreed disposition of the call.

RULES:
- Classify by conversational context, not isolated keywords.
- A sentence may concern an earlier stage even if the caller has moved on.
- Distinguish caller's words from prospect's words when identifiable.
- NEVER invent prospect statements, needs, objections, dates, or commitments.
- Distinguish explicit agreements from suggestions and vague interest.
- If a segment cannot be confidently classified, mark it as unclassified.
- Preserve exact prospect wording in evidence_quote.
- Set needs_review=true if you are uncertain or the note needs caller verification.
- Only include stages where you found genuinely classifiable content.

TRANSCRIPT SEGMENT:
{transcript_segment}

Respond with a JSON object in this exact format:
{{
  "stage_notes": [
    {{
      "stage_number": <1-8>,
      "stage_name": "<name>",
      "note": "<concise note about what happened at this stage>",
      "evidence_quote": "<exact words from transcript supporting this note>",
      "confidence": <0.0-1.0>,
      "needs_review": <true|false>
    }}
  ],
  "unclassified_segments": ["<sentence that couldn't be classified>"]
}}

Only include stages where meaningful content was found. Keep notes concise and factual."""

    try:
        def _call_analyze(client, model_name: str):
            return client.models.generate_content(
                model=model_name,
                contents=[prompt],
                config=genai_types.GenerateContentConfig(
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            )

        response = text_model_pool.execute_with_fallback(_call_analyze)
        raw_text = getattr(response, "text", "") or ""

        # Parse the JSON response
        try:
            # Strip markdown code blocks if present
            clean = raw_text.strip()
            if clean.startswith("```"):
                lines = clean.split("\n")
                clean = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
            analysis = json.loads(clean)
        except json.JSONDecodeError:
            analysis = {"stage_notes": [], "unclassified_segments": []}

        # Reject unsupported evidence before it reaches the client. The UI can
        # only offer notes that are traceable to the finalized segment sent here.
        verified_stage_notes = []
        for item in analysis.get("stage_notes", []):
            try:
                stage_number = int(item.get("stage_number"))
            except (TypeError, ValueError):
                continue
            quote = str(item.get("evidence_quote") or "").strip()
            if stage_number < 1 or stage_number > 8 or not quote or not verify_quote_in_transcript(quote, transcript_segment):
                continue
            item["stage_number"] = stage_number
            item["evidence_quote"] = quote
            verified_stage_notes.append(item)

        return {
            "call_id": call_id,
            "segment_id": payload.segment_id,
            "stage_notes": verified_stage_notes,
            "unclassified_segments": analysis.get("unclassified_segments", []),
        }

    except Exception as exc:
        _logger.error("Stage notes analysis failed for call %s: %s", call_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Stage notes analysis failed: {exc}",
        )

