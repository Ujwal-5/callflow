import re
import json
import logging
import asyncio
from typing import Dict, Any, Optional, List
from backend.app.config import settings
from backend.app.radar import verify_quote_in_transcript
from backend.app.gemini_pool import (
    MINIMAL_THINKING_INSTRUCTION,
    text_model_pool,
)
from backend.app.stages_data import STAGES

logger = logging.getLogger("callflow.stage_suggester")

STAGE_NAMES = {s["stage_number"]: s["name"] for s in STAGES}

# Rule-based stage detection patterns and indicators
STAGE_PATTERNS = [
    {
        "stage_number": 8,
        "name": "Close",
        "patterns": [
            r"(thank you.*?time|talk to you then|confirmed for|have a good day|looking forward to (our|the) call|goodbye|bye bye)",
        ],
        "reason": "Conversation is wrapping up with final confirmations and farewell.",
    },
    {
        "stage_number": 7,
        "name": "Next step",
        "patterns": [
            r"(google meet|calendar invite|next tuesday|next week.*?at|send (the|a) (report|deck|profile|document) on whatsapp|let's connect (on|at)|set up a (call|meeting)|schedule a (call|meeting)|send (an|the) invite)",
        ],
        "reason": "Specific next action, calendar meeting, or document sharing is being agreed.",
    },
    {
        "stage_number": 6,
        "name": "Objection",
        "patterns": [
            r"(already (have|work with|using) (an|our|a) (agency|consultant|team|vendor|provider)|not interested|no requirement right now|send (it|information|details) (in writing|via email|to my email)|speak (with|to) (mr\.|ms\.|another)|different (person|department) handles)",
        ],
        "reason": "Prospect raised an objection, cited an existing vendor, or referred to another stakeholder.",
    },
    {
        "stage_number": 5,
        "name": "Their need, in their words",
        "patterns": [
            r"(hardly any margin|huge delays|biggest (issue|problem|challenge|bottleneck)|struggling (with|to)|trying to (improve|reduce|push)|cost of|clearer idea of our products|no current need|what (can you|do you) offer)",
        ],
        "reason": "Prospect is describing their operational pain points, margins, needs, or objectives.",
    },
    {
        "stage_number": 4,
        "name": "Their business",
        "patterns": [
            r"(we (manufacture|produce|make|do job work|operate|build)|our (company|plant|factory|firm|unit) (is|has|works)|we are a (contract|tier|supplier)|we work on.*?basis)",
        ],
        "reason": "Prospect is explaining their company's core operations, business model, or manufacturing setup.",
    },
    {
        "stage_number": 3,
        "name": "Permission",
        "patterns": [
            r"(call (me|back) (in|after)|driving|in a meeting|busy right now|can you call (back|later)|go ahead|you can talk|you have (a few|two) minutes)",
        ],
        "reason": "Prospect is discussing availability, requesting a callback, or granting permission to speak.",
    },
    {
        "stage_number": 2,
        "name": "Purpose",
        "patterns": [
            r"(what is this (call|regarding|about)|what (does|do) (your company|you) do|where did you get my number|is this a sales call|why are you calling)",
        ],
        "reason": "Prospect is asking what the call is about or why they were contacted.",
    },
    {
        "stage_number": 1,
        "name": "Opening",
        "patterns": [
            r"(who is (this|calling)|wrong (number|contact|person)|left the company|not available|may i ask who's calling|speaking)",
        ],
        "reason": "Initial contact, recipient identification, or switchboard navigation.",
    },
]


def detect_stage_by_rules(transcript: str, current_stage: int) -> Dict[str, Any]:
    """
    Deterministic rule-based stage suggestion grounded strictly in transcript quotes.
    Scans turns in transcript, prioritizing later turns to identify current conversation focus.
    """
    if not transcript or not transcript.strip():
        return {
            "has_suggestion": False,
            "suggested_stage_number": None,
            "suggested_stage_name": None,
            "evidence_quote": None,
            "reason": None,
            "confidence": 0.0,
        }

    lines = [l.strip() for l in transcript.splitlines() if l.strip()]
    if not lines:
        return {
            "has_suggestion": False,
            "suggested_stage_number": None,
            "suggested_stage_name": None,
            "evidence_quote": None,
            "reason": None,
            "confidence": 0.0,
        }

    # Evaluate lines starting from the most recent
    for line in reversed(lines):
        line_clean = line
        # Strip speaker label if present (e.g. PROSPECT: or CALLER:)
        speaker_match = re.match(r"^(?:PROSPECT|CALLER|REPRESENTATIVE|CUSTOMER|AGENT):\s*(.*)$", line, re.IGNORECASE)
        content = speaker_match.group(1) if speaker_match else line

        for stage_cfg in STAGE_PATTERNS:
            target_stage = stage_cfg["stage_number"]
            # Do not suggest the stage caller is already on
            if target_stage == current_stage:
                continue

            for pat in stage_cfg["patterns"]:
                match = re.search(pat, content, re.IGNORECASE)
                if match:
                    # Extract a concise supporting quote from the line
                    matched_phrase = match.group(0)
                    evidence_quote = content.strip()
                    # Ensure evidence_quote is verified in original transcript
                    if not verify_quote_in_transcript(evidence_quote, transcript):
                        if verify_quote_in_transcript(matched_phrase, transcript):
                            evidence_quote = matched_phrase
                        else:
                            continue

                    return {
                        "has_suggestion": True,
                        "suggested_stage_number": target_stage,
                        "suggested_stage_name": stage_cfg["name"],
                        "evidence_quote": evidence_quote,
                        "reason": stage_cfg["reason"],
                        "confidence": 0.90,
                    }

    return {
        "has_suggestion": False,
        "suggested_stage_number": None,
        "suggested_stage_name": None,
        "evidence_quote": None,
        "reason": None,
        "confidence": 0.0,
    }


