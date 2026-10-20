"""Text prompting through Gemini Live, with audio output discarded.

This is deliberately separate from the existing transcription path. Gemini
Live does not support structured-output mode; JSON callers are supported by
requesting plain text and normalizing JSON-looking responses before returning
them to the existing parsers.
"""

import asyncio
import json
from types import SimpleNamespace
from typing import Optional

from backend.app.config import settings
from backend.app.gemini_pool import LIVE_TEXT_MODELS


def _contents_to_text(contents) -> str:
    if isinstance(contents, str):
        return contents
    if isinstance(contents, (list, tuple)):
        return "\n".join(_contents_to_text(item) for item in contents)
    text = getattr(contents, "text", None)
    return str(text if text is not None else contents)


def _normalize_response(text: str, config) -> str:
    """Make Live plain text compatible with existing JSON parsers."""
    clean = (text or "").strip()
    if getattr(config, "response_mime_type", None) != "application/json":
        return clean
    if clean.startswith("```"):
        lines = clean.splitlines()
        clean = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        return json.dumps(json.loads(clean), ensure_ascii=False)
    except (TypeError, ValueError, json.JSONDecodeError):
        return clean


class LiveTextClient:
    """Sync-compatible adapter used by the existing model-pool callbacks."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.models = SimpleNamespace(generate_content=self._generate_content)

    def _generate_content(self, model, contents, config=None):
        system_instruction = getattr(config, "system_instruction", None)
        prompt = _contents_to_text(contents)
        if system_instruction:
            prompt = f"System instruction:\n{system_instruction}\n\nUser request:\n{prompt}"
        text = asyncio.run(
            _generate_live_text_once(prompt, self.api_key, model)
        )
        return SimpleNamespace(text=_normalize_response(text, config))


def _config(genai_types, model: str):
    """Return the response configuration supported by each Live model."""
    config = genai_types.LiveConnectConfig(
        # Voice Live models require AUDIO. We never retain these audio bytes;
        # output_audio_transcription is the text channel used by this helper.
        response_modalities=["AUDIO"],
        output_audio_transcription=genai_types.AudioTranscriptionConfig(),
    )
    if model == "gemini-3.8-live-extended-thinking":
        config.thinking_config = genai_types.ThinkingConfig(thinking_level="low")
    return config


async def generate_live_text(prompt: str, timeout_seconds: float = 45.0) -> str:
    """Generate a plain-text answer through the tested Gemini Live models.

    Models and configured API keys are tried in order. Audio response chunks
    are intentionally ignored; only output transcription or text parts are
    returned.
    """
    if not settings.gemini_api_keys:
        raise RuntimeError(
            "Gemini API key is not configured. Set GEMINI_API_KEY on the server."
        )

    last_error: Optional[Exception] = None
    for model in LIVE_TEXT_MODELS:
        for api_key in settings.gemini_api_keys:
            try:
                return await _generate_live_text_once(
                    prompt, api_key, model, timeout_seconds
                )
            except Exception as exc:
                last_error = exc

    raise RuntimeError(
        f"All Gemini Live text models failed: {last_error}"
    ) from last_error


async def _generate_live_text_once(
    prompt: str,
    api_key: str,
    model: str,
    timeout_seconds: float = 45.0,
) -> str:
    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    async with client.aio.live.connect(
        model=model, config=_config(genai_types, model)
    ) as session:
        await session.send_realtime_input(text=prompt)
        return await asyncio.wait_for(_collect_text(session), timeout=timeout_seconds)


async def _collect_text(session) -> str:
    chunks = []
    async for response in session.receive():
        content = getattr(response, "server_content", None)
        if not content:
            continue

        output_transcription = getattr(content, "output_transcription", None)
        if output_transcription and getattr(output_transcription, "text", None):
            chunks.append(output_transcription.text)

        model_turn = getattr(content, "model_turn", None)
        for part in ([] if not model_turn else (getattr(model_turn, "parts", []) or [])):
            text = getattr(part, "text", None)
            if text:
                chunks.append(text)

        status = str(getattr(content, "interaction_status", "") or "").upper()
        if getattr(content, "turn_complete", False) and status in {"", "IDLE"}:
            break

    text = "".join(chunks).strip()
    if not text:
        raise RuntimeError("Gemini Live returned no text transcription")
    return text
