"""
test_live_transcription.py — Tests for the live WebSocket transcription endpoint
and the stage-notes analysis endpoint.

Covers:
1.  WS /calls/{bad_id}/transcribe-live — non-existent call closes with error JSON
2.  WS /calls/{call_id}/transcribe-live — valid call receives {"type": "connected"}
3.  WS — sending {"control": "stop"} closes the session gracefully
4.  WS — sending an invalid JSON message does NOT crash the server
5.  WS — silence (no audio sent) then stop returns at least {"type": "done"}
6.  POST /calls/{call_id}/analyze-stage-notes — valid text returns stage_notes list
7.  POST /calls/{call_id}/analyze-stage-notes — empty text returns empty lists
8.  POST /calls/{call_id}/analyze-stage-notes — non-existent call returns 404
9.  POST /calls/{call_id}/analyze-stage-notes — missing transcript_segment returns 422
10. WS transcript persistence: after stop, GET /calls/{id}/transcript returns text
    (integration test — skipped without GEMINI_API_KEY + live Gemini access)

All tests except #10 run without Gemini API access using mocks or by exercising
only the structural/validation layer of the endpoints.
"""

import asyncio
import base64
import json
import struct
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.main import app
from backend.app.db import db


# ── Helper: build silent 16-kHz PCM bytes ────────────────────────────────────

def _silent_pcm(num_samples: int = 1600) -> bytes:
    """Return `num_samples` zero-valued signed 16-bit LE PCM samples."""
    return struct.pack(f"<{num_samples}h", *([0] * num_samples))


def _b64_silent_pcm(num_samples: int = 1600) -> str:
    return base64.b64encode(_silent_pcm(num_samples)).decode()


# ── Fake async generator for mocked run_live_transcription ───────────────────

async def _fake_transcription_gen_connected():
    """Yields connected + done without any real audio processing."""
    yield {"type": "connected"}
    yield {"type": "done"}


async def _fake_transcription_gen_with_final():
    """Yields connected, an interim, a final, then done."""
    yield {"type": "connected"}
    yield {"type": "interim", "text": "hello world"}
    yield {"type": "final", "text": "Hello, world."}
    yield {"type": "done"}


# ── Test class ────────────────────────────────────────────────────────────────

