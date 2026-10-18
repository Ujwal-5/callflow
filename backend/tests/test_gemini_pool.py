"""Tests for the Gemini model/key pool failover logic (no network calls)."""

import unittest
from unittest.mock import patch

from backend.app.config import settings
from backend.app.gemini_pool import (
    DEFAULT_AUDIO_MODELS,
    GeminiKeyPool,
    GeminiModelPool,
)


class FakeClient:
    def __init__(self, api_key: str):
        self.api_key = api_key


def _fake_factory(api_key: str) -> FakeClient:
    return FakeClient(api_key)


class TestGeminiPool(unittest.TestCase):
    def setUp(self):
        self.key_pool = GeminiKeyPool()
        self.pool = GeminiModelPool(
            ["model-a", "model-b"],
            task_name="test",
            key_pool=self.key_pool,
            cooldown_seconds=60,
        )
        self._patches = [
            patch.object(settings, "GEMINI_API_KEY", "key-1"),
            patch.object(settings, "GEMINI_API_KEY_2", "key-2"),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    def test_primary_audio_model_is_batch_transcribe(self):
        # The Live variant only supports real-time WebSocket streaming.
        self.assertEqual(DEFAULT_AUDIO_MODELS[0], "gemini-3.5-transcribe")
        self.assertNotIn("gemini-3.5-transcribe-live", DEFAULT_AUDIO_MODELS)

    def test_keys_are_deduplicated_and_rotated(self):
        with patch.object(settings, "GEMINI_API_KEY_2", "key-1"):
            self.assertEqual(self.key_pool.get_keys(), ["key-1"])

        first = self.key_pool.get_keys_order()
        second = self.key_pool.get_keys_order()
        self.assertEqual(first, ["key-1", "key-2"])
        self.assertEqual(second, ["key-2", "key-1"])

    def test_fails_over_to_second_key_on_quota_error(self):
        calls = []

        def func(client, model_name):
            calls.append((client.api_key, model_name))
            if len(calls) == 1:
                raise Exception("429 RESOURCE_EXHAUSTED: quota exceeded")
            return client.api_key, model_name

        result = self.pool.execute_with_fallback(func, client_factory=_fake_factory)

        self.assertEqual(calls[0], ("key-1", "model-a"))
        self.assertEqual(calls[1], ("key-2", "model-a"))
        self.assertEqual(result, ("key-2", "model-a"))

    def test_rate_limited_pairs_are_skipped_while_cooling(self):
        def always_429(client, model_name):
            raise Exception("429 RESOURCE_EXHAUSTED")

        with self.assertRaises(Exception):
            self.pool.execute_with_fallback(always_429, client_factory=_fake_factory)

        # Every (model, key) pair is now cooling down, so no API call is made.
        with self.assertRaises(RuntimeError) as ctx:
            self.pool.execute_with_fallback(always_429, client_factory=_fake_factory)
        self.assertIn("rate limited", str(ctx.exception))

    def test_invalid_key_is_removed_from_pool(self):
        calls = []

        def func(client, model_name):
            calls.append((client.api_key, model_name))
            if client.api_key == "key-1":
                raise Exception("400 API_KEY_INVALID: API key not valid")
            return client.api_key, model_name

        result = self.pool.execute_with_fallback(func, client_factory=_fake_factory)

        self.assertEqual(result[0], "key-2")
        self.assertEqual(self.key_pool.get_keys_order(), ["key-2"])

    def test_no_keys_raises_clear_error(self):
        with patch.object(settings, "GEMINI_API_KEY", ""), patch.object(
            settings, "GEMINI_API_KEY_2", ""
        ):
            with self.assertRaises(RuntimeError) as ctx:
                self.pool.execute_with_fallback(
                    lambda client, model: None, client_factory=_fake_factory
                )
        self.assertIn("not configured", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
