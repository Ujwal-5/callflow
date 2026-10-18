import logging
import threading
from typing import List, Optional, Any, Callable
from backend.app.config import settings

logger = logging.getLogger("callflow.gemini_pool")

# Default model pools
# Primary text model + 2 backups
DEFAULT_TEXT_MODELS = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-flash-lite-latest",
]

# Audio transcription models (primary transcribe + 2 multimodal backups)
DEFAULT_AUDIO_MODELS = [
    "gemini-3.5-transcribe",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
]


class GeminiModelPool:
    """
    Thread-safe model pool for Gemini free tier.
    Rotates across models for load balancing and automatically fails over
    to backup models when rate limits (429 / quota) or temporary errors (503) occur.
    """

    def __init__(self, models: List[str], task_name: str = "general"):
        self.models = list(models)
        self.task_name = task_name
        self._index = 0
        self._lock = threading.Lock()

    def get_models_order(self) -> List[str]:
        """
        Returns models in round-robin rotated order.
        For request N, starts at model N % M, then tries (N+1) % M, etc.
        """
        with self._lock:
            start_idx = self._index
            self._index = (self._index + 1) % len(self.models)

        # Return list starting from start_idx
        n = len(self.models)
        return [self.models[(start_idx + i) % n] for i in range(n)]

    def execute_with_fallback(
        self,
        func: Callable[[str], Any],
        client: Optional[Any] = None,
    ) -> Any:
        """
        Executes func(model_name) with model rotation and instant backup failover.
        Tries all available models in the pool before raising.
        """
        models_to_try = self.get_models_order()
        last_exception = None

        for idx, model in enumerate(models_to_try):
            try:
                logger.info(
                    f"[{self.task_name}] Executing with model '{model}' (attempt {idx + 1}/{len(models_to_try)})"
                )
                return func(model)
            except Exception as exc:
                err_str = str(exc)
                last_exception = exc
                is_rate_limit_or_temp = (
                    "429" in err_str
                    or "RESOURCE_EXHAUSTED" in err_str
                    or "quota" in err_str.lower()
                    or "503" in err_str
                    or "UNAVAILABLE" in err_str
                    or "high demand" in err_str.lower()
                )

                if is_rate_limit_or_temp and idx < len(models_to_try) - 1:
                    next_model = models_to_try[idx + 1]
                    logger.warning(
                        f"[{self.task_name}] Model '{model}' hit limit/temporary error ({err_str[:120]}...). "
                        f"Failing over to backup model '{next_model}'."
                    )
                    continue
                elif idx < len(models_to_try) - 1:
                    # Non-rate-limit error (e.g. model deprecation or bad schema), also try backup
                    next_model = models_to_try[idx + 1]
                    logger.warning(
                        f"[{self.task_name}] Model '{model}' failed ({err_str[:120]}...). "
                        f"Failing over to backup model '{next_model}'."
                    )
                    continue
                else:
                    logger.error(
                        f"[{self.task_name}] All models in pool failed. Last model: '{model}', error: {err_str}"
                    )
                    raise last_exception

        if last_exception:
            raise last_exception


# Global pool instances
text_model_pool = GeminiModelPool(DEFAULT_TEXT_MODELS, task_name="Text-Analysis")
audio_model_pool = GeminiModelPool(DEFAULT_AUDIO_MODELS, task_name="Audio-Transcription")
