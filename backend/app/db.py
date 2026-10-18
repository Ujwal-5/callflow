import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from backend.app.config import settings

try:
    from supabase import create_client, Client
except ImportError:
    Client = None
    create_client = None


def get_utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DatabaseAdapter:
    def __init__(self):
        self.db_path = settings.SQLITE_DB_PATH
        self.supabase_client: Optional[Client] = None
        self.use_supabase = False
        self._force_sqlite = False
        self.init_client()

    def init_client(self):
        if self._force_sqlite:
            self.use_supabase = False
            self.supabase_client = None
            return

        self.use_supabase = settings.use_supabase
        if self.use_supabase and create_client:
            key = settings.supabase_key
            self.supabase_client = create_client(settings.SUPABASE_URL, key)
        else:
            self.supabase_client = None

    def get_sqlite_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def init_db(self):
        self.init_client()
        if self.use_supabase and self.supabase_client:
            # Supabase schema is managed via SQL migrations / Supabase dashboard
            return
        
        # SQLite schema initialization
        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS calls (
            id TEXT PRIMARY KEY,
            company_name TEXT NOT NULL,
            contact_name TEXT,
            phone_number TEXT,
            context TEXT,
            status TEXT NOT NULL DEFAULT 'in_progress',
            current_stage INTEGER NOT NULL DEFAULT 1,
            highest_stage INTEGER NOT NULL DEFAULT 1,
            final_outcome TEXT,
            next_action TEXT,
            follow_up_time TEXT,
            follow_up_channel TEXT,
            ai_summary TEXT,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS call_stage_results (
            id TEXT PRIMARY KEY,
            call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
            stage_number INTEGER NOT NULL,
            selected_outcome TEXT,
            prospect_exact_words TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(call_id, stage_number)
        );
        """)

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_calls_company ON calls(company_name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_stage_results_call ON call_stage_results(call_id);")

        # Transcript table: one record per call, upserted on retry
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS call_transcripts (
            id TEXT PRIMARY KEY,
            call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            raw_transcript TEXT,
            edited_transcript TEXT,
            transcript_metadata TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(call_id)
        );
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_transcripts_call ON call_transcripts(call_id);"
        )

        conn.commit()
        conn.close()

    def create_call(self, company_name: str, contact_name: Optional[str] = None,
                    phone_number: Optional[str] = None, context: Optional[str] = None) -> Dict[str, Any]:
        call_id = str(uuid.uuid4())
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            payload = {
                "id": call_id,
                "company_name": company_name.strip(),
                "contact_name": contact_name.strip() if contact_name else None,
                "phone_number": phone_number.strip() if phone_number else None,
                "context": context.strip() if context else None,
                "status": "in_progress",
                "current_stage": 1,
                "highest_stage": 1,
                "started_at": now,
                "created_at": now,
                "updated_at": now,
            }
            res = self.supabase_client.table("calls").insert(payload).execute()
            return self._format_call_dict(res.data[0])

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO calls (id, company_name, contact_name, phone_number, context, status, current_stage, highest_stage, started_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'in_progress', 1, 1, ?, ?, ?)
        """, (
            call_id,
            company_name.strip(),
            contact_name.strip() if contact_name else None,
            phone_number.strip() if phone_number else None,
            context.strip() if context else None,
            now,
            now,
            now
        ))
        conn.commit()
        cursor.execute("SELECT * FROM calls WHERE id = ?", (call_id,))
        row = cursor.fetchone()
        res = dict(row)
        conn.close()
        return self._format_call_dict(res)

    def list_calls(self, search: Optional[str] = None, outcome: Optional[str] = None,
                   stage: Optional[int] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            query = self.supabase_client.table("calls").select("*").order("started_at", desc=True)
            if search:
                query = query.or_(f"company_name.ilike.%{search}%,contact_name.ilike.%{search}%")
            if outcome:
                query = query.eq("final_outcome", outcome)
            if stage:
                query = query.eq("highest_stage", stage)
            if status:
                query = query.eq("status", status)
            res = query.execute()
            return [self._format_call_dict(r) for r in res.data]

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        query = "SELECT * FROM calls WHERE 1=1"
        params: List[Any] = []

        if search:
            query += " AND (company_name LIKE ? OR contact_name LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])
        if outcome:
            query += " AND final_outcome = ?"
            params.append(outcome)
        if stage:
            query += " AND highest_stage = ?"
            params.append(stage)
        if status:
            query += " AND status = ?"
            params.append(status)

        query += " ORDER BY started_at DESC"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        result = [self._format_call_dict(dict(r)) for r in rows]
        conn.close()
        return result

    def get_call(self, call_id: str) -> Optional[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            call_res = self.supabase_client.table("calls").select("*").eq("id", call_id).execute()
            if not call_res.data:
                return None
            call_data = self._format_call_dict(call_res.data[0])
            stages_res = self.supabase_client.table("call_stage_results").select("*").eq("call_id", call_id).order("stage_number").execute()
            call_data["stage_results"] = stages_res.data
            return call_data

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM calls WHERE id = ?", (call_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return None
        call_data = self._format_call_dict(dict(row))

        cursor.execute("SELECT * FROM call_stage_results WHERE call_id = ? ORDER BY stage_number ASC", (call_id,))
        stage_rows = cursor.fetchall()
        call_data["stage_results"] = [dict(sr) for sr in stage_rows]
        conn.close()
        return call_data

    def upsert_stage_result(self, call_id: str, stage_number: int,
                            selected_outcome: Optional[str] = None,
                            prospect_exact_words: Optional[str] = None,
                            notes: Optional[str] = None) -> Dict[str, Any]:
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            # Check existing stage result
            existing = self.supabase_client.table("call_stage_results").select("*").eq("call_id", call_id).eq("stage_number", stage_number).execute()
            if existing.data:
                result_id = existing.data[0]["id"]
                update_payload = {
                    "updated_at": now
                }
                if selected_outcome is not None:
                    update_payload["selected_outcome"] = selected_outcome
                if prospect_exact_words is not None:
                    update_payload["prospect_exact_words"] = prospect_exact_words
                if notes is not None:
                    update_payload["notes"] = notes
                res = self.supabase_client.table("call_stage_results").update(update_payload).eq("id", result_id).execute()
                stage_data = res.data[0]
            else:
                result_id = str(uuid.uuid4())
                insert_payload = {
                    "id": result_id,
                    "call_id": call_id,
                    "stage_number": stage_number,
                    "selected_outcome": selected_outcome,
                    "prospect_exact_words": prospect_exact_words,
                    "notes": notes,
                    "created_at": now,
                    "updated_at": now
                }
                res = self.supabase_client.table("call_stage_results").insert(insert_payload).execute()
                stage_data = res.data[0]

            # Update call highest stage and current stage
            call_res = self.supabase_client.table("calls").select("highest_stage").eq("id", call_id).execute()
            if call_res.data:
                current_highest = call_res.data[0]["highest_stage"]
                new_highest = max(current_highest, stage_number)
                self.supabase_client.table("calls").update({
                    "current_stage": stage_number,
                    "highest_stage": new_highest,
                    "updated_at": now
                }).eq("id", call_id).execute()

            return stage_data

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()

        # Check existing
        cursor.execute("SELECT id FROM call_stage_results WHERE call_id = ? AND stage_number = ?", (call_id, stage_number))
        existing_row = cursor.fetchone()

        if existing_row:
            result_id = existing_row["id"]
            cursor.execute("""
                UPDATE call_stage_results
                SET selected_outcome = COALESCE(?, selected_outcome),
                    prospect_exact_words = COALESCE(?, prospect_exact_words),
                    notes = COALESCE(?, notes),
                    updated_at = ?
                WHERE id = ?
            """, (selected_outcome, prospect_exact_words, notes, now, result_id))
        else:
            result_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO call_stage_results (id, call_id, stage_number, selected_outcome, prospect_exact_words, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (result_id, call_id, stage_number, selected_outcome, prospect_exact_words, notes, now, now))

        # Update call table
        cursor.execute("SELECT highest_stage FROM calls WHERE id = ?", (call_id,))
        call_row = cursor.fetchone()
        if call_row:
            new_highest = max(call_row["highest_stage"], stage_number)
            cursor.execute("""
                UPDATE calls
                SET current_stage = ?, highest_stage = ?, updated_at = ?
                WHERE id = ?
            """, (stage_number, new_highest, now, call_id))

        conn.commit()
        cursor.execute("SELECT * FROM call_stage_results WHERE id = ?", (result_id,))
        res = dict(cursor.fetchone())
        conn.close()
        return res

    def advance_stage(self, call_id: str, next_stage: int) -> Optional[Dict[str, Any]]:
        now = get_utc_now_iso()
        if self.use_supabase and self.supabase_client:
            call_res = self.supabase_client.table("calls").select("highest_stage").eq("id", call_id).execute()
            if not call_res.data:
                return None
            new_highest = max(call_res.data[0]["highest_stage"], next_stage)
            res = self.supabase_client.table("calls").update({
                "current_stage": next_stage,
                "highest_stage": new_highest,
                "updated_at": now
            }).eq("id", call_id).execute()
            return self.get_call(call_id)

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT highest_stage FROM calls WHERE id = ?", (call_id,))
        call_row = cursor.fetchone()
        if not call_row:
            conn.close()
            return None
        new_highest = max(call_row["highest_stage"], next_stage)
        cursor.execute("""
            UPDATE calls
            SET current_stage = ?, highest_stage = ?, updated_at = ?
            WHERE id = ?
        """, (next_stage, new_highest, now, call_id))
        conn.commit()
        conn.close()
        return self.get_call(call_id)

    def close_call(self, call_id: str, final_outcome: str, next_action: Optional[str] = None,
                   follow_up_time: Optional[str] = None, follow_up_channel: Optional[str] = None) -> Optional[Dict[str, Any]]:
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            update_payload = {
                "status": "completed",
                "final_outcome": final_outcome,
                "next_action": next_action,
                "follow_up_time": follow_up_time,
                "follow_up_channel": follow_up_channel,
                "ended_at": now,
                "updated_at": now
            }
            self.supabase_client.table("calls").update(update_payload).eq("id", call_id).execute()
            return self.get_call(call_id)

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE calls
            SET status = 'completed',
                final_outcome = ?,
                next_action = ?,
                follow_up_time = ?,
                follow_up_channel = ?,
                ended_at = ?,
                updated_at = ?
            WHERE id = ?
        """, (final_outcome, next_action, follow_up_time, follow_up_channel, now, now, call_id))
        conn.commit()
        conn.close()
        return self.get_call(call_id)

    def update_call_summary(self, call_id: str, summary_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            self.supabase_client.table("calls").update({
                "ai_summary": summary_data,
                "updated_at": now
            }).eq("id", call_id).execute()
            return self.get_call(call_id)

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE calls
            SET ai_summary = ?,
                updated_at = ?
            WHERE id = ?
        """, (json.dumps(summary_data), now, call_id))
        conn.commit()
        conn.close()
        return self.get_call(call_id)

    def _format_call_dict(self, row: Dict[str, Any]) -> Dict[str, Any]:
        d = dict(row)
        if "ai_summary" in d and d["ai_summary"]:
            if isinstance(d["ai_summary"], str):
                try:
                    d["ai_summary"] = json.loads(d["ai_summary"])
                except Exception:
                    pass
        return d

    # ──────────────────────────────────────────────────────────────
    # Transcript methods
    # ──────────────────────────────────────────────────────────────

    def get_transcript(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Return the transcript record for a call, or None if it does not exist."""
        if self.use_supabase and self.supabase_client:
            res = (
                self.supabase_client
                .table("call_transcripts")
                .select("*")
                .eq("call_id", call_id)
                .execute()
            )
            return self._format_transcript_dict(res.data[0]) if res.data else None

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM call_transcripts WHERE call_id = ?", (call_id,)
        )
        row = cursor.fetchone()
        conn.close()
        return self._format_transcript_dict(dict(row)) if row else None

    def upsert_transcript_pending(self, call_id: str) -> Dict[str, Any]:
        """Create or reset a transcript record to 'processing' status.

        Prevents duplicate rows: if a record already exists for the call,
        its status and timestamps are updated instead of inserting a new row.
        """
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            existing = (
                self.supabase_client
                .table("call_transcripts")
                .select("id")
                .eq("call_id", call_id)
                .execute()
            )
            if existing.data:
                rec_id = existing.data[0]["id"]
                res = (
                    self.supabase_client
                    .table("call_transcripts")
                    .update({
                        "status": "processing",
                        "raw_transcript": None,
                        "edited_transcript": None,
                        "error_message": None,
                        "transcript_metadata": None,
                        "updated_at": now,
                    })
                    .eq("id", rec_id)
                    .execute()
                )
            else:
                rec_id = str(uuid.uuid4())
                res = (
                    self.supabase_client
                    .table("call_transcripts")
                    .insert({
                        "id": rec_id,
                        "call_id": call_id,
                        "status": "processing",
                        "created_at": now,
                        "updated_at": now,
                    })
                    .execute()
                )
            return self._format_transcript_dict(res.data[0])

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM call_transcripts WHERE call_id = ?", (call_id,)
        )
        row = cursor.fetchone()

        if row:
            rec_id = row["id"]
            cursor.execute("""
                UPDATE call_transcripts
                SET status = 'processing',
                    raw_transcript = NULL,
                    edited_transcript = NULL,
                    error_message = NULL,
                    transcript_metadata = NULL,
                    updated_at = ?
                WHERE id = ?
            """, (now, rec_id))
        else:
            rec_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO call_transcripts
                    (id, call_id, status, created_at, updated_at)
                VALUES (?, ?, 'processing', ?, ?)
            """, (rec_id, call_id, now, now))

        conn.commit()
        cursor.execute("SELECT * FROM call_transcripts WHERE id = ?", (rec_id,))
        result = self._format_transcript_dict(dict(cursor.fetchone()))
        conn.close()
        return result

    def complete_transcript(
        self,
        call_id: str,
        raw_transcript: str,
        transcript_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Mark a transcript as completed and store the raw transcribed text."""
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            res = (
                self.supabase_client
                .table("call_transcripts")
                .update({
                    "status": "completed",
                    "raw_transcript": raw_transcript,
                    "transcript_metadata": transcript_metadata,
                    "error_message": None,
                    "updated_at": now,
                })
                .eq("call_id", call_id)
                .execute()
            )
            return self._format_transcript_dict(res.data[0])

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE call_transcripts
            SET status = 'completed',
                raw_transcript = ?,
                transcript_metadata = ?,
                error_message = NULL,
                updated_at = ?
            WHERE call_id = ?
        """, (
            raw_transcript,
            json.dumps(transcript_metadata) if transcript_metadata else None,
            now,
            call_id,
        ))
        conn.commit()
        cursor.execute(
            "SELECT * FROM call_transcripts WHERE call_id = ?", (call_id,)
        )
        result = self._format_transcript_dict(dict(cursor.fetchone()))
        conn.close()
        return result

    def fail_transcript(self, call_id: str, error_message: str) -> Dict[str, Any]:
        """Mark a transcript as failed with an error message."""
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            res = (
                self.supabase_client
                .table("call_transcripts")
                .update({
                    "status": "failed",
                    "error_message": error_message,
                    "updated_at": now,
                })
                .eq("call_id", call_id)
                .execute()
            )
            return self._format_transcript_dict(res.data[0])

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE call_transcripts
            SET status = 'failed',
                error_message = ?,
                updated_at = ?
            WHERE call_id = ?
        """, (error_message, now, call_id))
        conn.commit()
        cursor.execute(
            "SELECT * FROM call_transcripts WHERE call_id = ?", (call_id,)
        )
        result = self._format_transcript_dict(dict(cursor.fetchone()))
        conn.close()
        return result

    def update_edited_transcript(
        self, call_id: str, edited_transcript: str
    ) -> Optional[Dict[str, Any]]:
        """Persist the user's edited version of the transcript.

        The raw_transcript is never overwritten here — edits are stored
        in the separate edited_transcript column.
        """
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            res = (
                self.supabase_client
                .table("call_transcripts")
                .update({"edited_transcript": edited_transcript, "updated_at": now})
                .eq("call_id", call_id)
                .execute()
            )
            return self._format_transcript_dict(res.data[0]) if res.data else None

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE call_transcripts
            SET edited_transcript = ?,
                updated_at = ?
            WHERE call_id = ?
        """, (edited_transcript, now, call_id))
        conn.commit()
        cursor.execute(
            "SELECT * FROM call_transcripts WHERE call_id = ?", (call_id,)
        )
        row = cursor.fetchone()
        conn.close()
        return self._format_transcript_dict(dict(row)) if row else None

    def _format_transcript_dict(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """Deserialise JSON transcript_metadata if stored as a string (SQLite)."""
        d = dict(row)
        if "transcript_metadata" in d and d["transcript_metadata"]:
            if isinstance(d["transcript_metadata"], str):
                try:
                    d["transcript_metadata"] = json.loads(d["transcript_metadata"])
                except Exception:
                    pass
        return d


db = DatabaseAdapter()
