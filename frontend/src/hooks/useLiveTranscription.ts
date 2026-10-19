"use client";

/**
 * useLiveTranscription — WebSocket-based live audio transcription hook.
 *
 * This hook is designed to live in the parent (page-level) component and
 * survive stage changes. It manages:
 *
 * - Microphone capture with proper resampling to 16 kHz mono PCM
 * - WebSocket connection to /calls/{callId}/transcribe-live
 * - Streaming interim + finalized transcript text
 * - Graceful cleanup (mic tracks, AudioContext, WebSocket)
 *
 * IMPORTANT: The hook does NOT stop or restart when the caller navigates
 * between stages. Recording belongs to the active call, not to a stage.
 *
 * Audio flow:
 *   Microphone → MediaStream → AudioContext (resampled to 16 kHz)
 *   → ScriptProcessorNode → base64 PCM chunks → WebSocket → Gemini Live
 */

import { useState, useRef, useCallback, useEffect } from "react";

/** Possible recording states exposed to UI components. */
export type LiveTranscriptionState =
  | "idle"          // no recording, no WS connection
  | "requesting"    // requesting mic permission
  | "connecting"    // mic granted, opening WebSocket
  | "recording"     // actively streaming audio
  | "stopping"      // sent stop signal, waiting for final response
  | "error";        // unrecoverable error, transcript text preserved

export interface LiveTranscriptionSegment {
  /** Unique ID for deduplication */
  id: string;
  /** "interim" or "final" */
  type: "interim" | "final";
  text: string;
  timestamp: number;
}

export interface UseLiveTranscriptionReturn {
  state: LiveTranscriptionState;
  /** Elapsed recording seconds */
  elapsedSeconds: number;
  /** All finalized transcript segments, in order */
  finalSegments: LiveTranscriptionSegment[];
  /** Current interim (not-yet-finalized) text — may be empty */
  interimText: string;
  /** Full finalized transcript as a single string */
  finalTranscript: string;
  /** Human-readable error message */
  error: string | null;
  /** Start recording for the given call ID */
  startRecording: (callId: string) => Promise<void>;
  /** Stop recording and wait for final transcription */
  stopRecording: () => void;
  /** Reset all state (call after call ends) */
  reset: () => void;
  /** Whether microphone consent has been acknowledged */
  consentAcknowledged: boolean;
  /** Acknowledge the microphone consent notice */
  acknowledgeConsent: () => void;
}

/** Target sample rate for Gemini Live API */
const TARGET_SAMPLE_RATE = 16_000;

/** PCM chunk size in samples (100ms at 16 kHz) */
const CHUNK_SAMPLES = TARGET_SAMPLE_RATE / 10; // 1600 samples = 100ms

