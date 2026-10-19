"""
transcription.py — Audio transcription via Gemini.

Two modes are supported:

1. Live WebSocket streaming  ─ run_live_transcription(audio_generator)
   Feeds raw PCM audio chunks from the browser WebSocket through the Gemini
   Live API and yields transcription events as dicts.

2. Batch upload (legacy)  ─ transcribe_audio(audio_bytes, content_type)
   Sends a complete audio file to Gemini for offline transcription.

Note: gemini-3.5-transcribe-live is designed for real-time WebSocket
streaming; it cannot process pre-recorded uploads through generate_content.

Supported audio MIME types (MediaRecorder output varies by browser):
  audio/webm, audio/webm;codecs=opus, audio/ogg, audio/ogg;codecs=opus,
  audio/mp4, audio/mpeg, audio/wav

File size limit: 20 MB inline (Gemini inline audio limit).
Duration: up to ~30 minutes per the model's context window.

The function is async-friendly so it can be called from an async FastAPI route.
Heavy work (HTTP to Gemini) is done in a thread pool via asyncio.to_thread so
the event loop is not blocked.
"""

import asyncio
import logging
from typing import Dict, Any, Optional, Tuple, AsyncGenerator

from backend.app.config import settings

logger = logging.getLogger("callflow.transcription")

# Inline audio limit for Gemini (bytes).  Above this we should use the Files API,
# which requires additional setup; for now we enforce this as a client-side and
# server-side limit.
MAX_AUDIO_BYTES = 20 * 1024 * 1024  # 20 MB

# Primary Gemini model for transcription (backups live in gemini_pool).
TRANSCRIBE_MODEL = "gemini-3.5-transcribe"

# Model for live streaming transcription
LIVE_TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live"

# MIME types accepted from the browser (MediaRecorder).
ACCEPTED_MIME_TYPES = {
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-m4a",
}


def _normalise_mime(content_type: str) -> str:
    """Return the base MIME type, stripping charset and codec annotations."""
    return content_type.split(";")[0].strip().lower()


def validate_audio(audio_bytes: bytes, content_type: str) -> Optional[str]:
    """Return an error string if the audio is invalid, or None if it is OK."""
    base_mime = _normalise_mime(content_type)
    if base_mime not in ACCEPTED_MIME_TYPES:
        return (
            f"Unsupported audio format '{base_mime}'. "
            f"Accepted formats: {', '.join(sorted(ACCEPTED_MIME_TYPES))}."
        )
    if len(audio_bytes) == 0:
        return "Audio file is empty."
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        mb = len(audio_bytes) / (1024 * 1024)
        return (
            f"Audio file is too large ({mb:.1f} MB). "
            f"Maximum allowed size is {MAX_AUDIO_BYTES // (1024 * 1024)} MB."
        )
    return None


