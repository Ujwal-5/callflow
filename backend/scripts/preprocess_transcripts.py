"""
backend/scripts/preprocess_transcripts.py — Preprocessing and indexing script for 100 historical cold-call transcripts.

Parses all 100 transcripts in backend/cold-call-transcripts-100/transcripts/:
- Verifies readability and metadata completeness.
- Extracts speaker-labeled dialogue.
- Identifies commitments, callbacks, referrals, objections, needs, and discrepancies.
- Produces a machine-readable JSON index (backend/cold-call-transcripts-100/radar_historical_index.json).
- Aggregates outcome counts directly from the source files.
- Is idempotent and rerun-safe.
"""

import os
import re
import json
import glob
from collections import Counter
from typing import Dict, Any, List, Optional


TRANSCRIPTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "cold-call-transcripts-100",
    "transcripts",
)
INDEX_OUTPUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "cold-call-transcripts-100",
    "radar_historical_index.json",
)


def parse_transcript_file(fpath: str) -> Dict[str, Any]:
    """Parse one transcript file into metadata and structured speaker turns."""
    transcript_id = os.path.splitext(os.path.basename(fpath))[0]
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.splitlines()
    header_done = False
    metadata: Dict[str, Any] = {
        "id": transcript_id,
        "duration_seconds": None,
        "outcome": "not_logged",
        "prospect_role": None,
        "company_kind": None,
        "company": None,
        "caller": None,
    }
    turns: List[Dict[str, str]] = []

    for line in lines:
        stripped = line.strip()
        if not header_done:
            if stripped.startswith("#"):
                continue
            if ":" in stripped and not any(
                stripped.startswith(prefix) for prefix in ("CALLER:", "PROSPECT:", "RECEPTION:")
            ):
                key, val = stripped.split(":", 1)
                k = key.strip()
                v = val.strip()
                if k == "duration_seconds":
                    try:
                        metadata["duration_seconds"] = int(v)
                    except ValueError:
                        metadata["duration_seconds"] = v
                else:
                    metadata[k] = v
                continue
            elif stripped == "":
                continue
            else:
                header_done = True

        if header_done and stripped:
            match = re.match(r"^([A-Z_]+):\s*(.*)", stripped)
            if match:
                spk = match.group(1).strip()
                text = match.group(2).strip()
                turns.append({"speaker": spk, "text": text})

    return {
        "metadata": metadata,
        "turns": turns,
        "raw_text": content,
    }


