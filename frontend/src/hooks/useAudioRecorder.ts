"use client";

/**
 * useAudioRecorder — MediaRecorder-based audio capture hook.
 *
 * Responsibilities:
 * - Request microphone permission only on explicit user action.
 * - Manage MediaRecorder start / pause / resume / stop lifecycle.
 * - Collect recorded chunks and expose a final Blob + MIME type.
 * - Track elapsed recording time in seconds.
 * - Stop all microphone tracks on cleanup (unmount or recording end).
 * - Never autostart recording.
 *
 * Recording does NOT capture telephone audio — it only captures microphone
 * input available to the browser. Ensure appropriate consent from all
 * parties before recording.
 */

import { useState, useRef, useCallback, useEffect } from "react";

export type RecorderState =
  | "idle"       // no recording in progress, no permission requested
  | "requesting" // waiting for mic permission
  | "ready"      // permission granted, not yet recording
  | "recording"  // actively recording
  | "paused"     // paused mid-recording
  | "stopped";   // recording stopped, blob available

export interface UseAudioRecorderReturn {
  state: RecorderState;
  /** Elapsed seconds since recording started (excluding paused time). */
  elapsedSeconds: number;
  /** The recorded audio blob (only non-null after recording is stopped). */
  audioBlob: Blob | null;
  /** MIME type of the recording (browser-dependent). */
  mimeType: string;
  /** Human-readable error (permission denied, unsupported browser, etc.). */
  error: string | null;
  /** Request microphone permission (only requests, does not start recording). */
  requestPermission: () => Promise<void>;
  /** Start recording. Requests permission first if not yet granted. */
  startRecording: () => Promise<void>;
  /** Pause an active recording. */
  pauseRecording: () => void;
  /** Resume a paused recording. */
  resumeRecording: () => void;
  /** Stop recording and make the audio blob available. */
  stopRecording: () => void;
  /** Discard the current recording and reset to idle. */
  reset: () => void;
}

/** Ordered list of MIME types to try with MediaRecorder (most preferred first). */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  // Fallback: let the browser choose
  return "";
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [mimeType, setMimeType] = useState("");
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedRef = useRef(0);

  // ── Cleanup helpers ──────────────────────────────────────────────────────

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
    }, 1000);
  }, [stopTimer]);

  // Stop mic tracks and clean up timer on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      stopTracks();
    };
  }, [stopTimer, stopTracks]);

  // ── Permission ───────────────────────────────────────────────────────────

  const requestPermission = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "Microphone recording is not supported in this browser. " +
        "Try Chrome, Edge, or Firefox."
      );
      return;
    }

    setState("requesting");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop tracks immediately — we only wanted to verify permission
      stream.getTracks().forEach((t) => t.stop());
      setState("ready");
    } catch (err) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setError(
          "Microphone access was denied. " +
          "Allow microphone access in your browser settings and try again."
        );
      } else if (e.name === "NotFoundError") {
        setError("No microphone found. Connect a microphone and try again.");
      } else {
        setError(`Could not access microphone: ${e.message}`);
      }
      setState("idle");
    }
  }, []);

  // ── Start recording ──────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "Microphone recording is not supported in this browser. " +
        "Try Chrome, Edge, or Firefox."
      );
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setError(
        "Your browser does not support audio recording (MediaRecorder API). " +
        "Try Chrome, Edge, or Firefox."
      );
      return;
    }

    setError(null);
    setState("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setError(
          "Microphone access was denied. " +
          "Allow microphone access in your browser settings and try again."
        );
      } else if (e.name === "NotFoundError") {
        setError("No microphone found. Connect a microphone and try again.");
      } else {
        setError(`Could not access microphone: ${e.message}`);
      }
      setState("idle");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const chosenMimeType = getSupportedMimeType();
    setMimeType(chosenMimeType || "audio/webm");

    const recorderOptions = chosenMimeType ? { mimeType: chosenMimeType } : {};
    const recorder = new MediaRecorder(stream, recorderOptions);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      stopTimer();
      stopTracks();
      const finalMime = recorder.mimeType || chosenMimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: finalMime });
      setMimeType(finalMime);
      setAudioBlob(blob);
      setState("stopped");
    };

    recorder.onerror = () => {
      stopTimer();
      stopTracks();
      setError("Recording encountered an error and was stopped.");
      setState("idle");
    };

    // Collect data every second so we don't lose chunks on abrupt stop
    recorder.start(1000);
    elapsedRef.current = 0;
    setElapsedSeconds(0);
    startTimer();
    setState("recording");
  }, [stopTimer, stopTracks, startTimer]);

  // ── Pause / Resume ───────────────────────────────────────────────────────

  const pauseRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      stopTimer();
      setState("paused");
    }
  }, [stopTimer]);

  const resumeRecording = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      startTimer();
      setState("recording");
    }
  }, [startTimer]);

  // ── Stop ─────────────────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (
      recorderRef.current &&
      (recorderRef.current.state === "recording" ||
        recorderRef.current.state === "paused")
    ) {
      recorderRef.current.stop(); // triggers recorder.onstop
    }
  }, []);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    stopTimer();
    stopTracks();
    if (
      recorderRef.current &&
      (recorderRef.current.state === "recording" ||
        recorderRef.current.state === "paused")
    ) {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    elapsedRef.current = 0;
    setAudioBlob(null);
    setElapsedSeconds(0);
    setMimeType("");
    setError(null);
    setState("idle");
  }, [stopTimer, stopTracks]);

  return {
    state,
    elapsedSeconds,
    audioBlob,
    mimeType,
    error,
    requestPermission,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    reset,
  };
}
