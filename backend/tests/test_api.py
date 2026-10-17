import os
import unittest
from starlette.testclient import TestClient
from backend.main import app
from backend.app.db import db


class TestCallFlowAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.init_db()
        cls.client = TestClient(app)

    def test_01_health_check(self):
        """Test GET /health returns HTTP 200 with service status."""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "callflow-api")
        self.assertIn("database_mode", data)
        self.assertIn("gemini_configured", data)

    def test_02_stages_order_and_content(self):
        """Test GET /stages returns all 8 stages in exact numerical order."""
        response = self.client.get("/stages")
        self.assertEqual(response.status_code, 200)
        stages = response.json()
        self.assertEqual(len(stages), 8)

        expected_names = [
            "Opening",
            "Purpose",
            "Permission",
            "Their business",
            "Their need, in their words",
            "Objection",
            "Next step",
            "Close",
        ]
        for idx, stage in enumerate(stages):
            self.assertEqual(stage["stage_number"], idx + 1)
            self.assertEqual(stage["name"], expected_names[idx])
            self.assertTrue(len(stage["purpose"]) > 5)
            self.assertEqual(len(stage["outcome_options"]), 4)
            self.assertTrue(len(stage["common_responses"]) >= 3)

        # Stage 5 should flag prominent exact words
        self.assertTrue(stages[4]["has_exact_words_prominent"])

    def test_03_create_call_success_and_validation(self):
        """Test POST /calls creates a new call session and validates required inputs."""
        # Success creation
        payload = {
            "company_name": "Test Kalpana Chem",
            "contact_name": "Dev Sharma",
            "phone_number": "+91 98765 43210",
            "context": "Lead from website inbound",
        }
        response = self.client.post("/calls", json=payload)
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertIn("id", data)
        self.assertEqual(data["company_name"], "Test Kalpana Chem")
        self.assertEqual(data["contact_name"], "Dev Sharma")
        self.assertEqual(data["status"], "in_progress")
        self.assertEqual(data["current_stage"], 1)

        # Validation failure: empty company name
        bad_response = self.client.post("/calls", json={"company_name": "  "})
        self.assertEqual(bad_response.status_code, 422)

    def test_04_upsert_stage_result_and_revisiting(self):
        """Test updating a stage result and ensuring revisiting updates rather than duplicates."""
        call_res = self.client.post("/calls", json={"company_name": "Apex Biotech"})
        call_id = call_res.json()["id"]

        # Save stage 1 outcome
        stage1_payload = {
            "selected_outcome": "Reached intended person",
            "notes": "Reception connected directly",
        }
        res1 = self.client.put(f"/calls/{call_id}/stages/1", json=stage1_payload)
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["selected_outcome"], "Reached intended person")

        # Update stage 1 outcome (revisiting stage)
        stage1_updated = {
            "selected_outcome": "Assistant answered",
            "notes": "Assistant transferred to executive desk",
        }
        res1_up = self.client.put(f"/calls/{call_id}/stages/1", json=stage1_updated)
        self.assertEqual(res1_up.status_code, 200)
        self.assertEqual(res1_up.json()["selected_outcome"], "Assistant answered")

        # Verify only 1 stage result exists for stage 1
        detail_res = self.client.get(f"/calls/{call_id}")
        self.assertEqual(detail_res.status_code, 200)
        stages = detail_res.json()["stage_results"]
        stage1_records = [s for s in stages if s["stage_number"] == 1]
        self.assertEqual(len(stage1_records), 1)
        self.assertEqual(stage1_records[0]["selected_outcome"], "Assistant answered")

    def test_05_stage_5_exact_words_preserved(self):
        """Test Stage 5 records and preserves the prospect's exact words."""
        call_res = self.client.post("/calls", json={"company_name": "Alloy Labs"})
        call_id = call_res.json()["id"]

        exact_words = "Our company majorly works on job work basis. Technically there is hardly any margin."
        stage5_payload = {
            "selected_outcome": "Identified a need",
            "prospect_exact_words": exact_words,
            "notes": "Need help finding higher margin products",
        }
        res = self.client.put(f"/calls/{call_id}/stages/5", json=stage5_payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["prospect_exact_words"], exact_words)

        # Confirm detail fetch maintains exact words
        detail = self.client.get(f"/calls/{call_id}").json()
        stage5 = next(s for s in detail["stage_results"] if s["stage_number"] == 5)
        self.assertEqual(stage5["prospect_exact_words"], exact_words)

    def test_06_early_exit_from_any_stage(self):
        """Test that a call can end early from Stage 1 or Stage 3 without reaching Stage 8."""
        call_res = self.client.post("/calls", json={"company_name": "Busy Corp"})
        call_id = call_res.json()["id"]

        # Close early at Stage 1
        close_payload = {
            "final_outcome": "Wrong contact or number",
            "next_action": "Remove from CRM lead list",
        }
        close_res = self.client.post(f"/calls/{call_id}/close", json=close_payload)
        self.assertEqual(close_res.status_code, 200)
        closed_call = close_res.json()
        self.assertEqual(closed_call["status"], "completed")
        self.assertEqual(closed_call["final_outcome"], "Wrong contact or number")
        self.assertEqual(closed_call["current_stage"], 1)
        self.assertIsNotNone(closed_call["ended_at"])

    def test_07_full_close_with_follow_up(self):
        """Test completing a call with full next action and follow-up timing."""
        call_res = self.client.post("/calls", json={"company_name": "Orbit Tech"})
        call_id = call_res.json()["id"]

        close_payload = {
            "final_outcome": "Interested; follow-up agreed",
            "next_action": "Send growth teardown report via WhatsApp and email",
            "follow_up_time": "Next Tuesday at 2:30 PM",
            "follow_up_channel": "WhatsApp & Google Meet",
        }
        close_res = self.client.post(f"/calls/{call_id}/close", json=close_payload)
        self.assertEqual(close_res.status_code, 200)
        data = close_res.json()
        self.assertEqual(data["status"], "completed")
        self.assertEqual(data["follow_up_time"], "Next Tuesday at 2:30 PM")
        self.assertEqual(data["follow_up_channel"], "WhatsApp & Google Meet")

    def test_08_search_and_filters(self):
        """Test listing calls with search queries and outcome/stage filters."""
        # Create unique search target
        uniq_name = "Zirconium Solutions Private Limited"
        self.client.post("/calls", json={"company_name": uniq_name, "contact_name": "Vikram"})

        # Search by company name
        search_res = self.client.get(f"/calls?search=Zirconium")
        self.assertEqual(search_res.status_code, 200)
        items = search_res.json()
        self.assertTrue(any(c["company_name"] == uniq_name for c in items))

        # Search with non-matching query
        no_res = self.client.get("/calls?search=NonExistentCompanyXYZ123")
        self.assertEqual(len(no_res.json()), 0)

    def test_09_stage_number_boundary_validation(self):
        """Test invalid stage numbers are rejected with 400 Bad Request."""
        call_res = self.client.post("/calls", json={"company_name": "Test Stage Validation"})
        call_id = call_res.json()["id"]

        # Stage 0 should be rejected
        res0 = self.client.put(f"/calls/{call_id}/stages/0", json={"selected_outcome": "Test"})
        self.assertEqual(res0.status_code, 400)

        # Stage 9 should be rejected
        res9 = self.client.put(f"/calls/{call_id}/stages/9", json={"selected_outcome": "Test"})
        self.assertEqual(res9.status_code, 400)

        # Non-existent call ID should be 404
        res_404 = self.client.put("/calls/invalid-call-id-999/stages/1", json={"selected_outcome": "Test"})
        self.assertEqual(res_404.status_code, 404)

    def test_10_gemini_summary_endpoint_graceful_fallback(self):
        """Test that the summary endpoint responds gracefully when API key is missing/unconfigured."""
        call_res = self.client.post("/calls", json={"company_name": "Graceful AI Corp"})
        call_id = call_res.json()["id"]

        # Even with no GEMINI_API_KEY set, this should not throw an unhandled 500
        summary_res = self.client.post(f"/calls/{call_id}/summary")
        self.assertEqual(summary_res.status_code, 200)
        data = summary_res.json()
        self.assertIn("available", data)
        self.assertEqual(data["call_id"], call_id)


if __name__ == "__main__":
    unittest.main()
