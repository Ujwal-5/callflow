"""Live audio transcription through the Gemini Live API."""

import asyncio
import logging
from typing import Dict, Any, Optional, AsyncGenerator

from backend.app.config import settings

logger = logging.getLogger("callflow.transcription")

# Model for live streaming transcription
# This preview model is exposed through the v1beta Live API.  Keeping the
# fully-qualified model name here also avoids the SDK resolving the short name
# against a different endpoint/version.
LIVE_TRANSCRIBE_MODEL = "models/gemini-3.5-transcribe-live"


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

        # gemini-3.5-transcribe-live is a v1beta Live API model.  v1alpha may
        # accept the websocket request but reject the model/config immediately
        # after the socket is opened, which used to surface as a vague client
        # "failed to connect" error.
        client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})

        # Enable the Live Transcription model's input transcription stream.
        config = genai_types.LiveConnectConfig(
            response_modalities=["TEXT"],
            input_audio_transcription=genai_types.AudioTranscriptionConfig(
                language_codes=[],  # Let Gemini detect the spoken language.
                # Keep live transcription low-latency and preserve exactly what
                # was spoken, including filler words and self-corrections.
                mode=genai_types.AudioTranscriptionConfigMode.VERBATIM,
            ),
        )

        async with client.aio.live.connect(
            model=LIVE_TRANSCRIBE_MODEL, config=config
        ) as session:
            # Do not report connected until the upstream Gemini session has
            # successfully entered its context manager.
            yield {"type": "connected"}
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
        logger.error(
            "Live transcription session error (%s): %s",
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        yield {
            "type": "error",
            "message": f"Live transcription failed ({type(exc).__name__}): {exc}",
        }


