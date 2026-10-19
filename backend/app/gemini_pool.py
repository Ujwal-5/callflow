import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Any, Callable, Dict, Tuple
from zoneinfo import ZoneInfo

from backend.app.config import settings

logger = logging.getLogger("callflow.gemini_pool")

# Default model pools
# Primary text models
DEFAULT_TEXT_MODELS = [
    # Current Frontier & Workhorse Text Models
    "gemini-3.8-flash",            # Latest - built for coding & agentic workflows
    "gemini-3.7-flash",            # Core reasoning & engineering
    "gemini-3.6-flash",            # Multi-step complex workflows
    
    # Speed & Latency-Sensitive Lite Models
    "gemini-3.5-flash-lite",       # Lightweight agent execution
    "gemini-3.1-flash-lite",       # High-volume workloads       
    # 🔗 Dynamic String Pointers
    "gemini-flash-lite-latest",    # Points to latest stable flash-lite version
]

# Separate high-quota pool for frequent, lightweight workflow assistance.
DEFAULT_LIGHT_TEXT_MODELS = [
    "gemma-4-26b-a4b-it",
    "gemma-4-31b-it",
]


# Audio transcription models for pre-recorded uploads.
# Note: gemini-3.5-transcribe-live is streaming-only (Live API / WebSocket) and
# rejects one-shot generate_content calls, so it cannot be used for uploads.

DEFAULT_AUDIO_MODELS = [
    # The Dedicated Pure Speech-to-Text Model
    "gemini-3.5-transcribe",
    
    # Multimodal Models (Accept Audio Input -> Output Text Transcript)
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    
    "gemini-3-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
]


# How long a (key, model) pair is skipped after a 429/503 before it is retried.
RATE_LIMIT_COOLDOWN_SECONDS = 60.0
GEMINI_QUOTA_TIMEZONE = "America/Los_Angeles"


def make_gemini_client(api_key: str):
    """Create a google-genai client for the given API key."""
    from google import genai

    return genai.Client(api_key=api_key)


class GeminiKeyPool:
    """
    Thread-safe pool of Gemini API keys.

    Keys are rotated round-robin so consecutive requests start on different
    keys, spreading quota usage. A key that the API rejects as invalid is
    skipped for the rest of the process lifetime.
    """

    def __init__(self):
        self._index = 0
        self._lock = threading.Lock()
        self._invalid_keys: set[str] = set()

    def get_keys(self) -> List[str]:
        """All configured keys, primary first, deduplicated."""
        return list(settings.gemini_api_keys)

    def get_keys_order(self) -> List[str]:
        """Return usable keys in round-robin rotated order."""
        keys = [k for k in self.get_keys() if k not in self._invalid_keys]
        if not keys:
            # Every key was rejected as invalid; return them so the caller
            # still gets the real authentication error from the API.
            return self.get_keys()

        with self._lock:
            start_idx = self._index % len(keys)
            self._index = (self._index + 1) % len(keys)

        return [keys[(start_idx + i) % len(keys)] for i in range(len(keys))]

    def mark_invalid(self, api_key: str) -> None:
        with self._lock:
            self._invalid_keys.add(api_key)

    @property
    def configured(self) -> bool:
        return bool(self.get_keys())


gemini_key_pool = GeminiKeyPool()


def _is_rate_limit_or_temporary(err_str: str) -> bool:
    lowered = err_str.lower()
    return (
        "429" in err_str
        or "resource_exhausted" in lowered
        or "quota" in lowered
        or "rate limit" in lowered
        or "503" in err_str
        or "unavailable" in lowered
        or "high demand" in lowered
        or "overloaded" in lowered
    )


def _is_daily_quota_exhausted(err_str: str) -> bool:
    """Return true only for errors that indicate a requests/tokens-per-day limit."""
    lowered = err_str.lower().replace("-", "_")
    return any(
        marker in lowered
        for marker in (
            "quota_exceeded",
            "daily quota",
            "per_day",
            "per day",
            "perday",
            "requests per day",
            "tokens per day",
        )
    )


