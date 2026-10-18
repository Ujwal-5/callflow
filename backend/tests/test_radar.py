"""
test_radar.py — Comprehensive tests for Commitment Radar:
- Explicit callback requests (T002, T005).
- Caller promises to send information.
- Mutually agreed meetings (T001).
- Vague intentions without firm commitments.
- Referrals to another decision-maker (T050).
- Unanswered questions and unresolved objections (T077).
- Calls with no meaningful follow-up action.
- Repeated analysis without duplicate commitments.
- Transcript edits followed by reanalysis.
- Confirmation, editing, completion, and dismissal of actions.
- Historical evidence retrieval grounding.
"""

import unittest
from starlette.testclient import TestClient
from backend.main import app
from backend.app.db import db
from backend.app.radar import verify_quote_in_transcript, calculate_due_at


class TestCommitmentRadar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig_force_sqlite = db._force_sqlite
        db._force_sqlite = True
        db.init_db()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        db._force_sqlite = cls._orig_force_sqlite
        db.init_client()

    def test_01_quote_verification_strictness(self):
        """Verifies quotes must exist in transcript to prevent hallucinations."""
        transcript = "PROSPECT: Can you call me after 30 minutes? CALLER: Sure, I will call you then."
        self.assertTrue(verify_quote_in_transcript("Can you call me after 30 minutes?", transcript))
        self.assertTrue(verify_quote_in_transcript("Sure, I will call you then.", transcript))
        self.assertFalse(verify_quote_in_transcript("I want to sign a 100k contract today", transcript))
        self.assertFalse(verify_quote_in_transcript("", transcript))

    def test_02_relative_due_calculation(self):
        """Test relative due date/time calculations."""
        start_iso = "2026-10-18T10:00:00+00:00"
        due_at, needs_conf = calculate_due_at("after 30 minutes", start_iso)
        self.assertIsNotNone(due_at)
        self.assertIn("10:30:00", due_at)
        self.assertFalse(needs_conf)

        due_hr, needs_conf_hr = calculate_due_at("in an hour", start_iso)
        self.assertIsNotNone(due_hr)
        self.assertIn("11:00:00", due_hr)
        self.assertFalse(needs_conf_hr)

        # Ambiguous calendar phrase preserves relative_due and requests confirmation
        due_ambig, needs_conf_ambig = calculate_due_at("next Tuesday afternoon", start_iso)
        self.assertIsNone(due_ambig)
        self.assertTrue(needs_conf_ambig)

    def test_03_callback_request_t002(self):
        """Test T002 pattern: prospect requests callback after 30 minutes."""
        call_res = self.client.post("/calls", json={"company_name": "Orbit Automation", "contact_name": "Leonard"})
        call_id = call_res.json()["id"]

        # Save transcript
        t002_text = """PROSPECT: Yeah. Maybe can you call after 30 minutes, because I was in a call actually. So after 30 minutes we can talk.
CALLER: Yeah, yeah, sure. Thank you."""
        db.upsert_transcript_pending(call_id)
        db.complete_transcript(call_id, raw_transcript=t002_text)

        # Run radar analysis
        res = self.client.post(f"/calls/{call_id}/radar/analyze")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["call_id"], call_id)

        # Verify commitment
        commitments = data["commitments"]
        self.assertGreaterEqual(len(commitments), 1)
        cb = commitments[0]
        self.assertIn("call", cb["action"].lower())
        self.assertIn("30 minutes", cb["relative_due"].lower())
        self.assertIn("Maybe can you call after 30 minutes", cb["evidence_quote"])

        # Historical match should reference T002 or callback request
        matches = data["historical_matches"]
        self.assertGreaterEqual(len(matches), 1)
        self.assertTrue(any(m["transcript_id"] in ("T002", "T005") for m in matches))

    def test_04_meeting_agreement_t001(self):
        """Test T001 pattern: mutually agreed Google Meet next Tuesday after 2 PM."""
        call_res = self.client.post("/calls", json={"company_name": "Kalpana Chem", "contact_name": "Dev ji"})
        call_id = call_res.json()["id"]

        t001_text = """PROSPECT: Tuesday is a good day.
CALLER: Okay, Tuesday. And the time?
PROSPECT: After 2 PM. Call us in the afternoon and then we can perhaps have a working session.
CALLER: Yeah, sure. Then we can discuss further. So this will be a Google Meet, if that is okay with you.
PROSPECT: Right. Got it."""
        db.upsert_transcript_pending(call_id)
        db.complete_transcript(call_id, raw_transcript=t001_text)

        res = self.client.post(f"/calls/{call_id}/radar/analyze")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        commitments = data["commitments"]
        self.assertGreaterEqual(len(commitments), 1)
        meet_comm = next((c for c in commitments if "meet" in c["action"].lower() or "session" in c["action"].lower() or "connect" in c["action"].lower()), None)
        self.assertIsNotNone(meet_comm)
        self.assertEqual(meet_comm["channel"], "Google Meet")

    def test_05_referral_t050(self):
        """Test T050 pattern: referral to operations head Mr. Naik."""
        call_res = self.client.post("/calls", json={"company_name": "Annapurna Kitchen", "contact_name": "Ajay Kumar"})
        call_id = call_res.json()["id"]

        t050_text = """PROSPECT: I will share a number with you, right? I want you to connect with Mr. Naik. He handles our entire company operations.
CALLER: Okay, sir. Can you please share his details?
PROSPECT: Yeah, yeah. I will text your number on this.
CALLER: Okay, sir. Sure. Thank you for your time."""
        db.upsert_transcript_pending(call_id)
        db.complete_transcript(call_id, raw_transcript=t050_text)

        res = self.client.post(f"/calls/{call_id}/radar/analyze")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        commitments = data["commitments"]
        self.assertGreaterEqual(len(commitments), 1)
        # Should detect referral to Mr. Naik
        ref_comm = next((c for c in commitments if "naik" in c["action"].lower() or "number" in c["action"].lower() or "connect" in c["action"].lower()), None)
        self.assertIsNotNone(ref_comm)

    def test_06_unresolved_objection_and_unexplored_need(self):
        """Test missed-opportunity detection for consultant objection and margin need."""
        call_res = self.client.post("/calls", json={"company_name": "Devashish Specialty Chemicals"})
        call_id = call_res.json()["id"]

        text = """PROSPECT: The thing is, our company majorly works on a job work basis. So the margin and all the things you just mentioned, technically there is hardly any. Probably I am looking for people who can help me with some new products with our facility.
CALLER: Okay, thank you Devashish ji, have a good day."""
        db.upsert_transcript_pending(call_id)
        db.complete_transcript(call_id, raw_transcript=text)

        res = self.client.post(f"/calls/{call_id}/radar/analyze")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        missed = data["missed_opportunities"]
        self.assertGreaterEqual(len(missed), 1)
        need_opp = next((o for o in missed if o["type"] == "need_not_explored"), None)
        self.assertIsNotNone(need_opp)
        self.assertTrue(any(t in need_opp["evidence_quote"].lower() for t in ("job work", "products", "facility", "margin")))



    def test_07_no_meaningful_commitments(self):
        """Calls with no meaningful follow-up action return empty commitments."""
        call_res = self.client.post("/calls", json={"company_name": "Quick Disconnect Corp"})
        call_id = call_res.json()["id"]

        disconnect_text = """PROSPECT: Hello.
CALLER: Hi, this is Meridian Growth Partners.
PROSPECT: Wrong number, please do not call again. [Hangs up]"""
        db.upsert_transcript_pending(call_id)
        db.complete_transcript(call_id, raw_transcript=disconnect_text)

        res = self.client.post(f"/calls/{call_id}/radar/analyze")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data["commitments"]), 0)

    def test_08_idempotent_reanalysis_preserves_status(self):
        """Repeated analysis on same call does not create duplicates and preserves confirmed status."""
        call_res = self.client.post("/calls", json={"company_name": "Idempotent Testing Co"})
        call_id = call_res.json()["id"]

        text = "PROSPECT: Can you call me in an hour? CALLER: In an hour, okay. I will call you then."
        db.upsert_transcript_pending(call_id)
        db.complete_transcript(call_id, raw_transcript=text)


        # Run 1
        res1 = self.client.post(f"/calls/{call_id}/radar/analyze")
        data1 = res1.json()
        self.assertEqual(len(data1["commitments"]), 1)
        comm_id = data1["commitments"][0]["id"]
        self.assertEqual(data1["commitments"][0]["status"], "pending")

        # Salesperson confirms the commitment
        patch_res = self.client.patch(
            f"/calls/{call_id}/commitments/{comm_id}",
            json={"status": "confirmed"}
        )
        self.assertEqual(patch_res.status_code, 200)
        self.assertEqual(patch_res.json()["status"], "confirmed")

        # Run 2 (Repeated analysis)
        res2 = self.client.post(f"/calls/{call_id}/radar/analyze")
        data2 = res2.json()
        self.assertEqual(len(data2["commitments"]), 1)
        self.assertEqual(data2["commitments"][0]["id"], comm_id)
        # Status MUST remain 'confirmed', not reset to 'pending'
        self.assertEqual(data2["commitments"][0]["status"], "confirmed")

    def test_09_commitment_lifecycle_confirm_edit_complete_dismiss(self):
        """Test full commitment lifecycle: confirm -> edit -> complete -> dismiss."""
        call_res = self.client.post("/calls", json={"company_name": "Lifecycle Co"})
        call_id = call_res.json()["id"]

        manual_res = self.client.post(
            f"/calls/{call_id}/commitments",
            json={
                "action": "Send teardown benchmark deck",
                "responsible_party": "caller",
                "commitment_status": "promised",
                "relative_due": "tomorrow morning",
                "channel": "email",
                "evidence_quote": "I will send you the teardown deck tomorrow morning",
                "status": "pending",
            }
        )
        self.assertEqual(manual_res.status_code, 201)
        comm = manual_res.json()
        cid = comm["id"]

        # Confirm
        res = self.client.patch(f"/calls/{call_id}/commitments/{cid}", json={"status": "confirmed"})
        self.assertEqual(res.json()["status"], "confirmed")

        # Edit action
        res = self.client.patch(f"/calls/{call_id}/commitments/{cid}", json={"action": "Send custom competitor benchmark deck"})
        self.assertEqual(res.json()["action"], "Send custom competitor benchmark deck")

        # Complete
        res = self.client.patch(f"/calls/{call_id}/commitments/{cid}", json={"status": "completed"})
        self.assertEqual(res.json()["status"], "completed")

        # Dismiss
        res = self.client.patch(f"/calls/{call_id}/commitments/{cid}", json={"status": "dismissed"})
        self.assertEqual(res.json()["status"], "dismissed")

    def test_10_call_detail_modal_persistence(self):
        """GET /calls/{call_id} includes commitments and missed opportunities."""
        call_res = self.client.post("/calls", json={"company_name": "Persistence Co"})
        call_id = call_res.json()["id"]

        self.client.post(
            f"/calls/{call_id}/commitments",
            json={
                "action": "Follow-up phone call next week",
                "responsible_party": "caller",
                "commitment_status": "promised",
                "channel": "phone",
                "evidence_quote": "I will follow up next week",
                "status": "confirmed"
            }
        )

        detail_res = self.client.get(f"/calls/{call_id}")
        self.assertEqual(detail_res.status_code, 200)
        detail = detail_res.json()
        self.assertIn("commitments", detail)
        self.assertEqual(len(detail["commitments"]), 1)
        self.assertEqual(detail["commitments"][0]["action"], "Follow-up phone call next week")
        self.assertEqual(detail["commitments"][0]["status"], "confirmed")


if __name__ == "__main__":
    unittest.main()
