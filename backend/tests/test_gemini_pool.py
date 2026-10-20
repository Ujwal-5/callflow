"""Tests for the Gemini model/key pool failover logic (no network calls)."""

import unittest
from unittest.mock import patch

from backend.app.config import settings
from backend.app.gemini_pool import (
    ALL_TEXT_MODELS,
    DEFAULT_LIGHT_TEXT_MODELS,
    LIVE_TEXT_MODELS,
    TEXT_FALLBACK_MODELS,
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

    def test_lightweight_models_are_separate_from_important_text_pool(self):
        self.assertEqual(DEFAULT_LIGHT_TEXT_MODELS, ALL_TEXT_MODELS)
        self.assertEqual(TEXT_FALLBACK_MODELS, [
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
        ])
        self.assertNotIn(DEFAULT_LIGHT_TEXT_MODELS[0], self.pool.models)

    def test_workflow_pool_has_no_gemma_models(self):
        from backend.app.gemini_pool import DEFAULT_SMALL_TEXT_MODELS

        self.assertTrue(DEFAULT_SMALL_TEXT_MODELS)
        self.assertTrue(all("gemma" not in model for model in DEFAULT_SMALL_TEXT_MODELS))

    def test_live_text_models_are_in_tested_fallback_order(self):
        self.assertEqual(
            LIVE_TEXT_MODELS,
            [
                "gemini-3.8-live-extended-thinking",
                "gemini-3.1-flash-live-preview",
                "gemini-3.8-live",
            ],
        )
        self.assertEqual(ALL_TEXT_MODELS, LIVE_TEXT_MODELS + TEXT_FALLBACK_MODELS)

    def test_primary_models_are_tried_before_flash_lite_fallbacks(self):
        pool = GeminiModelPool(
            ALL_TEXT_MODELS,
            primary_model_count=len(LIVE_TEXT_MODELS),
            key_pool=self.key_pool,
        )
        self.assertEqual(pool.get_models_order()[:3], LIVE_TEXT_MODELS)
        self.assertEqual(pool.get_models_order()[-2:], TEXT_FALLBACK_MODELS)

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

    def test_daily_quota_skips_all_keys_for_model(self):
        calls = []

        def func(client, model_name):
            calls.append((client.api_key, model_name))
            if model_name == "model-a" and client.api_key == "key-1":
                raise Exception("429 RESOURCE_EXHAUSTED quota_exceeded: requests per day")
            return client.api_key, model_name

        result = self.pool.execute_with_fallback(func, client_factory=_fake_factory)

        self.assertEqual(calls, [("key-1", "model-a"), ("key-2", "model-a")])
        self.assertEqual(result, ("key-2", "model-a"))
        exhausted = next(
            item for item in self.pool.quota_status()
            if item["api_key"] == "key-1" and item["model"] == "model-a"
        )
        self.assertEqual(exhausted["reason"], "daily_quota_exhausted")

    def test_daily_quota_model_becomes_available_after_reset(self):
        self.pool._daily_quota_until[("key-1", "model-a")] = 0
        available = next(
            item for item in self.pool.quota_status()
            if item["api_key"] == "key-1" and item["model"] == "model-a"
        )
        self.assertTrue(available["available"])

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
