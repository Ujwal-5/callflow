#!/usr/bin/env python3
"""Copy CallFlow's local SQLite data into Supabase without changing IDs.

Run after migration_supabase_missing_tables.sql has been applied. The script
uses upserts keyed by each table's primary key, so it is safe to re-run if a
network interruption occurs.
"""

import argparse
import json
import os
import sqlite3
import sys
from typing import Any, Dict, Iterable, List

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.app.config import settings
from backend.app.db import db

# This is a one-time import utility only. SQLite is not part of the runtime
# application adapter; the source file must be supplied by the operator.
DEFAULT_SQLITE_DB_PATH = os.path.join(ROOT_DIR, "backend", "callflow.db")

TABLES = [
    "calls",
    "prospects",
    "call_stage_results",
    "call_transcripts",
    "call_commitments",
    "call_missed_opportunities",
    "call_conversation_gaps",
]


def normalize(table: str, row: sqlite3.Row) -> Dict[str, Any]:
    item = dict(row)
    if table == "calls" and isinstance(item.get("ai_summary"), str):
        item["ai_summary"] = json.loads(item["ai_summary"]) if item["ai_summary"] else None
    if table == "call_transcripts" and isinstance(item.get("transcript_metadata"), str):
        item["transcript_metadata"] = (
            json.loads(item["transcript_metadata"])
            if item["transcript_metadata"]
            else None
        )
    for key in ("needs_confirmation", "is_custom"):
        if key in item and item[key] is not None:
            item[key] = bool(item[key])
    return item


def read_rows(conn: sqlite3.Connection, table: str) -> List[Dict[str, Any]]:
    rows = conn.execute(f"SELECT * FROM {table}").fetchall()
    normalized = [normalize(table, row) for row in rows]
    if table != "prospects":
        return normalized

    # Supabase enforces the application's one-prospect-per-company rule. The
    # old SQLite file predates that constraint and contains three duplicates.
    # Keep the stable first record and report the skipped IDs rather than
    # failing the whole migration.
    unique: List[Dict[str, Any]] = []
    seen_companies = set()
    skipped = []
    for item in normalized:
        key = (item.get("company_name") or "").strip().lower()
        if key in seen_companies:
            skipped.append(item.get("id"))
            continue
        seen_companies.add(key)
        unique.append(item)
    if skipped:
        print(f"  prospects: skipped duplicate company records: {', '.join(skipped)}")
    return unique


def chunks(items: List[Dict[str, Any]], size: int = 100) -> Iterable[List[Dict[str, Any]]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Show row counts without writing")
    args = parser.parse_args()

    if not settings.use_supabase or not db.supabase_client:
        print("Supabase is not configured. Set SUPABASE_URL and a Supabase secret key.")
        return 1

    conn = sqlite3.connect(DEFAULT_SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        all_rows = {table: read_rows(conn, table) for table in TABLES}
    finally:
        conn.close()

    print("SQLite source rows:")
    for table in TABLES:
        print(f"  {table}: {len(all_rows[table])}")

    if args.dry_run:
        return 0

    # Parent tables first, then children with foreign keys.
    for table in TABLES:
        rows = all_rows[table]
        for batch in chunks(rows):
            db.supabase_client.table(table).upsert(batch, on_conflict="id").execute()
        print(f"Migrated {len(rows)} rows to {table}.")

    print("Migration complete. Run verify_supabase.py to validate the schema.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