def _retry_delay_seconds(err_str: str) -> Optional[float]:
    """Extract Google's retryDelay, when the SDK includes it in the exception text."""
    patterns = (
        r"retryDelay\s*[=:]\s*[{'\"]?seconds['\"]?\s*[=:]\s*['\"]?(\d+(?:\.\d+)?)",
        r"retry(?:ing)?\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)",
    )
    for pattern in patterns:
        match = re.search(pattern, err_str, flags=re.IGNORECASE)
        if match:
            return max(1.0, float(match.group(1)))
    return None


def _next_daily_reset_epoch() -> float:
    """Gemini RPD quotas reset at midnight Pacific time."""
    pacific = ZoneInfo(GEMINI_QUOTA_TIMEZONE)
    now = datetime.now(pacific)
    tomorrow = (now + timedelta(days=1)).date()
    reset = datetime.combine(tomorrow, datetime.min.time(), tzinfo=pacific)
    return reset.timestamp()


def _is_invalid_key(err_str: str) -> bool:
    lowered = err_str.lower()
    return (
        "api_key_invalid" in lowered
        or "api key not valid" in lowered
        or "invalid api key" in lowered
    )


class GeminiModelPool:
    """
    Thread-safe pool of Gemini models + API keys for the free tier.

    For every request it walks a rotated list of models and keys, so load is
    spread across both. Short-lived rate limits and daily quota exhaustion cool
    down the affected model/key pair until it can be retried. Non-quota errors
    move on to the next combination.
    """

    def __init__(
        self,
        models: List[str],
        task_name: str = "general",
        key_pool: Optional[GeminiKeyPool] = None,
        cooldown_seconds: float = RATE_LIMIT_COOLDOWN_SECONDS,
    ):
        self.models = list(models)
        self.task_name = task_name
        self.key_pool = key_pool or gemini_key_pool
        self.cooldown_seconds = cooldown_seconds
        self._index = 0
        self._lock = threading.Lock()
        self._cooldowns: Dict[Tuple[str, str], float] = {}
        # A key may belong to a different Google project, so track daily quota
        # by (API key, model). Keys from the same project will still be tried,
        # but Google will reject them and they will each be remembered.
        self._daily_quota_until: Dict[Tuple[str, str], float] = {}
        self._cooldown_lock = threading.Lock()

    def get_models_order(self) -> List[str]:
        """
        Returns models in round-robin rotated order.
        For request N, starts at model N % M, then tries (N+1) % M, etc.
        """
        with self._lock:
            start_idx = self._index
            self._index = (self._index + 1) % len(self.models)

        n = len(self.models)
        return [self.models[(start_idx + i) % n] for i in range(n)]

    def _is_cooling(self, api_key: str, model: str) -> bool:
        with self._cooldown_lock:
            daily_until = self._daily_quota_until.get((api_key, model))
            if daily_until is not None:
                if daily_until > time.time():
                    return True
                del self._daily_quota_until[(api_key, model)]
            until = self._cooldowns.get((api_key, model))
            if until is None:
                return False
            if until <= time.monotonic():
                del self._cooldowns[(api_key, model)]
                return False
            return True

    def _start_cooldown(self, api_key: str, model: str) -> None:
        with self._cooldown_lock:
            self._cooldowns[(api_key, model)] = (
                time.monotonic() + self.cooldown_seconds
            )

    def _mark_daily_quota_exhausted(self, api_key: str, model: str) -> None:
        with self._cooldown_lock:
            self._daily_quota_until[(api_key, model)] = _next_daily_reset_epoch()

    def quota_status(self) -> List[Dict[str, Any]]:
        """Return observed key/model availability; remaining counts are unavailable."""
        now = time.time()
        status = []
        with self._cooldown_lock:
            for api_key in self.key_pool.get_keys():
                for model in self.models:
                    daily_until = self._daily_quota_until.get((api_key, model))
                    status.append({
                        "api_key": api_key,
                        "model": model,
                        "available": not daily_until or daily_until <= now,
                        "reason": "daily_quota_exhausted" if daily_until and daily_until > now else None,
                        "retry_at": (
                            datetime.fromtimestamp(daily_until, timezone.utc).isoformat()
                            if daily_until and daily_until > now else None
                        ),
                    })
        return status

    def execute_with_fallback(
        self,
        func: Callable[[Any, str], Any],
        client_factory: Optional[Callable[[str], Any]] = None,
    ) -> Any:
        """
        Execute ``func(client, model_name)`` with key + model rotation.

        Every (model, key) pair is tried before giving up. Pairs that recently
        returned a 429/503 are skipped until their cooldown expires.
        """
        keys = self.key_pool.get_keys_order()
        if not keys:
            raise RuntimeError(
                "Gemini API key is not configured. Set GEMINI_API_KEY "
                "(and optionally GEMINI_API_KEY_2) on the server."
            )

        factory = client_factory or make_gemini_client

        attempts: List[Tuple[str, str]] = []
        for model in self.get_models_order():
            for api_key in keys:
                if not self._is_cooling(api_key, model):
                    attempts.append((model, api_key))

        if not attempts:
            raise RuntimeError(
                "All Gemini models/keys are currently rate limited. "
                "Please retry in about a minute."
            )

        last_exception: Optional[Exception] = None
        total = len(attempts)

        for idx, (model, api_key) in enumerate(attempts):
            # Another concurrent request may have exhausted this model after
            # the attempt list was built.
            if self._is_cooling(api_key, model):
                continue
            key_hint = f"key {keys.index(api_key) + 1}/{len(keys)}"
            try:
                logger.info(
                    f"[{self.task_name}] Executing with model '{model}' "
                    f"({key_hint}, attempt {idx + 1}/{total})"
                )
                client = factory(api_key)
                return func(client, model)
            except Exception as exc:
                err_str = str(exc)
                last_exception = exc
                is_quota = _is_rate_limit_or_temporary(err_str)
                is_daily_quota = _is_daily_quota_exhausted(err_str)

                if _is_invalid_key(err_str):
                    logger.warning(
                        f"[{self.task_name}] {key_hint} was rejected as invalid. "
                        "Removing it from the pool."
                    )
                    self.key_pool.mark_invalid(api_key)
                elif is_quota:
                    if is_daily_quota:
                        self._mark_daily_quota_exhausted(api_key, model)
                    else:
                        delay = _retry_delay_seconds(err_str) or self.cooldown_seconds
                        self._start_cooldown(api_key, model)
                        if delay != self.cooldown_seconds:
                            with self._cooldown_lock:
                                self._cooldowns[(api_key, model)] = time.monotonic() + delay

                next_attempt = next(
                    (
                        (next_idx, next_model, next_key)
                        for next_idx, (next_model, next_key) in enumerate(
                            attempts[idx + 1:], start=idx + 1
                        )
                        if not self._is_cooling(next_key, next_model)
                    ),
                    None,
                )
                if next_attempt is not None:
                    _, next_model, next_key = next_attempt
                    reason = (
                        "daily quota exhausted" if is_daily_quota
                        else "hit limit/temporary error" if is_quota
                        else "failed"
                    )
                    logger.warning(
                        f"[{self.task_name}] Model '{model}' with {key_hint} {reason} "
                        f"({err_str[:120]}). Failing over to '{next_model}' "
                        f"(key {keys.index(next_key) + 1}/{len(keys)})."
                    )
                if next_attempt is not None:
                    continue

                logger.error(
                    f"[{self.task_name}] All model/key combinations failed. "
                    f"Last model: '{model}', error: {err_str}"
                )
                raise last_exception

        if last_exception:
            raise last_exception

        raise RuntimeError(f"[{self.task_name}] No Gemini attempt was executed.")


# Global pool instances
text_model_pool = GeminiModelPool(DEFAULT_TEXT_MODELS, task_name="Text-Analysis")
light_text_model_pool = GeminiModelPool(
    DEFAULT_LIGHT_TEXT_MODELS,
    task_name="Lightweight-Workflow-Assist",
)
audio_model_pool = GeminiModelPool(DEFAULT_AUDIO_MODELS, task_name="Audio-Transcription")
