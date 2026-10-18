import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from backend.app.config import settings

logger = logging.getLogger("callflow.llm")

# System instruction strictly adhering to prompt requirements
SUMMARY_PROMPT_TEMPLATE = """You are an assistant for a B2B sales development representative analyzing cold-call results.
Your task is to provide a concise call summary and extract a suggested next action strictly from the recorded call notes and prospect words.

Guidelines:
1. Ground your summary exclusively in the provided notes.
2. DO NOT invent dates, times, channels, or facts that are not present in the notes. If no timing is mentioned, leave 'suggested_follow_up_timing' null.
3. Be concise and professional.
4. Output must be valid JSON matching the exact schema below.

JSON Schema:
{{
  "summary": "Concise 1-2 sentence factual summary of what happened on the call",
  "outcome_rationale": "Brief 1-sentence rationale for the outcome",
  "suggested_next_action": "Clear suggested next action",
  "suggested_follow_up_timing": "Timing only if supported by notes, else null"
}}

Call Context:
Company: {company_name}
Contact: {contact_name}
Final Outcome Logged: {final_outcome}
Next Action Logged: {next_action}
Follow-up Timing: {follow_up_time}

Stage-by-Stage Results:
{stage_notes_text}
"""


def format_stage_notes_for_llm(call_data: Dict[str, Any]) -> str:
    lines = []
    stage_results = call_data.get("stage_results", [])
    if not stage_results:
        return "No stage notes recorded."

    for sr in sorted(stage_results, key=lambda x: x.get("stage_number", 0)):
        stage_num = sr.get("stage_number")
        outcome = sr.get("selected_outcome")
        exact_words = sr.get("prospect_exact_words")
        notes = sr.get("notes")

        parts = [f"Stage {stage_num}:"]
        if outcome:
            parts.append(f"Outcome: {outcome}")
        if exact_words:
            parts.append(f"Prospect's exact words: \"{exact_words}\"")
        if notes:
            parts.append(f"Notes: {notes}")

        lines.append(" | ".join(parts))

    return "\n".join(lines)


async def generate_call_summary(call_data: Dict[str, Any]) -> Dict[str, Any]:
    if not settings.gemini_configured:
        return {
            "available": False,
            "error": (
                "Gemini API key is not configured on the server. "
                "Please set GEMINI_API_KEY or GEMINI_API_KEY_2."
            ),
            "summary": None,
        }

    try:
        from google.genai import types
        from backend.app.gemini_pool import text_model_pool

        stage_text = format_stage_notes_for_llm(call_data)

        prompt = SUMMARY_PROMPT_TEMPLATE.format(
            company_name=call_data.get("company_name", "Unknown"),
            contact_name=call_data.get("contact_name", "Not specified"),
            final_outcome=call_data.get("final_outcome", "Not closed"),
            next_action=call_data.get("next_action", "None"),
            follow_up_time=call_data.get("follow_up_time", "None"),
            stage_notes_text=stage_text
        )

        def _call_gemini(client, model_name: str):
            return client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2,
                )
            )

        response = text_model_pool.execute_with_fallback(_call_gemini)

        response_text = response.text.strip()
        data = json.loads(response_text)

        # Validate required fields
        summary = data.get("summary", "")
        rationale = data.get("outcome_rationale", "")
        next_action = data.get("suggested_next_action", "")
        timing = data.get("suggested_follow_up_timing")

        return {
            "available": True,
            "error": None,
            "summary": {
                "summary": summary,
                "outcome_rationale": rationale,
                "suggested_next_action": next_action,
                "suggested_follow_up_timing": timing,
                "generated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    except Exception as e:
        logger.warning(f"Gemini call summary failed: {str(e)}")
        return {
            "available": False,
            "error": f"AI summary generation failed: {str(e)}",
            "summary": None,
        }
