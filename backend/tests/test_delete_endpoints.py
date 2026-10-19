import unittest
from starlette.testclient import TestClient
from backend.main import app
from backend.app.db import db

class TestDeleteEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig_force_sqlite = db._force_sqlite
        db._force_sqlite = True
        db.init_client()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        db._force_sqlite = cls._orig_force_sqlite
        db.init_client()

    def test_delete_call(self):
        # Create a call
        res = self.client.post("/calls", json={"company_name": "Delete Call Test Corp"})
        self.assertEqual(res.status_code, 201)
        call_id = res.json()["id"]

        # Verify it exists
        get_res = self.client.get(f"/calls/{call_id}")
        self.assertEqual(get_res.status_code, 200)

        # Delete it
        del_res = self.client.delete(f"/calls/{call_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["deleted"])

        # Verify 404 after deletion
        get_after = self.client.get(f"/calls/{call_id}")
        self.assertEqual(get_after.status_code, 404)

        # Deleting non-existent should 404
        del_again = self.client.delete(f"/calls/{call_id}")
        self.assertEqual(del_again.status_code, 404)

    def test_delete_prospect(self):
        import uuid
        comp = f"Delete Prospect Inc {uuid.uuid4().hex[:6]}"
        create_res = self.client.post("/prospects", json={"company_name": comp, "contact_name": "Alice"})
        self.assertEqual(create_res.status_code, 201)
        prospect_id = create_res.json()["id"]

        # Verify exists
        get_res = self.client.get(f"/prospects/{prospect_id}")
        self.assertEqual(get_res.status_code, 200)

        # Delete it
        del_res = self.client.delete(f"/prospects/{prospect_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["deleted"])

        # Verify 404 after deletion
        get_after = self.client.get(f"/prospects/{prospect_id}")
        self.assertEqual(get_after.status_code, 404)

    def test_delete_followup(self):
        # Create a call with next_action
        res = self.client.post("/calls", json={"company_name": "Delete Followup Corp"})
        call_id = res.json()["id"]
        self.client.post(f"/calls/{call_id}/close", json={
            "final_outcome": "Interested; follow-up agreed",
            "next_action": "Send proposal deck",
            "follow_up_time": "Tomorrow 3pm",
        })

        followup_id = f"call_{call_id}"
        # Delete synthesized followup
        del_res = self.client.delete(f"/followups/{followup_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["deleted"])

        # Verify call's next action was cleared
        call_after = self.client.get(f"/calls/{call_id}").json()
        self.assertIsNone(call_after["next_action"])
        self.assertIsNone(call_after["follow_up_time"])
