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
        self.init_db()

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
        # Ensure SQLite schema is always initialized for fallback and local testing
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
            referral_name TEXT,
            referral_contact TEXT,
            objection TEXT,
            prospect_statement TEXT,
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
            status TEXT NOT NULL DEFAULT 'completed',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(call_id, stage_number)
        );
        """)

        # Migration columns if table already existed without them
        for col_name, col_type in [
            ("referral_name", "TEXT"),
            ("referral_contact", "TEXT"),
            ("objection", "TEXT"),
            ("prospect_statement", "TEXT"),
        ]:
            try:
                cursor.execute(f"ALTER TABLE calls ADD COLUMN {col_name} {col_type};")
            except Exception:
                pass

        try:
            cursor.execute("ALTER TABLE call_stage_results ADD COLUMN status TEXT DEFAULT 'completed';")
        except Exception:
            pass

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

        # Commitment Radar: call_commitments table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS call_commitments (
            id TEXT PRIMARY KEY,
            call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
            action TEXT NOT NULL,
            responsible_party TEXT NOT NULL DEFAULT 'unknown',
            commitment_status TEXT NOT NULL DEFAULT 'uncertain',
            due_at TEXT,
            relative_due TEXT,
            channel TEXT NOT NULL DEFAULT 'unknown',
            evidence_quote TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 1.0,
            needs_confirmation INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_commitments_call ON call_commitments(call_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_commitments_status ON call_commitments(status);")

        # Commitment Radar: call_missed_opportunities table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS call_missed_opportunities (
            id TEXT PRIMARY KEY,
            call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'medium',
            description TEXT NOT NULL,
            evidence_quote TEXT NOT NULL,
            why_it_matters TEXT NOT NULL,
            suggested_action TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 1.0,
            needs_confirmation INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_missed_opps_call ON call_missed_opportunities(call_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_missed_opps_status ON call_missed_opportunities(status);")

        # Conversation Gap Detector: call_conversation_gaps table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS call_conversation_gaps (
            id TEXT PRIMARY KEY,
            call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'medium',
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            evidence_quote TEXT NOT NULL,
            context_quote TEXT,
            why_it_matters TEXT NOT NULL,
            suggested_action TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 1.0,
            status TEXT NOT NULL DEFAULT 'open',
            commitment_id TEXT REFERENCES call_commitments(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_gaps_call ON call_conversation_gaps(call_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_gaps_status ON call_conversation_gaps(status);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_gaps_type ON call_conversation_gaps(type);")

        # Prospects table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS prospects (
            id TEXT PRIMARY KEY,
            company_name TEXT NOT NULL,
            contact_name TEXT,
            phone_number TEXT,
            context TEXT,
            is_custom INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_prospects_company ON prospects(company_name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_prospects_created ON prospects(created_at DESC);")

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
            call_data["stage_results"] = stages_res.data or []
            call_data["commitments"] = self.list_commitments(call_id)
            call_data["missed_opportunities"] = self.list_missed_opportunities(call_id)
            call_data["conversation_gaps"] = self.list_conversation_gaps(call_id)
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
        call_data["commitments"] = self.list_commitments(call_id)
        call_data["missed_opportunities"] = self.list_missed_opportunities(call_id)
        call_data["conversation_gaps"] = self.list_conversation_gaps(call_id)
        return call_data


    def upsert_stage_result(self, call_id: str, stage_number: int,
                            selected_outcome: Optional[str] = None,
                            prospect_exact_words: Optional[str] = None,
                            notes: Optional[str] = None,
                            status: Optional[str] = None) -> Dict[str, Any]:
        now = get_utc_now_iso()
        resolved_status = status or ("completed" if (selected_outcome or prospect_exact_words or notes) else "completed")

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
                if status is not None:
                    update_payload["status"] = status
                try:
                    res = self.supabase_client.table("call_stage_results").update(update_payload).eq("id", result_id).execute()
                except Exception:
                    update_payload.pop("status", None)
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
                    "status": resolved_status,
                    "created_at": now,
                    "updated_at": now
                }
                try:
                    res = self.supabase_client.table("call_stage_results").insert(insert_payload).execute()
                except Exception:
                    insert_payload.pop("status", None)
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
                    status = COALESCE(?, status),
                    updated_at = ?
                WHERE id = ?
            """, (selected_outcome, prospect_exact_words, notes, status, now, result_id))
        else:
            result_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO call_stage_results (id, call_id, stage_number, selected_outcome, prospect_exact_words, notes, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (result_id, call_id, stage_number, selected_outcome, prospect_exact_words, notes, resolved_status, now, now))

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
                   follow_up_time: Optional[str] = None, follow_up_channel: Optional[str] = None,
                   referral_name: Optional[str] = None, referral_contact: Optional[str] = None,
                   objection: Optional[str] = None, prospect_statement: Optional[str] = None) -> Optional[Dict[str, Any]]:
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
            if referral_name is not None:
                update_payload["referral_name"] = referral_name
            if referral_contact is not None:
                update_payload["referral_contact"] = referral_contact
            if objection is not None:
                update_payload["objection"] = objection
            if prospect_statement is not None:
                update_payload["prospect_statement"] = prospect_statement
            try:
                self.supabase_client.table("calls").update(update_payload).eq("id", call_id).execute()
            except Exception:
                standard_payload = {
                    "status": "completed",
                    "final_outcome": final_outcome,
                    "next_action": next_action,
                    "follow_up_time": follow_up_time,
                    "follow_up_channel": follow_up_channel,
                    "ended_at": now,
                    "updated_at": now
                }
                self.supabase_client.table("calls").update(standard_payload).eq("id", call_id).execute()
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
                referral_name = ?,
                referral_contact = ?,
                objection = ?,
                prospect_statement = ?,
                ended_at = ?,
                updated_at = ?
            WHERE id = ?
        """, (final_outcome, next_action, follow_up_time, follow_up_channel,
              referral_name, referral_contact, objection, prospect_statement,
              now, now, call_id))
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
            try:
                res = (
                    self.supabase_client
                    .table("call_transcripts")
                    .select("*")
                    .eq("call_id", call_id)
                    .execute()
                )
                return self._format_transcript_dict(res.data[0]) if res.data else None
            except Exception:
                return None

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

    # ──────────────────────────────────────────────────────────────────────────
    # Commitment Radar: Commitments
    # ──────────────────────────────────────────────────────────────────────────

    def _format_commitment_dict(self, row: Dict[str, Any]) -> Dict[str, Any]:
        d = dict(row)
        if "needs_confirmation" in d:
            d["needs_confirmation"] = bool(d["needs_confirmation"])
        if "confidence" in d and d["confidence"] is not None:
            d["confidence"] = float(d["confidence"])
        return d

    def create_commitment(
        self,
        call_id: str,
        action: str,
        responsible_party: str = "unknown",
        commitment_status: str = "uncertain",
        due_at: Optional[str] = None,
        relative_due: Optional[str] = None,
        channel: str = "unknown",
        evidence_quote: str = "",
        confidence: float = 1.0,
        needs_confirmation: bool = False,
        status: str = "pending",
    ) -> Dict[str, Any]:
        rec_id = str(uuid.uuid4())
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            payload = {
                "id": rec_id,
                "call_id": call_id,
                "action": action.strip(),
                "responsible_party": responsible_party,
                "commitment_status": commitment_status,
                "due_at": due_at,
                "relative_due": relative_due,
                "channel": channel,
                "evidence_quote": evidence_quote.strip(),
                "confidence": confidence,
                "needs_confirmation": needs_confirmation,
                "status": status,
                "created_at": now,
                "updated_at": now,
            }
            try:
                res = self.supabase_client.table("call_commitments").insert(payload).execute()
                return self._format_commitment_dict(res.data[0])
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass  # Fallback to local SQLite
                else:
                    raise


        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM calls WHERE id = ?", (call_id,))
        if not cursor.fetchone():
            cursor.execute(
                "INSERT OR IGNORE INTO calls (id, company_name, started_at, created_at, updated_at) VALUES (?, 'Synced Call', ?, ?, ?)",
                (call_id, now, now, now)
            )
        cursor.execute("""
            INSERT INTO call_commitments (

                id, call_id, action, responsible_party, commitment_status,
                due_at, relative_due, channel, evidence_quote, confidence,
                needs_confirmation, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            rec_id, call_id, action.strip(), responsible_party, commitment_status,
            due_at, relative_due, channel, evidence_quote.strip(), confidence,
            1 if needs_confirmation else 0, status, now, now
        ))
        conn.commit()
        cursor.execute("SELECT * FROM call_commitments WHERE id = ?", (rec_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_commitment_dict(dict(row))

    def list_all_commitments(self) -> List[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_commitments")
                    .select("*")
                    .order("created_at", desc=True)
                    .execute()
                )
                return [self._format_commitment_dict(r) for r in (res.data or [])]
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM call_commitments ORDER BY created_at DESC")
        rows = cursor.fetchall()
        conn.close()
        return [self._format_commitment_dict(dict(r)) for r in rows]

    def list_commitments(self, call_id: str) -> List[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_commitments")
                    .select("*")
                    .eq("call_id", call_id)
                    .order("created_at")
                    .execute()
                )
                return [self._format_commitment_dict(r) for r in (res.data or [])]
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM call_commitments WHERE call_id = ? ORDER BY created_at ASC",
            (call_id,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [self._format_commitment_dict(dict(r)) for r in rows]

    def get_commitment(self, commitment_id: str) -> Optional[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_commitments")
                    .select("*")
                    .eq("id", commitment_id)
                    .execute()
                )
                return self._format_commitment_dict(res.data[0]) if res.data else None
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM call_commitments WHERE id = ?", (commitment_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_commitment_dict(dict(row)) if row else None

    def update_commitment(
        self, commitment_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        now = get_utc_now_iso()
        valid_fields = {
            "action", "responsible_party", "commitment_status", "due_at",
            "relative_due", "channel", "confidence", "needs_confirmation", "status"
        }
        filtered = {k: v for k, v in updates.items() if k in valid_fields}
        filtered["updated_at"] = now

        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_commitments")
                    .update(filtered)
                    .eq("id", commitment_id)
                    .execute()
                )
                return self._format_commitment_dict(res.data[0]) if res.data else None
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        set_clause = ", ".join(f"{k} = ?" for k in filtered.keys())
        values = []
        for k in filtered.keys():
            v = filtered[k]
            if k == "needs_confirmation":
                v = 1 if v else 0
            values.append(v)
        values.append(commitment_id)

        cursor.execute(f"UPDATE call_commitments SET {set_clause} WHERE id = ?", tuple(values))
        conn.commit()
        cursor.execute("SELECT * FROM call_commitments WHERE id = ?", (commitment_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_commitment_dict(dict(row)) if row else None

    def delete_commitment(self, commitment_id: str) -> bool:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_commitments")
                    .delete()
                    .eq("id", commitment_id)
                    .execute()
                )
                return bool(res.data)
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM call_commitments WHERE id = ?", (commitment_id,))
        rc = cursor.rowcount
        conn.commit()
        conn.close()
        return rc > 0

    def upsert_commitments_batch(
        self, call_id: str, candidate_commitments: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Idempotently store candidate commitments extracted from transcript.
        If a commitment with the same evidence_quote (trimmed) already exists:
        - We keep the existing status (confirm/dismiss/complete are preserved).
        - We update details only if still pending.
        If it's new, we insert it.
        """
        existing = self.list_commitments(call_id)
        existing_by_quote = {
            c["evidence_quote"].strip().lower(): c for c in existing if c.get("evidence_quote")
        }

        def find_existing_commitment(cand):
            q = cand.get("evidence_quote", "").strip().lower()
            if q and q in existing_by_quote:
                return existing_by_quote[q]
            cand_act = cand.get("action", "").strip().lower()
            cand_rel = (cand.get("relative_due") or "").strip().lower()
            for ex in existing:
                ex_q = (ex.get("evidence_quote") or "").strip().lower()
                ex_act = (ex.get("action") or "").strip().lower()
                ex_rel = (ex.get("relative_due") or "").strip().lower()
                if q and ex_q and (q in ex_q or ex_q in q):
                    return ex
                if cand_act and ex_act and (cand_act == ex_act or (cand_rel and cand_rel == ex_rel and "call" in cand_act and "call" in ex_act)):
                    return ex
            return None

        results = []
        for cand in candidate_commitments:
            quote_key = cand.get("evidence_quote", "").strip().lower()
            curr = find_existing_commitment(cand)
            if curr:
                # Existing commitment: preserve manual status
                # If still pending, refresh extracted metadata (timing, channel, action)
                if curr.get("status") == "pending":
                    upd = {
                        "action": cand.get("action", curr["action"]),
                        "responsible_party": cand.get("responsible_party", curr["responsible_party"]),
                        "commitment_status": cand.get("commitment_status", curr["commitment_status"]),
                        "due_at": cand.get("due_at", curr.get("due_at")),
                        "relative_due": cand.get("relative_due", curr.get("relative_due")),
                        "channel": cand.get("channel", curr["channel"]),
                        "confidence": cand.get("confidence", curr["confidence"]),
                        "needs_confirmation": cand.get("needs_confirmation", curr["needs_confirmation"]),
                    }
                    updated_item = self.update_commitment(curr["id"], upd)
                    results.append(updated_item or curr)
                else:
                    results.append(curr)
            else:
                # New commitment: insert
                inserted = self.create_commitment(
                    call_id=call_id,
                    action=cand.get("action", ""),
                    responsible_party=cand.get("responsible_party", "unknown"),
                    commitment_status=cand.get("commitment_status", "uncertain"),
                    due_at=cand.get("due_at"),
                    relative_due=cand.get("relative_due"),
                    channel=cand.get("channel", "unknown"),
                    evidence_quote=cand.get("evidence_quote", ""),
                    confidence=cand.get("confidence", 1.0),
                    needs_confirmation=cand.get("needs_confirmation", False),
                    status=cand.get("status", "pending"),
                )
                results.append(inserted)
                existing.append(inserted)
                if quote_key:
                    existing_by_quote[quote_key] = inserted

        return self.list_commitments(call_id)

    # ──────────────────────────────────────────────────────────────────────────
    # Commitment Radar: Missed Opportunities
    # ──────────────────────────────────────────────────────────────────────────

    def _format_missed_opportunity_dict(self, row: Dict[str, Any]) -> Dict[str, Any]:
        d = dict(row)
        if "needs_confirmation" in d:
            d["needs_confirmation"] = bool(d["needs_confirmation"])
        if "confidence" in d and d["confidence"] is not None:
            d["confidence"] = float(d["confidence"])
        return d

    def create_missed_opportunity(
        self,
        call_id: str,
        type: str,
        severity: str = "medium",
        description: str = "",
        evidence_quote: str = "",
        why_it_matters: str = "",
        suggested_action: str = "",
        confidence: float = 1.0,
        needs_confirmation: bool = False,
        status: str = "pending",
    ) -> Dict[str, Any]:
        rec_id = str(uuid.uuid4())
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            payload = {
                "id": rec_id,
                "call_id": call_id,
                "type": type,
                "severity": severity,
                "description": description.strip(),
                "evidence_quote": evidence_quote.strip(),
                "why_it_matters": why_it_matters.strip(),
                "suggested_action": suggested_action.strip(),
                "confidence": confidence,
                "needs_confirmation": needs_confirmation,
                "status": status,
                "created_at": now,
                "updated_at": now,
            }
            try:
                res = self.supabase_client.table("call_missed_opportunities").insert(payload).execute()
                return self._format_missed_opportunity_dict(res.data[0])
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM calls WHERE id = ?", (call_id,))
        if not cursor.fetchone():
            cursor.execute(
                "INSERT OR IGNORE INTO calls (id, company_name, started_at, created_at, updated_at) VALUES (?, 'Synced Call', ?, ?, ?)",
                (call_id, now, now, now)
            )
        cursor.execute("""
            INSERT INTO call_missed_opportunities (

                id, call_id, type, severity, description, evidence_quote,
                why_it_matters, suggested_action, confidence, needs_confirmation,
                status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            rec_id, call_id, type, severity, description.strip(), evidence_quote.strip(),
            why_it_matters.strip(), suggested_action.strip(), confidence,
            1 if needs_confirmation else 0, status, now, now
        ))
        conn.commit()
        cursor.execute("SELECT * FROM call_missed_opportunities WHERE id = ?", (rec_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_missed_opportunity_dict(dict(row))

    def list_missed_opportunities(self, call_id: str) -> List[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_missed_opportunities")
                    .select("*")
                    .eq("call_id", call_id)
                    .order("created_at")
                    .execute()
                )
                return [self._format_missed_opportunity_dict(r) for r in (res.data or [])]
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM call_missed_opportunities WHERE call_id = ? ORDER BY created_at ASC",
            (call_id,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [self._format_missed_opportunity_dict(dict(r)) for r in rows]

    def get_missed_opportunity(self, opportunity_id: str) -> Optional[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_missed_opportunities")
                    .select("*")
                    .eq("id", opportunity_id)
                    .execute()
                )
                return self._format_missed_opportunity_dict(res.data[0]) if res.data else None
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM call_missed_opportunities WHERE id = ?", (opportunity_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_missed_opportunity_dict(dict(row)) if row else None

    def update_missed_opportunity(
        self, opportunity_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        now = get_utc_now_iso()
        valid_fields = {
            "severity", "description", "suggested_action", "confidence",
            "needs_confirmation", "status"
        }
        filtered = {k: v for k, v in updates.items() if k in valid_fields}
        filtered["updated_at"] = now

        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_missed_opportunities")
                    .update(filtered)
                    .eq("id", opportunity_id)
                    .execute()
                )
                return self._format_missed_opportunity_dict(res.data[0]) if res.data else None
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        set_clause = ", ".join(f"{k} = ?" for k in filtered.keys())
        values = []
        for k in filtered.keys():
            v = filtered[k]
            if k == "needs_confirmation":
                v = 1 if v else 0
            values.append(v)
        values.append(opportunity_id)

        cursor.execute(f"UPDATE call_missed_opportunities SET {set_clause} WHERE id = ?", tuple(values))
        conn.commit()
        cursor.execute("SELECT * FROM call_missed_opportunities WHERE id = ?", (opportunity_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_missed_opportunity_dict(dict(row)) if row else None

    def delete_missed_opportunity(self, opportunity_id: str) -> bool:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_missed_opportunities")
                    .delete()
                    .eq("id", opportunity_id)
                    .execute()
                )
                return bool(res.data)
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM call_missed_opportunities WHERE id = ?", (opportunity_id,))
        rc = cursor.rowcount
        conn.commit()
        conn.close()
        return rc > 0

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM call_missed_opportunities WHERE id = ?", (opportunity_id,))
        rc = cursor.rowcount
        conn.commit()
        conn.close()
        return rc > 0

    def upsert_missed_opportunities_batch(
        self, call_id: str, candidate_opportunities: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Idempotently store candidate missed opportunities.
        Preserves user dismiss/confirm actions across repeated analysis.
        """
        existing = self.list_missed_opportunities(call_id)
        existing_by_key = {
            (o["type"], o["evidence_quote"].strip().lower()): o for o in existing
        }

        results = []
        for cand in candidate_opportunities:
            key = (cand.get("type", ""), cand.get("evidence_quote", "").strip().lower())
            if key in existing_by_key:
                curr = existing_by_key[key]
                if curr.get("status") == "pending":
                    upd = {
                        "severity": cand.get("severity", curr["severity"]),
                        "description": cand.get("description", curr["description"]),
                        "suggested_action": cand.get("suggested_action", curr["suggested_action"]),
                        "confidence": cand.get("confidence", curr["confidence"]),
                        "needs_confirmation": cand.get("needs_confirmation", curr["needs_confirmation"]),
                    }
                    updated_item = self.update_missed_opportunity(curr["id"], upd)
                    results.append(updated_item or curr)
                else:
                    results.append(curr)
            else:
                inserted = self.create_missed_opportunity(
                    call_id=call_id,
                    type=cand.get("type", "other"),
                    severity=cand.get("severity", "medium"),
                    description=cand.get("description", ""),
                    evidence_quote=cand.get("evidence_quote", ""),
                    why_it_matters=cand.get("why_it_matters", ""),
                    suggested_action=cand.get("suggested_action", ""),
                    confidence=cand.get("confidence", 1.0),
                    needs_confirmation=cand.get("needs_confirmation", False),
                    status=cand.get("status", "pending"),
                )
                results.append(inserted)
                existing_by_key[key] = inserted

        return self.list_missed_opportunities(call_id)

    # ──────────────────────────────────────────────────────────────────────────
    # Conversation Gap Detector: call_conversation_gaps
    # ──────────────────────────────────────────────────────────────────────────

    def _format_conversation_gap_dict(self, row: Dict[str, Any]) -> Dict[str, Any]:
        d = dict(row)
        if "confidence" in d and d["confidence"] is not None:
            d["confidence"] = float(d["confidence"])
        return d

    def create_conversation_gap(
        self,
        call_id: str,
        type: str,
        title: str,
        description: str,
        evidence_quote: str,
        why_it_matters: str,
        suggested_action: str,
        context_quote: Optional[str] = None,
        severity: str = "medium",
        confidence: float = 1.0,
        status: str = "open",
        commitment_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        rec_id = str(uuid.uuid4())
        now = get_utc_now_iso()

        if self.use_supabase and self.supabase_client:
            payload = {
                "id": rec_id,
                "call_id": call_id,
                "type": type,
                "severity": severity,
                "title": title.strip(),
                "description": description.strip(),
                "evidence_quote": evidence_quote.strip(),
                "context_quote": context_quote.strip() if context_quote else None,
                "why_it_matters": why_it_matters.strip(),
                "suggested_action": suggested_action.strip(),
                "confidence": confidence,
                "status": status,
                "commitment_id": commitment_id,
                "created_at": now,
                "updated_at": now,
            }
            try:
                res = self.supabase_client.table("call_conversation_gaps").insert(payload).execute()
                return self._format_conversation_gap_dict(res.data[0])
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass  # Fallback to local SQLite
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM calls WHERE id = ?", (call_id,))
        if not cursor.fetchone():
            cursor.execute(
                "INSERT OR IGNORE INTO calls (id, company_name, started_at, created_at, updated_at) VALUES (?, 'Synced Call', ?, ?, ?)",
                (call_id, now, now, now)
            )
        cursor.execute("""
            INSERT INTO call_conversation_gaps (
                id, call_id, type, severity, title, description, evidence_quote,
                context_quote, why_it_matters, suggested_action, confidence,
                status, commitment_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            rec_id, call_id, type, severity, title.strip(), description.strip(),
            evidence_quote.strip(), context_quote.strip() if context_quote else None,
            why_it_matters.strip(), suggested_action.strip(), confidence,
            status, commitment_id, now, now
        ))
        conn.commit()
        cursor.execute("SELECT * FROM call_conversation_gaps WHERE id = ?", (rec_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_conversation_gap_dict(dict(row))

    def list_conversation_gaps(self, call_id: str) -> List[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_conversation_gaps")
                    .select("*")
                    .eq("call_id", call_id)
                    .order("created_at")
                    .execute()
                )
                return [self._format_conversation_gap_dict(r) for r in (res.data or [])]
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM call_conversation_gaps WHERE call_id = ? ORDER BY created_at ASC",
            (call_id,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [self._format_conversation_gap_dict(dict(r)) for r in rows]

    def get_conversation_gap(self, gap_id: str) -> Optional[Dict[str, Any]]:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_conversation_gaps")
                    .select("*")
                    .eq("id", gap_id)
                    .execute()
                )
                return self._format_conversation_gap_dict(res.data[0]) if res.data else None
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM call_conversation_gaps WHERE id = ?", (gap_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_conversation_gap_dict(dict(row)) if row else None

    def update_conversation_gap(
        self, gap_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        now = get_utc_now_iso()
        valid_fields = {
            "type", "severity", "title", "description", "why_it_matters",
            "suggested_action", "confidence", "status", "commitment_id", "context_quote"
        }
        filtered = {k: v for k, v in updates.items() if k in valid_fields}
        filtered["updated_at"] = now

        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_conversation_gaps")
                    .update(filtered)
                    .eq("id", gap_id)
                    .execute()
                )
                return self._format_conversation_gap_dict(res.data[0]) if res.data else None
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        set_clause = ", ".join(f"{k} = ?" for k in filtered.keys())
        values = list(filtered.values())
        values.append(gap_id)

        cursor.execute(f"UPDATE call_conversation_gaps SET {set_clause} WHERE id = ?", tuple(values))
        conn.commit()
        cursor.execute("SELECT * FROM call_conversation_gaps WHERE id = ?", (gap_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_conversation_gap_dict(dict(row)) if row else None

    def delete_conversation_gap(self, gap_id: str) -> bool:
        if self.use_supabase and self.supabase_client:
            try:
                res = (
                    self.supabase_client
                    .table("call_conversation_gaps")
                    .delete()
                    .eq("id", gap_id)
                    .execute()
                )
                return bool(res.data)
            except Exception as exc:
                if "PGRST205" in str(exc) or "not find the table" in str(exc):
                    pass
                else:
                    raise

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM call_conversation_gaps WHERE id = ?", (gap_id,))
        rc = cursor.rowcount
        conn.commit()
        conn.close()
        return rc > 0

    def upsert_conversation_gaps_batch(
        self, call_id: str, candidate_gaps: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Idempotently store candidate conversation gaps.
        Preserves user dismiss/resolve actions and linked commitments across repeated analysis.
        """
        existing = self.list_conversation_gaps(call_id)
        existing_by_key = {
            (g["type"], g["evidence_quote"].strip().lower()): g for g in existing
        }

        results = []
        for cand in candidate_gaps:
            key = (cand.get("type", ""), cand.get("evidence_quote", "").strip().lower())
            if key in existing_by_key:
                curr = existing_by_key[key]
                if curr.get("status") == "open":
                    upd = {
                        "severity": cand.get("severity", curr["severity"]),
                        "title": cand.get("title", curr["title"]),
                        "description": cand.get("description", curr["description"]),
                        "why_it_matters": cand.get("why_it_matters", curr["why_it_matters"]),
                        "suggested_action": cand.get("suggested_action", curr["suggested_action"]),
                        "confidence": cand.get("confidence", curr["confidence"]),
                        "context_quote": cand.get("context_quote", curr.get("context_quote")),
                    }
                    updated_item = self.update_conversation_gap(curr["id"], upd)
                    results.append(updated_item or curr)
                else:
                    # User resolved or dismissed: preserve status
                    results.append(curr)
            else:
                inserted = self.create_conversation_gap(
                    call_id=call_id,
                    type=cand.get("type", "missed_discovery"),
                    severity=cand.get("severity", "medium"),
                    title=cand.get("title", "Conversation Gap"),
                    description=cand.get("description", ""),
                    evidence_quote=cand.get("evidence_quote", ""),
                    context_quote=cand.get("context_quote"),
                    why_it_matters=cand.get("why_it_matters", ""),
                    suggested_action=cand.get("suggested_action", ""),
                    confidence=cand.get("confidence", 1.0),
                    status=cand.get("status", "open"),
                    commitment_id=cand.get("commitment_id"),
                )
                results.append(inserted)
                existing_by_key[key] = inserted

        return self.list_conversation_gaps(call_id)

    # ──────────────────────────────────────────────────────────────────────────
    # Prospects
    # ──────────────────────────────────────────────────────────────────────────

    def _format_prospect_dict(self, row: Dict[str, Any]) -> Dict[str, Any]:
        d = dict(row)
        if "is_custom" in d:
            d["is_custom"] = bool(d["is_custom"])
        return d

    def list_prospects(self, search: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all prospects, seeded and custom, sorted alphabetically by company name."""
        # Ensure prospects are seeded in SQLite and Supabase (if table exists)
        self._ensure_prospects_seeded()

        if self.use_supabase and self.supabase_client:
            try:
                query = self.supabase_client.table("prospects").select("*").order("company_name")
                if search and search.strip():
                    term = search.strip()
                    query = query.or_(f"company_name.ilike.%{term}%,contact_name.ilike.%{term}%,context.ilike.%{term}%")
                res = query.execute()
                if res.data is not None and (len(res.data) > 0 or (search and search.strip())):
                    return [self._format_prospect_dict(r) for r in res.data]
            except Exception as exc:
                # Fallback to local SQLite if table does not exist or network fails
                pass

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        query = "SELECT * FROM prospects WHERE 1=1"
        params: List[Any] = []
        if search and search.strip():
            term = f"%{search.strip()}%"
            query += " AND (company_name LIKE ? OR contact_name LIKE ? OR context LIKE ?)"
            params.extend([term, term, term])
        query += " ORDER BY company_name COLLATE NOCASE ASC"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()
        return [self._format_prospect_dict(dict(r)) for r in rows]

    def get_prospect(self, prospect_id: str) -> Optional[Dict[str, Any]]:
        """Find a prospect by ID."""
        clean_id = str(prospect_id).strip()
        if not clean_id:
            return None

        self._ensure_prospects_seeded()

        if self.use_supabase and self.supabase_client:
            try:
                res = self.supabase_client.table("prospects").select("*").eq("id", clean_id).execute()
                if res.data:
                    return self._format_prospect_dict(res.data[0])
            except Exception:
                pass

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM prospects WHERE id = ?", (clean_id,))
        row = cursor.fetchone()
        conn.close()
        return self._format_prospect_dict(dict(row)) if row else None

    def get_prospect_by_company(self, company_name: str) -> Optional[Dict[str, Any]]:
        """Find a prospect by company name (case-insensitive)."""
        clean = company_name.strip().lower()
        if not clean:
            return None

        self._ensure_prospects_seeded()

        if self.use_supabase and self.supabase_client:
            try:
                res = self.supabase_client.table("prospects").select("*").ilike("company_name", clean).execute()
                if res.data:
                    return self._format_prospect_dict(res.data[0])
            except Exception:
                pass

        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM prospects WHERE LOWER(TRIM(company_name)) = ?", (clean,))
        row = cursor.fetchone()
        conn.close()
        return self._format_prospect_dict(dict(row)) if row else None

    def create_prospect(
        self,
        company_name: str,
        contact_name: Optional[str] = None,
        phone_number: Optional[str] = None,
        context: Optional[str] = None,
        is_custom: bool = True,
        custom_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new prospect. Raises ValueError if duplicate company name."""
        company_clean = company_name.strip()
        existing = self.get_prospect_by_company(company_clean)
        if existing:
            raise ValueError(f"Prospect company '{company_clean}' already exists.")

        rec_id = custom_id or str(uuid.uuid4())
        now = get_utc_now_iso()

        payload = {
            "id": rec_id,
            "company_name": company_clean,
            "contact_name": contact_name.strip() if contact_name else None,
            "phone_number": phone_number.strip() if phone_number else None,
            "context": context.strip() if context else None,
            "is_custom": is_custom,
            "created_at": now,
            "updated_at": now,
        }

        # Save to Supabase if available
        if self.use_supabase and self.supabase_client:
            try:
                res = self.supabase_client.table("prospects").insert(payload).execute()
                # Also mirror into local SQLite
                self._insert_prospect_sqlite(payload)
                return self._format_prospect_dict(res.data[0])
            except Exception as exc:
                if "duplicate key" in str(exc).lower() or "unique constraint" in str(exc).lower():
                    raise ValueError(f"Prospect company '{company_clean}' already exists.")
                # Fallback to local SQLite if table does not exist
                pass

        # Save into SQLite
        self._insert_prospect_sqlite(payload)
        return self._format_prospect_dict(payload)

    def _insert_prospect_sqlite(self, payload: Dict[str, Any]):
        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO prospects (id, company_name, contact_name, phone_number, context, is_custom, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            payload["id"],
            payload["company_name"],
            payload["contact_name"],
            payload["phone_number"],
            payload["context"],
            1 if payload.get("is_custom") else 0,
            payload["created_at"],
            payload["updated_at"],
        ))
        conn.commit()
        conn.close()

    def _ensure_prospects_seeded(self):
        """Seed initial prospects from JSON/transcripts into SQLite and Supabase if empty."""
        conn = self.get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM prospects")
        sqlite_count = cursor.fetchone()[0]

        import os
        seed_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "cold-call-transcripts-100",
            "prospects_seed.json"
        )
        seeds = []
        if os.path.exists(seed_file):
            with open(seed_file, "r", encoding="utf-8") as f:
                seeds = json.load(f)

        now = get_utc_now_iso()

        if sqlite_count == 0 and seeds:
            for s in seeds:
                cursor.execute("""
                    INSERT OR IGNORE INTO prospects (id, company_name, contact_name, phone_number, context, is_custom, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                """, (
                    s["id"],
                    s["company_name"],
                    s.get("contact_name"),
                    s.get("phone_number"),
                    s.get("context"),
                    now,
                    now,
                ))
            conn.commit()
        conn.close()

        # Check and seed Supabase table if it exists and has 0 rows
        if self.use_supabase and self.supabase_client and seeds:
            try:
                chk = self.supabase_client.table("prospects").select("id", count="exact").limit(1).execute()
                if chk.count == 0:
                    batch = [
                        {
                            "id": s["id"],
                            "company_name": s["company_name"],
                            "contact_name": s.get("contact_name"),
                            "phone_number": s.get("phone_number"),
                            "context": s.get("context"),
                            "is_custom": False,
                            "created_at": now,
                            "updated_at": now,
                        }
                        for s in seeds
                    ]
                    for i in range(0, len(batch), 50):
                        self.supabase_client.table("prospects").upsert(batch[i:i + 50]).execute()
            except Exception:
                pass


db = DatabaseAdapter()