async def suggest_stage_from_transcript(
    transcript: str,
    current_stage: int = 1,
) -> Dict[str, Any]:
    """
    Suggests next stage transition based on transcript dialogue with supporting evidence.
    CRITICAL: Never automatically modifies database stage. Requires explicit confirmation.
    """
    clean_transcript = (transcript or "").strip()
    if not clean_transcript:
        return {
            "has_suggestion": False,
            "suggested_stage_number": None,
            "suggested_stage_name": None,
            "evidence_quote": None,
            "reason": None,
            "confidence": 0.0,
        }

    # First attempt LLM analysis if Gemini is configured and transcript is multi-turn
    if settings.gemini_configured and len(clean_transcript) > 60:
        try:
            from google.genai import types

            prompt = f"""You are an expert cold-call sales workflow observer.
Review the following cold-call dialogue and determine if the caller and prospect have naturally transitioned to a different stage than current Stage {current_stage}.

Workflow Stages:
1: Opening (reaching contact, gatekeepers, wrong numbers)
2: Purpose (explaining why calling, prospect asks what company does)
3: Permission (establishing time to talk, callbacks, busy, driving)
4: Their business (prospect explains company, operations, manufacturing)
5: Their need, in their words (prospect shares pain points, goals, margins, bottlenecks)
6: Objection (prospect raises hesitation, existing agency/vendor, not interested, asks for email)
7: Next step (agreeing on meeting, Google Meet, WhatsApp deck, calendar invite)
8: Close (concluding, final confirmation, thank you)

Instructions:
1. ONLY suggest a stage change if the dialogue CLEARLY shows the conversation has moved to another stage.
2. If the current dialogue is still within Stage {current_stage}, return has_suggestion = false.
3. If suggesting a stage, you MUST provide an EXACT VERBATIM QUOTE from the dialogue as evidence.
4. Output strict JSON only:
{{
  "has_suggestion": true/false,
  "suggested_stage_number": 1-8 or null,
  "suggested_stage_name": "Stage Name" or null,
  "evidence_quote": "Exact words from transcript" or null,
  "reason": "Brief rationale" or null,
  "confidence": 0.0-1.0
}}

Dialogue:
{clean_transcript}
"""

            def _call_gemini(client, model_name: str):
                return client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=MINIMAL_THINKING_INSTRUCTION,
                        response_mime_type="application/json",
                    ),
                )

            res = await asyncio.to_thread(
                text_model_pool.execute_with_fallback, _call_gemini
            )
            if res and res.text:
                data = json.loads(res.text.strip())
                if data.get("has_suggestion") and data.get("suggested_stage_number"):
                    s_num = int(data["suggested_stage_number"])
                    quote = (data.get("evidence_quote") or "").strip()
                    # Verify quote against transcript strictly
                    if s_num != current_stage and 1 <= s_num <= 8 and quote and verify_quote_in_transcript(quote, clean_transcript):
                        return {
                            "has_suggestion": True,
                            "suggested_stage_number": s_num,
                            "suggested_stage_name": STAGE_NAMES.get(s_num, f"Stage {s_num}"),
                            "evidence_quote": quote,
                            "reason": data.get("reason", "Conversation topic transitioned."),
                            "confidence": float(data.get("confidence", 0.9)),
                        }
        except Exception as exc:
            logger.warning(f"LLM stage suggestion failed: {exc}. Falling back to rule-based detection.")

    # Rule-based fallback (fast, deterministic, grounded)
    return detect_stage_by_rules(clean_transcript, current_stage)