def extract_historical_patterns(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Extract candidate commitments, objections, needs, and referrals from dialogue turns."""
    meta = parsed["metadata"]
    turns = parsed["turns"]
    transcript_id = meta["id"]

    extracted_commitments = []
    extracted_objections = []
    extracted_needs = []
    extracted_referrals = []
    discrepancy_note = None

    # Patterns for rule-assisted extraction
    callback_pattern = re.compile(
        r"(call\s+(?:me\s+)?(?:back\s+)?(?:after|in|sometime|next|tomorrow|later|on)|connect\s+next|speak\s+after)",
        re.IGNORECASE,
    )
    report_pattern = re.compile(
        r"(send\s+(?:an?\s+)?(?:email|report|profile|details|case\s+studies)|share\s+(?:the\s+)?(?:report|profile|details|number|information)|whatsapp)",
        re.IGNORECASE,
    )
    meeting_pattern = re.compile(
        r"(schedule\s+(?:a\s+)?meeting|google\s+meet|connect\s+with\s+(?:our\s+founder|him)|working\s+session|zoom)",
        re.IGNORECASE,
    )
    referral_pattern = re.compile(
        r"(connect\s+with\s+Mr\.|speak\s+to\s+somebody|share\s+a\s+number|handles\s+(?:our\s+)?(?:operations|department)|wrong\s+person|right\s+person)",
        re.IGNORECASE,
    )
    objection_pattern = re.compile(
        r"(working\s+with\s+consultants|don'?t\s+require|not\s+interested|already\s+have|in-house\s+team|not\s+authorized|busy\s+right\s+now|still\s+a\s+startup)",
        re.IGNORECASE,
    )
    need_pattern = re.compile(
        r"(job\s+work|margin|profitability|revenue|ebitda|bottlenecks?|growth|problem|looking\s+for\s+people)",
        re.IGNORECASE,
    )

    for i, turn in enumerate(turns):
        spk = turn["speaker"]
        txt = turn["text"]
        surrounding = [
            f"{t['speaker']}: {t['text']}"
            for t in turns[max(0, i - 1) : min(len(turns), i + 2)]
        ]
        context_str = " | ".join(surrounding)

        # Check commitments: callbacks, reports, meetings
        if callback_pattern.search(txt):
            status = "requested" if spk == "PROSPECT" else "promised"
            extracted_commitments.append({
                "type": "callback",
                "speaker": spk,
                "quote": txt,
                "context": context_str,
                "detected_action": "Callback requested / agreed",
                "status": status,
            })

        if report_pattern.search(txt):
            status = "requested" if spk == "PROSPECT" else "promised"
            extracted_commitments.append({
                "type": "send_information",
                "speaker": spk,
                "quote": txt,
                "context": context_str,
                "detected_action": "Share report/details via email or WhatsApp",
                "status": status,
            })

        if meeting_pattern.search(txt):
            extracted_commitments.append({
                "type": "meeting",
                "speaker": spk,
                "quote": txt,
                "context": context_str,
                "detected_action": "Schedule follow-up meeting / working session",
                "status": "explicitly_agreed" if "Google Meet" in txt or "Tuesday" in txt else "suggested",
            })

        if referral_pattern.search(txt):
            extracted_referrals.append({
                "speaker": spk,
                "quote": txt,
                "context": context_str,
                "details": "Referral to internal colleague or decision-maker",
            })

        if spk == "PROSPECT" and objection_pattern.search(txt):
            extracted_objections.append({
                "quote": txt,
                "context": context_str,
                "details": "Prospect objection or friction point",
            })

        if spk == "PROSPECT" and need_pattern.search(txt):
            extracted_needs.append({
                "quote": txt,
                "context": context_str,
                "details": "Prospect stated business condition, need, or focus",
            })

    # Discrepancy detection between recorded outcome and actual dialogue
    rec_out = meta.get("outcome", "")
    if rec_out == "not_logged" and extracted_commitments:
        discrepancy_note = f"Caller logged outcome as 'not_logged', but transcript contains {len(extracted_commitments)} explicit commitment(s) or callback requests."
    elif rec_out == "not_interested" and extracted_needs:
        discrepancy_note = f"Caller logged outcome as 'not_interested', but prospect articulated specific business need/margin constraints."
    elif rec_out == "wrong_person" and extracted_referrals:
        discrepancy_note = "Prospect clarified wrong contact and provided referral or alternative context."

    # Build searchable combined text
    searchable_text = f"{meta.get('company', '')} {meta.get('prospect_role', '')} {meta.get('company_kind', '')} " + " ".join(t["text"] for t in turns)

    return {
        "id": transcript_id,
        "metadata": meta,
        "turns_count": len(turns),
        "commitments": extracted_commitments,
        "objections": extracted_objections,
        "needs": extracted_needs,
        "referrals": extracted_referrals,
        "discrepancy_note": discrepancy_note,
        "searchable_text": searchable_text.lower(),
        "key_quote": turns[-2]["text"] if len(turns) >= 2 else (turns[0]["text"] if turns else ""),
    }


def process_all_transcripts() -> Dict[str, Any]:
    """Process all 100 historical transcripts and create index dictionary."""
    pattern = os.path.join(TRANSCRIPTS_DIR, "T*.txt")
    files = sorted(glob.glob(pattern))
    if not files:
        raise FileNotFoundError(f"No transcripts found in {TRANSCRIPTS_DIR}")

    records = []
    outcome_counts = Counter()
    unreadable = []

    for fpath in files:
        try:
            parsed = parse_transcript_file(fpath)
            extracted = extract_historical_patterns(parsed)
            records.append(extracted)
            outcome_counts[parsed["metadata"].get("outcome", "unknown")] += 1
        except Exception as exc:
            unreadable.append({"file": fpath, "error": str(exc)})

    discrepancy_count = sum(1 for r in records if r["discrepancy_note"])
    commitments_count = sum(len(r["commitments"]) for r in records)

    index_data = {
        "version": "1.0.0",
        "total_transcripts": len(records),
        "outcome_distribution": dict(outcome_counts.most_common()),
        "unreadable_files": unreadable,
        "total_commitments_extracted": commitments_count,
        "total_discrepant_calls": discrepancy_count,
        "transcripts": {r["id"]: r for r in records},
    }

    # Write output to json
    with open(INDEX_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(index_data, f, indent=2)

    return index_data


if __name__ == "__main__":
    print(f"Starting historical transcripts preprocessing from: {TRANSCRIPTS_DIR}")
    result = process_all_transcripts()
    print(f"Successfully processed {result['total_transcripts']} transcripts.")
    print("Outcome distribution:")
    for k, v in result["outcome_distribution"].items():
        print(f"  - {k}: {v}")
    print(f"Extracted {result['total_commitments_extracted']} candidate commitments.")
    print(f"Detected {result['total_discrepant_calls']} calls with outcome/transcript discrepancies.")
    print(f"Saved index to: {INDEX_OUTPUT_PATH}")
