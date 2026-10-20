import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from backend.app.models import EditTranscriptPayload
from backend.app.routes import get_transcript, save_edited_transcript


class TestTranscriptRequestPath(unittest.TestCase):
    def test_save_does_not_load_full_call_detail(self):
        fake_db = MagicMock()
        fake_db.call_exists.return_value = True
        fake_db.update_edited_transcript.return_value = {"id": "t1"}

        with patch("backend.app.routes.db", fake_db):
            result = save_edited_transcript("c1", EditTranscriptPayload(edited_transcript="edited"))

        self.assertEqual(result["id"], "t1")
        fake_db.call_exists.assert_called_once_with("c1")
        fake_db.get_call.assert_not_called()
        fake_db.update_edited_transcript.assert_called_once_with("c1", "edited")

    def test_get_transcript_does_not_load_full_call_detail(self):
        fake_db = MagicMock()
        fake_db.call_exists.return_value = True
        fake_db.get_transcript.return_value = {"id": "t1"}

        with patch("backend.app.routes.db", fake_db):
            result = get_transcript("c1")

        self.assertEqual(result["id"], "t1")
        fake_db.get_call.assert_not_called()

    def test_missing_call_still_returns_not_found(self):
        fake_db = MagicMock()
        fake_db.call_exists.return_value = False

        with patch("backend.app.routes.db", fake_db):
            with self.assertRaises(HTTPException) as raised:
                save_edited_transcript("missing", EditTranscriptPayload(edited_transcript="edited"))

        self.assertEqual(raised.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