/** Derive WebSocket URL from API base URL */
function getWebSocketUrl(callId: string): string {
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  const wsBase = apiBase
    .replace(/^https:\/\//, "wss://")
    .replace(/^http:\/\//, "ws://")
    .replace(/\/$/, "");
  return `${wsBase}/calls/${callId}/transcribe-live`;
}

/** Convert Float32 samples to Int16 PCM bytes */
function float32ToInt16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Convert ArrayBuffer to base64 string */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

let segmentCounter = 0;
function nextSegmentId(): string {
  return `seg_${Date.now()}_${++segmentCounter}`;
}

export function useLiveTranscription(): UseLiveTranscriptionReturn {
  const [state, setState] = useState<LiveTranscriptionState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalSegments, setFinalSegments] = useState<LiveTranscriptionSegment[]>([]);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [consentAcknowledged, setConsentAcknowledged] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("callflow_mic_consent") === "1";
  });

  // Refs for cleanup and deduplication
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedRef = useRef(0);
  const isStoppingRef = useRef(false);
  const seenFinalTextsRef = useRef<Set<string>>(new Set());
  const pcmBufferRef = useRef<Float32Array[]>([]);
  const pcmBufferLenRef = useRef(0);

  // Compute full transcript from final segments
  const finalTranscript = finalSegments.map((s) => s.text).join("\n");

  // ── Cleanup helpers ───────────────────────────────────────────────────────

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    elapsedRef.current = 0;
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
    }, 1000);
  }, [stopTimer]);

  const releaseAudio = useCallback(() => {
    // Disconnect audio graph
    try {
      processorRef.current?.disconnect();
    } catch {}
    try {
      sourceRef.current?.disconnect();
    } catch {}
    processorRef.current = null;
    sourceRef.current = null;

    // Close AudioContext
    try {
      audioContextRef.current?.close();
    } catch {}
    audioContextRef.current = null;

    // Stop all microphone tracks
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    // Clear PCM buffer
    pcmBufferRef.current = [];
    pcmBufferLenRef.current = 0;
  }, []);

  const closeWebSocket = useCallback((sendStop = true) => {
    const ws = wsRef.current;
    if (!ws) return;
    wsRef.current = null;

    if (sendStop && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ control: "stop" }));
      } catch {}
    }

    try {
      ws.close();
    } catch {}
  }, []);

  // Cleanup on unmount (should not normally happen during a call)
  useEffect(() => {
    return () => {
      stopTimer();
      releaseAudio();
      closeWebSocket(true);
    };
  }, [stopTimer, releaseAudio, closeWebSocket]);

  // ── Core: send buffered PCM via WebSocket ────────────────────────────────

  const flushPcmBuffer = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (pcmBufferLenRef.current === 0) return;

    // Concatenate buffered chunks
    const merged = new Float32Array(pcmBufferLenRef.current);
    let offset = 0;
    for (const chunk of pcmBufferRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pcmBufferRef.current = [];
    pcmBufferLenRef.current = 0;

    const pcmBuffer = float32ToInt16(merged);
    const b64 = arrayBufferToBase64(pcmBuffer);

    try {
      ws.send(JSON.stringify({ audio: b64 }));
    } catch (err) {
      console.warn("[useLiveTranscription] Failed to send audio chunk:", err);
    }
  }, []);

  // ── Start Recording ───────────────────────────────────────────────────────

  const startRecording = useCallback(async (callId: string) => {
    if (state === "recording" || state === "connecting") {
      return; // Prevent double-start
    }

    setError(null);
    isStoppingRef.current = false;
    seenFinalTextsRef.current = new Set();

    // 1. Request microphone permission
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      const e = err as DOMException;
      let msg = `Could not access microphone: ${e.message}`;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        msg =
          "Microphone access was denied. Allow microphone access in your browser settings and try again.";
      } else if (e.name === "NotFoundError") {
        msg = "No microphone found. Connect a microphone and try again.";
      }
      setError(msg);
      setState("error");
      return;
    }

    streamRef.current = stream;

    // 2. Open WebSocket connection
    setState("connecting");
    const wsUrl = getWebSocketUrl(callId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Wait for WebSocket to connect or fail
    const wsConnected = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 10_000);
      ws.onopen = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });

    if (!wsConnected || ws.readyState !== WebSocket.OPEN) {
      releaseAudio();
      wsRef.current = null;
      setError(
        "Failed to connect to transcription server. Check that the backend is running."
      );
      setState("error");
      return;
    }

    // 3. Set up WebSocket message handler
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        const type = msg.type as string;

        if (type === "connected") {
          // Already handled — state is already "recording"
        } else if (type === "interim") {
          setInterimText(msg.text || "");
        } else if (type === "final") {
          const text = (msg.text || "").trim();
          if (text && !seenFinalTextsRef.current.has(text)) {
            seenFinalTextsRef.current.add(text);
            const segment: LiveTranscriptionSegment = {
              id: nextSegmentId(),
              type: "final",
              text,
              timestamp: Date.now(),
            };
            setFinalSegments((prev) => [...prev, segment]);
            setInterimText(""); // Clear interim when final arrives
          }
        } else if (type === "done") {
          setInterimText("");
          if (!isStoppingRef.current) {
            // Server initiated close
            setState("idle");
            stopTimer();
            releaseAudio();
            wsRef.current = null;
          }
        } else if (type === "error") {
          setError(msg.message || "Transcription error");
          setState("error");
          stopTimer();
          releaseAudio();
          wsRef.current = null;
        }
      } catch {
        // Non-JSON message — ignore
      }
    };

    ws.onclose = () => {
      if (!isStoppingRef.current && state !== "idle") {
        // Unexpected closure
        setError(
          "Connection to transcription server lost. Transcript data is preserved."
        );
        setState("error");
        stopTimer();
        releaseAudio();
        wsRef.current = null;
      }
    };

    // 4. Set up AudioContext with resampler
    try {
      // Use the browser's native sample rate, then resample to 16 kHz
      const nativeSampleRate = stream.getAudioTracks()[0]?.getSettings()?.sampleRate || 44100;
      const audioContext = new AudioContext({ sampleRate: nativeSampleRate });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Resample buffer: we accumulate downsampled samples and send when we
      // have CHUNK_SAMPLES worth of 16 kHz audio
      const downsampleRatio = nativeSampleRate / TARGET_SAMPLE_RATE;
      const nativeChunkSize = Math.ceil(CHUNK_SAMPLES * downsampleRatio);
      const bufferSize = Math.max(256, Math.min(16384, nativeChunkSize * 2));

      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      let residualSamples: Float32Array = new Float32Array(0);
      let residualPhase = 0.0;

      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const inputData = event.inputBuffer.getChannelData(0);

        // Simple linear interpolation downsampling
        const outputLength = Math.floor(
          (inputData.length + residualSamples.length) / downsampleRatio
        );
        if (outputLength === 0) return;

        const resampled = new Float32Array(outputLength);
        let outIdx = 0;

        // Concatenate residual + new input for continuous interpolation
        const allSamples = new Float32Array(
          residualSamples.length + inputData.length
        );
        allSamples.set(residualSamples);
        allSamples.set(inputData, residualSamples.length);

        let phase = residualPhase;
        while (phase + 1 < allSamples.length && outIdx < outputLength) {
          const idx = Math.floor(phase);
          const frac = phase - idx;
          const s0 = allSamples[idx];
          const s1 = idx + 1 < allSamples.length ? allSamples[idx + 1] : s0;
          resampled[outIdx++] = s0 + frac * (s1 - s0);
          phase += downsampleRatio;
        }

        // Save leftover samples and phase for next callback
        const consumedInput = Math.floor(phase);
        residualSamples = allSamples.slice(consumedInput);
        residualPhase = phase - consumedInput;

        const actualResampled = resampled.slice(0, outIdx);

        // Buffer and send in chunks
        pcmBufferRef.current.push(actualResampled);
        pcmBufferLenRef.current += actualResampled.length;

        if (pcmBufferLenRef.current >= CHUNK_SAMPLES) {
          flushPcmBuffer();
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error("[useLiveTranscription] AudioContext setup failed:", err);
      closeWebSocket(true);
      releaseAudio();
      setError("Failed to set up audio capture.");
      setState("error");
      return;
    }

    // 5. Start timer and transition to recording state
    startTimer();
    setState("recording");
  }, [
    state,
    releaseAudio,
    closeWebSocket,
    flushPcmBuffer,
    startTimer,
    stopTimer,
  ]);

  // ── Stop Recording ────────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (state !== "recording" && state !== "connecting") return;

    isStoppingRef.current = true;
    setState("stopping");
    stopTimer();

    // Flush any remaining buffered audio
    flushPcmBuffer();

    // Release mic and audio graph immediately
    releaseAudio();

    // Send stop control message and close WebSocket
    closeWebSocket(true);

    // Transition to idle after a short grace period for the final response
    setTimeout(() => {
      setState("idle");
      setInterimText("");
    }, 2000);
  }, [state, stopTimer, flushPcmBuffer, releaseAudio, closeWebSocket]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    isStoppingRef.current = true;
    stopTimer();
    releaseAudio();
    closeWebSocket(true);
    seenFinalTextsRef.current = new Set();
    setFinalSegments([]);
    setInterimText("");
    setError(null);
    setElapsedSeconds(0);
    setState("idle");
  }, [stopTimer, releaseAudio, closeWebSocket]);

  // ── Consent ───────────────────────────────────────────────────────────────

  const acknowledgeConsent = useCallback(() => {
    sessionStorage.setItem("callflow_mic_consent", "1");
    setConsentAcknowledged(true);
  }, []);

  return {
    state,
    elapsedSeconds,
    finalSegments,
    interimText,
    finalTranscript,
    error,
    startRecording,
    stopRecording,
    reset,
    consentAcknowledged,
    acknowledgeConsent,
  };
}