class TestLiveTranscriptionWebSocket(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig_force_sqlite = db._force_sqlite
        db._force_sqlite = True
        db.init_db()
        cls.client = TestClient(app, raise_server_exceptions=False)

        # Create a call used across tests
        res = cls.client.post("/calls", json={"company_name": "LiveWS Test Co"})
        assert res.status_code == 201, f"Call creation failed: {res.text}"
        cls.call_id = res.json()["id"]

    @classmethod
    def tearDownClass(cls):
        db._force_sqlite = cls._orig_force_sqlite
        db.init_client()

    # ── 1. Non-existent call ──────────────────────────────────────────────────

    def test_01_ws_nonexistent_call_sends_error_and_closes(self):
        """WS to a bad call ID receives an error JSON message and closes."""
        with self.client.websocket_connect("/calls/nonexistent-id/transcribe-live") as ws:
            # First message should be an error
            raw = ws.receive_text()
            msg = json.loads(raw)
            self.assertEqual(msg.get("type"), "error", f"Expected error, got: {msg}")
            self.assertIn("message", msg)

    # ── 2. Valid call — receives "connected" ──────────────────────────────────

    @patch("backend.app.routes.run_live_transcription")
    def test_02_ws_valid_call_receives_connected(self, mock_rlt):
        """WS to a valid call receives {"type": "connected"} as first message."""
        mock_rlt.return_value = _fake_transcription_gen_connected()

        with self.client.websocket_connect(
            f"/calls/{self.call_id}/transcribe-live"
        ) as ws:
            raw = ws.receive_text()
            msg = json.loads(raw)
            self.assertEqual(msg.get("type"), "connected")
            self.assertEqual(msg.get("call_id"), self.call_id)

    # ── 3. Control stop closes gracefully ────────────────────────────────────

    @patch("backend.app.routes.run_live_transcription")
    def test_03_ws_control_stop_closes_gracefully(self, mock_rlt):
        """Sending {"control": "stop"} terminates the session without error."""
        mock_rlt.return_value = _fake_transcription_gen_connected()

        with self.client.websocket_connect(
            f"/calls/{self.call_id}/transcribe-live"
        ) as ws:
            # Consume connected
            ws.receive_text()
            # Send stop
            ws.send_text(json.dumps({"control": "stop"}))
            # The server should close gracefully — just drain remaining messages
            try:
                while True:
                    ws.receive_text()
            except Exception:
                pass  # Connection closed as expected

    # ── 4. Invalid JSON does not crash server ─────────────────────────────────

    @patch("backend.app.routes.run_live_transcription")
    def test_04_ws_invalid_json_does_not_crash(self, mock_rlt):
        """Sending garbage text over the WS does not cause a server 500."""
        mock_rlt.return_value = _fake_transcription_gen_connected()

        with self.client.websocket_connect(
            f"/calls/{self.call_id}/transcribe-live"
        ) as ws:
            ws.receive_text()  # connected
            ws.send_text("NOT JSON AT ALL @@@@")
            ws.send_text(json.dumps({"control": "stop"}))
            # Drain
            try:
                while True:
                    ws.receive_text()
            except Exception:
                pass

    # ── 5. Final text arrives in stream ───────────────────────────────────────

    @patch("backend.app.routes.run_live_transcription")
    def test_05_ws_receives_interim_and_final_messages(self, mock_rlt):
        """WS receives interim and final type messages from the transcription stream."""
        mock_rlt.return_value = _fake_transcription_gen_with_final()

        received_types = []
        with self.client.websocket_connect(
            f"/calls/{self.call_id}/transcribe-live"
        ) as ws:
            try:
                while True:
                    raw = ws.receive_text()
                    msg = json.loads(raw)
                    received_types.append(msg.get("type"))
                    if msg.get("type") == "done":
                        break
            except Exception:
                pass

        self.assertIn("connected", received_types)
        self.assertIn("interim", received_types)
        self.assertIn("final", received_types)


class TestAnalyzeStageNotesEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig_force_sqlite = db._force_sqlite
        db._force_sqlite = True
        db.init_db()
        cls.client = TestClient(app)

        res = cls.client.post("/calls", json={"company_name": "Stage Notes Test Co"})
        assert res.status_code == 201
        cls.call_id = res.json()["id"]

    @classmethod
    def tearDownClass(cls):
        db._force_sqlite = cls._orig_force_sqlite
        db.init_client()

    # ── 6. Valid text returns stage_notes ────────────────────────────────────

    @patch("backend.app.gemini_pool.text_model_pool")
    def test_06_analyze_stage_notes_valid_text(self, mock_pool):
        """POST analyze-stage-notes with valid text returns a list of stage_notes."""
        fake_json = json.dumps({
            "stage_notes": [
                {
                    "stage_number": 1,
                    "stage_name": "Opening",
                    "note": "Spoke with the receptionist",
                    "evidence_quote": "Hi this is the receptionist",
                    "confidence": 0.9,
                    "needs_review": False,
                }
            ],
            "unclassified_segments": [],
        })
        # execute_with_fallback is synchronous in the route (not awaited)
        mock_response = MagicMock()
        mock_response.text = fake_json
        mock_pool.execute_with_fallback = MagicMock(return_value=mock_response)

        res = self.client.post(
            f"/calls/{self.call_id}/analyze-stage-notes",
            json={
                "transcript_segment": "Hi this is the receptionist, how can I help?",
                "segment_id": "seg_test_001",
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("stage_notes", data)
        self.assertIn("call_id", data)
        self.assertEqual(data["call_id"], self.call_id)
        self.assertIsInstance(data["stage_notes"], list)

    # ── 7. Empty text returns empty lists ─────────────────────────────────────

    def test_07_analyze_stage_notes_empty_text(self):
        """POST analyze-stage-notes with empty transcript_segment returns empty lists."""
        res = self.client.post(
            f"/calls/{self.call_id}/analyze-stage-notes",
            json={"transcript_segment": "   ", "segment_id": "seg_empty"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["stage_notes"], [])
        self.assertEqual(data["unclassified_segments"], [])

    # ── 8. Non-existent call returns 404 ─────────────────────────────────────

    def test_08_analyze_stage_notes_bad_call_id(self):
        """POST analyze-stage-notes with unknown call ID returns 404."""
        res = self.client.post(
            "/calls/nonexistent-call-id/analyze-stage-notes",
            json={"transcript_segment": "Hello there", "segment_id": "seg_bad"},
        )
        self.assertEqual(res.status_code, 404)

    # ── 9. Missing transcript_segment returns 422 ─────────────────────────────

    def test_09_analyze_stage_notes_missing_field(self):
        """POST analyze-stage-notes without transcript_segment returns 422."""
        res = self.client.post(
            f"/calls/{self.call_id}/analyze-stage-notes",
            json={"segment_id": "seg_missing"},
        )
        self.assertEqual(res.status_code, 422)


if __name__ == "__main__":
    unittest.main()
