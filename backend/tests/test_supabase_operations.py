import unittest
from unittest.mock import MagicMock, patch
import uuid
from backend.app.config import settings
from backend.app.db import DatabaseAdapter


class TestSupabaseOperations(unittest.TestCase):
    """
    Tests database operations specifically against Supabase PostgREST client:
    - Creating a call
    - Upserting stage results (saving and updating stage results)
    - Verifying unique constraint behavior on (call_id, stage_number)
    - Preserving prospect exact words, notes, and outcomes
    - Listing calls with search and filters
    - Loading call detail history including all stage results
    - Closing call and saving AI summaries
    """

    def setUp(self):
        self.mock_client = MagicMock()
        self.db = DatabaseAdapter()
        self.db.use_supabase = True
        self.db.supabase_client = self.mock_client

    def test_create_call_supabase(self):
        fake_call_id = str(uuid.uuid4())
        mock_table = MagicMock()
        self.mock_client.table.return_value = mock_table
        
        expected_call = {
            "id": fake_call_id,
            "company_name": "Acme Industrial",
            "contact_name": "Rohan Patel",
            "phone_number": "+91 99887 76655",
            "context": "Inbound inquiry on tooling",
            "status": "in_progress",
            "current_stage": 1,
            "highest_stage": 1,
            "started_at": "2026-10-18T00:00:00+00:00",
            "created_at": "2026-10-18T00:00:00+00:00",
            "updated_at": "2026-10-18T00:00:00+00:00",
        }
        mock_table.insert.return_value.execute.return_value.data = [expected_call]

        res = self.db.create_call(
            company_name="Acme Industrial",
            contact_name="Rohan Patel",
            phone_number="+91 99887 76655",
            context="Inbound inquiry on tooling",
        )

        self.mock_client.table.assert_called_with("calls")
        mock_table.insert.assert_called_once()
        inserted_payload = mock_table.insert.call_args[0][0]
        self.assertEqual(inserted_payload["company_name"], "Acme Industrial")
        self.assertEqual(inserted_payload["status"], "in_progress")
        self.assertEqual(res["company_name"], "Acme Industrial")

    def test_upsert_stage_result_insert_and_update(self):
        call_id = str(uuid.uuid4())
        mock_results_table = MagicMock()
        mock_calls_table = MagicMock()

        def table_router(name):
            if name == "call_stage_results":
                return mock_results_table
            elif name == "calls":
                return mock_calls_table
            return MagicMock()

        self.mock_client.table.side_effect = table_router

        # Case 1: First time visiting stage 5 (Insert)
        mock_results_table.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        stage_insert_record = {
            "id": str(uuid.uuid4()),
            "call_id": call_id,
            "stage_number": 5,
            "selected_outcome": "Identified a need",
            "prospect_exact_words": "We are facing capacity constraints in milling",
            "notes": "Discussed CNC machinery",
            "created_at": "2026-10-18T00:00:00+00:00",
            "updated_at": "2026-10-18T00:00:00+00:00",
        }
        mock_results_table.insert.return_value.execute.return_value.data = [stage_insert_record]
        mock_calls_table.select.return_value.eq.return_value.execute.return_value.data = [{"highest_stage": 4}]

        res_insert = self.db.upsert_stage_result(
            call_id=call_id,
            stage_number=5,
            selected_outcome="Identified a need",
            prospect_exact_words="We are facing capacity constraints in milling",
            notes="Discussed CNC machinery",
        )

        self.assertEqual(res_insert["stage_number"], 5)
        self.assertEqual(res_insert["prospect_exact_words"], "We are facing capacity constraints in milling")
        mock_results_table.insert.assert_called_once()

        # Case 2: Revisiting stage 5 (Update existing row for unique (call_id, stage_number))
        existing_stage_id = stage_insert_record["id"]
        mock_results_table.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": existing_stage_id, "stage_number": 5}
        ]
        updated_stage_record = dict(stage_insert_record)
        updated_stage_record["selected_outcome"] = "Explored need deeply"
        mock_results_table.update.return_value.eq.return_value.execute.return_value.data = [updated_stage_record]

        res_update = self.db.upsert_stage_result(
            call_id=call_id,
            stage_number=5,
            selected_outcome="Explored need deeply",
        )

        self.assertEqual(res_update["selected_outcome"], "Explored need deeply")
        mock_results_table.update.assert_called_once()

    def test_list_calls_and_search_filter(self):
        mock_table = MagicMock()
        self.mock_client.table.return_value = mock_table
        query_mock = MagicMock()
        mock_table.select.return_value.order.return_value = query_mock
        query_mock.or_.return_value = query_mock
        query_mock.eq.return_value = query_mock
        query_mock.execute.return_value.data = [
            {
                "id": str(uuid.uuid4()),
                "company_name": "Bharat Heavy Chem",
                "contact_name": "Sunil",
                "status": "completed",
                "highest_stage": 7,
                "final_outcome": "Meeting Booked",
            }
        ]

        calls = self.db.list_calls(search="Bharat", outcome="Meeting Booked", stage=7, status="completed")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["company_name"], "Bharat Heavy Chem")
        query_mock.or_.assert_called_with("company_name.ilike.%Bharat%,contact_name.ilike.%Bharat%")
        query_mock.eq.assert_any_call("final_outcome", "Meeting Booked")
        query_mock.eq.assert_any_call("highest_stage", 7)
        query_mock.eq.assert_any_call("status", "completed")

    def test_list_prospects_uses_supabase_without_local_database(self):
        prospects_table = MagicMock()
        self.mock_client.table.return_value = prospects_table

        # The seed check and the list query both belong to PostgREST.  A
        # production-configured adapter must never need the local schema.
        count_response = MagicMock(count=1)
        prospects_table.select.return_value.limit.return_value.execute.return_value = count_response
        list_query = prospects_table.select.return_value.order.return_value
        list_query.execute.return_value.data = [{
            "id": "prospect-1",
            "company_name": "Acme Industrial",
            "contact_name": "Rohan Patel",
            "is_custom": False,
        }]

        prospects = self.db.list_prospects()

        self.assertEqual(prospects[0]["company_name"], "Acme Industrial")
        self.assertFalse(any(name for name in dir(self.db) if "sqlite" in name.lower()))
        prospects_table.select.assert_any_call("id", count="exact")
        prospects_table.select.assert_any_call("*")

    def test_get_call_with_stage_history(self):
        call_id = str(uuid.uuid4())
        mock_calls_table = MagicMock()
        mock_results_table = MagicMock()

        def table_router(name):
            if name == "calls":
                return mock_calls_table
            elif name == "call_stage_results":
                return mock_results_table
            return MagicMock()

        self.mock_client.table.side_effect = table_router

        mock_calls_table.select.return_value.eq.return_value.execute.return_value.data = [
            {
                "id": call_id,
                "company_name": "Tech Corp",
                "status": "completed",
                "ai_summary": {"summary": "Great call", "outcome_rationale": "Strong fit"},
            }
        ]
        mock_results_table.select.return_value.eq.return_value.order.return_value.execute.return_value.data = [
            {"id": "sr1", "call_id": call_id, "stage_number": 1, "selected_outcome": "Connected"},
            {"id": "sr2", "call_id": call_id, "stage_number": 2, "selected_outcome": "Pitch given"},
        ]

        full_call = self.db.get_call(call_id)
        self.assertIsNotNone(full_call)
        self.assertEqual(full_call["id"], call_id)
        self.assertEqual(len(full_call["stage_results"]), 2)
        self.assertEqual(full_call["stage_results"][0]["stage_number"], 1)
        self.assertEqual(full_call["stage_results"][1]["stage_number"], 2)


if __name__ == "__main__":
    unittest.main()
