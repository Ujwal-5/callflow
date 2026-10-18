#!/usr/bin/env python3
"""
Supabase Integration Verification Script for CallFlow.
Checks connection, validates tables & constraints, and performs an end-to-end test.
"""

import sys
import os
import uuid

# Ensure repository root is in python path
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.app.config import settings
from backend.app.db import db


def main():
    print("=" * 60)
    print("CallFlow Supabase Integration Check")
    print("=" * 60)

    if not settings.SUPABASE_URL or not settings.supabase_key:
        print("❌ Error: SUPABASE_URL or SUPABASE_SECRET_KEY is not configured.")
        print("Please check backend/.env.")
        sys.exit(1)

    print(f"✓ Configured Supabase URL: {settings.SUPABASE_URL}")
    print("✓ Backend Secret Key: [Configured securely]")

    db.init_client()
    if not db.supabase_client:
        print("❌ Error: Failed to initialize Supabase client.")
        sys.exit(1)

    # 1. Check if tables exist
    print("\n1. Checking database schema on Supabase...")
    try:
        db.supabase_client.table("calls").select("id").limit(1).execute()
        print("  ✓ Table 'calls' exists.")
    except Exception as e:
        print(f"  ❌ Table 'calls' not ready: {e}")
        print("\n👉 ACTION REQUIRED: Run the SQL in backend/sql/schema.sql in your Supabase SQL Editor.")
        sys.exit(2)

    try:
        db.supabase_client.table("call_stage_results").select("id").limit(1).execute()
        print("  ✓ Table 'call_stage_results' exists.")
    except Exception as e:
        print(f"  ❌ Table 'call_stage_results' not ready: {e}")
        print("\n👉 ACTION REQUIRED: Run the SQL in backend/sql/schema.sql in your Supabase SQL Editor.")
        sys.exit(2)

    try:
        db.supabase_client.table("call_transcripts").select("id").limit(1).execute()
        print("  ✓ Table 'call_transcripts' exists.")
    except Exception as e:
        print(f"  ⚠️  Table 'call_transcripts' not created on Supabase yet.")
        print("  👉 Run backend/sql/migration_transcripts.sql in your Supabase SQL Editor to enable remote transcripts storage.")

    # 2. Test create call
    print("\n2. Testing call creation...")
    test_company = f"Verification Inc {uuid.uuid4().hex[:6]}"
    call = db.create_call(
        company_name=test_company,
        contact_name="Test Verifier",
        phone_number="+1 555-0199",
        context="Integration test call",
    )
    call_id = call["id"]
    print(f"  ✓ Call created: id={call_id}, company='{call['company_name']}', status='{call['status']}'")

    # 3. Test saving stage results (Stage 1 & Stage 5)
    print("\n3. Testing stage outcome and prospect exact words...")
    sr1 = db.upsert_stage_result(
        call_id=call_id,
        stage_number=1,
        selected_outcome="Reached intended person",
        notes="Connected directly on first try",
    )
    print(f"  ✓ Stage 1 saved: outcome='{sr1.get('selected_outcome')}'")

    exact_words = "We are currently evaluating alternatives to cut latency."
    sr5 = db.upsert_stage_result(
        call_id=call_id,
        stage_number=5,
        selected_outcome="Identified a need",
        prospect_exact_words=exact_words,
        notes="Primary latency bottleneck in ingestion pipeline",
    )
    print(f"  ✓ Stage 5 saved: exact_words='{sr5.get('prospect_exact_words')}'")

    # 4. Test updating stage result (revisiting stage 5 without creating duplicate)
    print("\n4. Testing stage update and unique constraint on (call_id, stage_number)...")
    sr5_updated = db.upsert_stage_result(
        call_id=call_id,
        stage_number=5,
        selected_outcome="Identified a critical need",
        prospect_exact_words=exact_words,
        notes="Updated notes: high budget priority for Q1",
    )
    print(f"  ✓ Stage 5 updated: outcome='{sr5_updated.get('selected_outcome')}'")

    # 5. Test loading call history
    print("\n5. Testing loading call detail history...")
    detail = db.get_call(call_id)
    if not detail:
        print("  ❌ Failed to retrieve call details.")
        sys.exit(3)

    stage_results = detail.get("stage_results", [])
    stage5_matches = [s for s in stage_results if s["stage_number"] == 5]
    if len(stage5_matches) != 1:
        print(f"  ❌ Unique constraint violation! Found {len(stage5_matches)} records for stage 5.")
        sys.exit(3)
    print(f"  ✓ Call detail loaded with {len(stage_results)} stage records (unique per stage).")

    # 6. Test listing calls
    print("\n6. Testing listing calls with search filter...")
    call_list = db.list_calls(search=test_company)
    if any(c["id"] == call_id for c in call_list):
        print(f"  ✓ Found call in search results.")
    else:
        print("  ❌ Call not found in search results.")
        sys.exit(3)

    # 7. Test closing call
    print("\n7. Testing closing call...")
    closed = db.close_call(
        call_id=call_id,
        final_outcome="Interested; follow-up agreed",
        next_action="Send technical architecture deck",
        follow_up_time="2026-10-25 10:00 AM UTC",
        follow_up_channel="Google Meet",
    )
    print(f"  ✓ Call closed: status='{closed.get('status')}', final_outcome='{closed.get('final_outcome')}'")

    # 8. Clean up test record
    print("\n8. Cleaning up test record...")
    try:
        db.supabase_client.table("call_stage_results").delete().eq("call_id", call_id).execute()
        db.supabase_client.table("calls").delete().eq("id", call_id).execute()
        print("  ✓ Test records cleaned up successfully.")
    except Exception as e:
        print(f"  (Note: test record cleanup: {e})")

    print("\n" + "=" * 60)
    print("🎉 ALL SUPABASE DATABASE OPERATIONS TESTED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    main()