async def run_live_transcription(
    audio_generator: AsyncGenerator[bytes, None],
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Stream raw PCM audio chunks from the browser through the Gemini Live API
    and yield transcription events as dicts.

    Expected audio format from the browser:
      - Encoding: signed 16-bit PCM (LINEAR16)
      - Sample rate: 16,000 Hz
      - Channels: mono (1 channel)

    Yields dicts with one of these shapes:
      {"type": "connected"}
      {"type": "interim", "text": "..."}
      {"type": "final", "text": "..."}
      {"type": "error", "message": "..."}
      {"type": "done"}
    """
    if not settings.gemini_configured:
        yield {
            "type": "error",
            "message": (
                "Gemini API key is not configured. "
                "Set GEMINI_API_KEY on the server."
            ),
        }
        return

    # Use the first available API key
    api_key = settings.gemini_api_keys[0]

    try:
        from google import genai
        from google.genai import types as genai_types

        client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})

        # Enable the Live Transcription model's input transcription stream.
        config = genai_types.LiveConnectConfig(
            response_modalities=["TEXT"],
            input_audio_transcription=genai_types.AudioTranscriptionConfig(
                language_codes=[],  # Let Gemini detect the spoken language.
            ),
        )

        yield {"type": "connected"}

        async with client.aio.live.connect(
            model=LIVE_TRANSCRIBE_MODEL, config=config
        ) as session:
            # Run sender and receiver concurrently
            send_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue()

            async def _sender():
                """Feed PCM chunks from the browser into the Gemini session."""
                try:
                    async for chunk in audio_generator:
                        if chunk:
                            await session.send_realtime_input(
                                audio=genai_types.Blob(
                                    data=chunk,
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )
                except Exception as exc:
                    logger.exception("Live transcription sender error: %s", exc)
                finally:
                    # Signal end of audio so Gemini flushes the final transcript.
                    try:
                        await session.send_realtime_input(audio_stream_end=True)
                    except Exception:
                        pass

            async def _receiver() -> AsyncGenerator[Dict[str, Any], None]:
                """Receive transcription events from the Gemini session."""
                try:
                    async for response in session.receive():
                        server_content = getattr(response, "server_content", None)
                        if not server_content:
                            continue

                        interim = getattr(
                            server_content, "interim_input_transcription", None
                        )
                        if interim and getattr(interim, "text", None):
                            yield {"type": "interim", "text": interim.text.strip()}

                        final = getattr(server_content, "input_transcription", None)
                        if final and getattr(final, "text", None):
                            yield {"type": "final", "text": final.text.strip()}
                except Exception as exc:
                    logger.warning("Live transcription receiver error: %s", exc)
                    yield {"type": "error", "message": str(exc)}

            # Run sender in background, yield receiver events
            sender_task = asyncio.create_task(_sender())
            try:
                async for event in _receiver():
                    yield event
            finally:
                sender_task.cancel()
                try:
                    await sender_task
                except (asyncio.CancelledError, Exception):
                    pass

        yield {"type": "done"}

    except Exception as exc:
        logger.error("Live transcription session error: %s", exc)
        yield {
            "type": "error",
            "message": f"Live transcription failed: {exc}",
        }


def _run_transcription(audio_bytes: bytes, content_type: str) -> Tuple[str, Dict[str, Any]]:
    """Synchronous Gemini call — runs in a thread pool.

    Returns (transcript_text, metadata_dict).
    Raises RuntimeError with a user-friendly message on failure.
    """
    if not settings.gemini_configured:
        raise RuntimeError(
            "Gemini API key is not configured. Set GEMINI_API_KEY "
            "(and optionally GEMINI_API_KEY_2) on the server."
        )

    try:
        from google.genai import types as genai_types

        from backend.app.gemini_pool import audio_model_pool

        # Use inline bytes — no File Upload API required for ≤20 MB
        part = genai_types.Part.from_bytes(data=audio_bytes, mime_type=content_type)

        used_model_name = [TRANSCRIBE_MODEL]

        def _call_transcribe(client, model_name: str):
            used_model_name[0] = model_name
            # For general multimodal models, supply an explicit transcription prompt
            if "transcribe" in model_name:
                contents = [part]
            else:
                contents = [
                    "Please transcribe the following audio recording verbatim into text with speaker turns if detectable:",
                    part,
                ]

            return client.models.generate_content(
                model=model_name,
                contents=contents,
                config=genai_types.GenerateContentConfig(
                    temperature=0.0,  # deterministic for transcription
                ),
            )

        response = audio_model_pool.execute_with_fallback(_call_transcribe)

        # Extract text from response:
        # Gemini transcribe models return text in candidate parts as either
        # part.audio_transcription.text or part.text.
        transcript_parts = []
        speaker_segments = []

        if response.candidates and response.candidates[0].content:
            for p in response.candidates[0].content.parts:
                at = getattr(p, "audio_transcription", None)
                if at is not None:
                    txt = getattr(at, "text", "") or ""
                    if txt:
                        transcript_parts.append(txt)
                    speaker = getattr(at, "speaker_label", None)
                    start_off = getattr(at, "start_offset", None)
                    end_off = getattr(at, "end_offset", None)
                    if speaker or start_off or end_off:
                        speaker_segments.append({
                            "speaker": speaker,
                            "start_offset": start_off,
                            "end_offset": end_off,
                            "text": txt,
                        })
                elif getattr(p, "text", None):
                    transcript_parts.append(p.text)

        text = " ".join(t.strip() for t in transcript_parts if t.strip())

        # Fallback to response.text if parts didn't yield text
        if not text and getattr(response, "text", None):
            text = response.text.strip()

        metadata: Dict[str, Any] = {
            "model": used_model_name[0],
            "audio_bytes": len(audio_bytes),
            "mime_type": content_type,
        }

        if speaker_segments:
            metadata["segments"] = speaker_segments

        # Extract usage metadata if available
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            um = response.usage_metadata
            metadata["input_tokens"] = getattr(um, "prompt_token_count", None)
            metadata["output_tokens"] = getattr(um, "candidates_token_count", None)

        return text, metadata

    except RuntimeError:
        raise
    except Exception as exc:
        logger.warning("Gemini transcription error: %s", exc)
        raise RuntimeError(
            f"Transcription failed: {exc}"
        ) from exc


async def transcribe_audio(
    audio_bytes: bytes, content_type: str
) -> Tuple[str, Dict[str, Any]]:
    """Async wrapper: runs the blocking Gemini call in a thread pool.

    Returns (transcript_text, metadata_dict).
    Raises RuntimeError with a user-friendly message on failure.
    """
    return await asyncio.to_thread(_run_transcription, audio_bytes, content_type)
