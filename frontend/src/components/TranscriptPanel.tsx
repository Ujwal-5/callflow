"use client";

/**
 * TranscriptPanel
 *
 * Integrates into the active-call screen alongside the existing stage panel.
 * Provides:
 *   - Ready state: explanation + "Start Recording" button
 *   - Recording state: live timer + Pause / Stop controls
 *   - Transcribing state: upload/processing spinner
 *   - Transcript available: editable text area + copy-to-exact-words button
 *   - Error state: message + Retry button
 *
 * Consent notice is shown once before the first recording.
 * Manual notes workflow is unaffected — this panel is additive.
 *
 * IMPORTANT: This panel only captures microphone audio available to the browser.
 * It cannot and does not capture telephone audio. Recording should only be done
 * with the appropriate consent of all parties involved.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { api } from "@/lib/api";
import { Transcript } from "@/types";

interface TranscriptPanelProps {
  callId: string;
  /** Called when the user clicks "Copy to Prospect's Exact Words" */
  onCopyToExactWords?: (text: string) => void;
  /** Pre-loaded transcript if the call already has one (e.g. on resume). */
  initialTranscript?: Transcript | null;
  /** Called when transcript is uploaded, transcribed, or edited */
  onTranscriptChange?: (text: string) => void;
}

// ── Format elapsed seconds as MM:SS ──────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ── Save status label ─────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

// ── Component ─────────────────────────────────────────────────────────────────

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  callId,
  onCopyToExactWords,
  initialTranscript = null,
  onTranscriptChange,
}) => {
  const recorder = useAudioRecorder();

  // Panel open/collapsed
  const [isOpen, setIsOpen] = useState(false);

  // Transcript from backend
  const [transcript, setTranscript] = useState<Transcript | null>(initialTranscript);

  // Transcribing = audio uploaded, waiting for response
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  // Editable text (driven by local state, not server)
  const [editedText, setEditedText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Debounce ref for autosave
  const saveDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Consent acknowledgement (stored in sessionStorage so it persists across stages)
  const [consentAcknowledged, setConsentAcknowledged] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("callflow_mic_consent") === "1";
  });

  // Track whether we've already uploaded this recording (prevent duplicates)
  const uploadedRef = useRef(false);

  // ── Fetch existing transcript on mount or when callId changes ─────────────
  useEffect(() => {
    let ignore = false;
    async function fetchExistingTranscript() {
      try {
        const existing = await api.getTranscript(callId);
        if (!ignore && existing) {
          setTranscript(existing);
          if (existing.status === "completed") {
            setIsOpen(true); // Automatically expand if a transcript already exists
          }
        }
      } catch {
        // Non-blocking
      }
    }
    fetchExistingTranscript();
    return () => {
      ignore = true;
    };
  }, [callId]);

  // ── Sync editedText when transcript arrives / changes ──────────────────────

  useEffect(() => {
    if (transcript) {
      // Show edited version if available, otherwise raw
      const displayed =
        transcript.edited_transcript ?? transcript.raw_transcript ?? "";
      setEditedText(displayed);
    }
  }, [transcript?.id, transcript?.edited_transcript, transcript?.raw_transcript]);

  // ── Auto-upload after recorder stops ────────────────────────────────────────

  useEffect(() => {
    if (
      recorder.state === "stopped" &&
      recorder.audioBlob &&
      !uploadedRef.current
    ) {
      uploadedRef.current = true;
      handleUpload(recorder.audioBlob, recorder.mimeType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state, recorder.audioBlob]);

  const handleUpload = useCallback(
    async (blob: Blob, mime: string) => {
      if (blob.size === 0) {
        setTranscribeError("The recording appears to be empty. Please try again.");
        return;
      }

      setIsTranscribing(true);
      setTranscribeError(null);

      try {
        const result = await api.uploadAndTranscribe(callId, blob, mime);
        setTranscript(result);
        if (result.status === "failed") {
          setTranscribeError(result.error_message || "Transcription failed.");
        } else if (onTranscriptChange) {
          const text = result.edited_transcript ?? result.raw_transcript ?? "";
          if (text) onTranscriptChange(text);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to transcribe audio.";
        setTranscribeError(msg);
      } finally {
        setIsTranscribing(false);
      }
    },
    [callId, onTranscriptChange]
  );

  // ── Autosave edited transcript (debounced) ────────────────────────────────

  const handleEditChange = useCallback(
    (value: string) => {
      setEditedText(value);
      setSaveStatus("saving");
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(async () => {
        try {
          const saved = await api.saveEditedTranscript(callId, value);
          setTranscript(saved);
          setSaveStatus("saved");
          if (onTranscriptChange) {
            const text = saved.edited_transcript ?? saved.raw_transcript ?? value;
            if (text) onTranscriptChange(text);
          }
        } catch {
          setSaveStatus("error");
        }
      }, 800);
    },
    [callId, onTranscriptChange]
  );

  // ── Retry ─────────────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    uploadedRef.current = false;
    setTranscribeError(null);
    setTranscript(null);
    recorder.reset();
  }, [recorder]);

  // ── Consent acknowledgement ───────────────────────────────────────────────

  const acknowledgeConsent = useCallback(() => {
    sessionStorage.setItem("callflow_mic_consent", "1");
    setConsentAcknowledged(true);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const hasTranscript =
    transcript?.status === "completed" &&
    transcript.raw_transcript !== null;

  const transcriptText = hasTranscript
    ? (transcript!.edited_transcript ?? transcript!.raw_transcript ?? "")
    : "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-[#233554] bg-[#0b132b] shadow-xl mt-4">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
      >
        <div className="flex items-center space-x-2">
          {/* Mic icon */}
          <svg
            className="h-4 w-4 text-[#0062ff]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 3a4 4 0 014 4v4a4 4 0 01-8 0V7a4 4 0 014-4z"
            />
          </svg>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Audio Transcription
          </span>
          {/* Status badge */}
          {recorder.state === "recording" && (
            <span className="flex items-center space-x-1 rounded bg-rose-950/60 border border-rose-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
              <span>REC {formatDuration(recorder.elapsedSeconds)}</span>
            </span>
          )}
          {recorder.state === "paused" && (
            <span className="rounded bg-amber-950/50 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
              Paused {formatDuration(recorder.elapsedSeconds)}
            </span>
          )}
          {isTranscribing && (
            <span className="rounded bg-blue-950/50 border border-blue-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400 animate-pulse">
              Transcribing…
            </span>
          )}
          {hasTranscript && (
            <span className="rounded bg-emerald-950/50 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              ✓ Transcript ready
            </span>
          )}
        </div>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div className="border-t border-[#233554] p-5 space-y-4">
          {/* Consent notice — shown once */}
          {!consentAcknowledged && (
            <div className="rounded border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-300 space-y-2">
              <p className="font-semibold">Before you record</p>
              <p>
                This feature captures <strong>your microphone audio only</strong> —
                it cannot record telephone or VoIP audio that the browser has no
                access to. Only record with the appropriate consent of all parties
                on the call, in accordance with applicable laws in your jurisdiction.
              </p>
              <button
                type="button"
                onClick={acknowledgeConsent}
                className="rounded bg-amber-600/80 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-500 transition-colors"
              >
                I understand — continue
              </button>
            </div>
          )}

          {consentAcknowledged && (
            <>
              {/* ── IDLE / READY state ── */}
              {(recorder.state === "idle" || recorder.state === "ready") &&
                !isTranscribing &&
                !hasTranscript &&
                !transcribeError && (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Record your conversation. When you stop, the audio is sent
                      to the server for automatic transcription using Gemini.
                      Manual notes remain available throughout.
                    </p>
                    <button
                      type="button"
                      onClick={() => recorder.startRecording()}
                      className="flex items-center space-x-2 rounded bg-[#0062ff] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0052d9] transition-colors"
                    >
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="8" />
                      </svg>
                      <span>Start Recording</span>
                    </button>
                    {recorder.error && (
                      <p className="text-xs text-rose-400">{recorder.error}</p>
                    )}
                  </div>
                )}

              {/* ── REQUESTING state ── */}
              {recorder.state === "requesting" && (
                <p className="text-xs text-slate-400 animate-pulse">
                  Requesting microphone permission…
                </p>
              )}

              {/* ── RECORDING state ── */}
              {recorder.state === "recording" && (
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <span className="flex items-center space-x-1.5 text-sm font-mono text-rose-400">
                      <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
                      <span>{formatDuration(recorder.elapsedSeconds)}</span>
                    </span>
                    <span className="text-xs text-slate-400">Recording…</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => recorder.pauseRecording()}
                      className="rounded border border-amber-500/40 bg-amber-950/30 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-900/40 transition-colors"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      onClick={() => recorder.stopRecording()}
                      className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/40 transition-colors"
                    >
                      Stop & Transcribe
                    </button>
                  </div>
                </div>
              )}

              {/* ── PAUSED state ── */}
              {recorder.state === "paused" && (
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <span className="font-mono text-sm text-amber-400">
                      {formatDuration(recorder.elapsedSeconds)}
                    </span>
                    <span className="text-xs text-slate-400">Paused</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => recorder.resumeRecording()}
                      className="rounded bg-[#0062ff] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0052d9] transition-colors"
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => recorder.stopRecording()}
                      className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/40 transition-colors"
                    >
                      Stop & Transcribe
                    </button>
                  </div>
                </div>
              )}

              {/* ── TRANSCRIBING state ── */}
              {isTranscribing && (
                <div className="flex items-center space-x-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0062ff] border-t-transparent" />
                  <span className="text-xs text-slate-400">
                    Uploading and transcribing audio…
                  </span>
                </div>
              )}

              {/* ── ERROR state ── */}
              {transcribeError && !isTranscribing && (
                <div className="rounded border border-rose-500/30 bg-rose-950/20 p-3 space-y-2">
                  <p className="text-xs font-semibold text-rose-300">Transcription failed</p>
                  <p className="text-xs text-rose-400">{transcribeError}</p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="rounded bg-rose-800/60 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 transition-colors"
                  >
                    Retry Recording
                  </button>
                </div>
              )}

              {/* ── TRANSCRIPT AVAILABLE state ── */}
              {hasTranscript && !isTranscribing && (
                <div className="space-y-3">
                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Transcript
                      {transcript!.edited_transcript !== null && (
                        <span className="ml-2 text-[9px] font-normal text-slate-500 normal-case">
                          (edited)
                        </span>
                      )}
                    </label>
                    <span className="text-[10px] text-slate-500">
                      {saveStatus === "saving" && (
                        <span className="animate-pulse text-slate-400">Saving…</span>
                      )}
                      {saveStatus === "saved" && (
                        <span className="text-emerald-500">Saved</span>
                      )}
                      {saveStatus === "error" && (
                        <span className="text-rose-400">Save failed</span>
                      )}
                      {saveStatus === "idle" && "Auto-saved"}
                    </span>
                  </div>

                  {/* Editable transcript */}
                  <textarea
                    rows={6}
                    value={editedText}
                    onChange={(e) => handleEditChange(e.target.value)}
                    placeholder="Transcript will appear here…"
                    className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-slate-400 focus:outline-none resize-y"
                  />

                  {editedText !== (transcript!.raw_transcript ?? "") &&
                    transcript!.raw_transcript && (
                      <details className="text-[10px] text-slate-500">
                        <summary className="cursor-pointer hover:text-slate-400">
                          View original transcript
                        </summary>
                        <p className="mt-1 rounded border border-[#233554] bg-[#070d1e] p-2 leading-relaxed whitespace-pre-wrap">
                          {transcript!.raw_transcript}
                        </p>
                      </details>
                    )}

                  {/* Action row */}
                  <div className="flex flex-wrap items-center gap-2">
                    {onCopyToExactWords && editedText && (
                      <button
                        type="button"
                        onClick={() => onCopyToExactWords(editedText)}
                        className="flex items-center space-x-1.5 rounded border border-[#0062ff]/50 bg-[#0062ff]/10 px-3 py-1.5 text-[11px] font-semibold text-[#60a5fa] hover:bg-[#0062ff]/20 transition-colors"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span>Copy to Prospect's Exact Words</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="rounded border border-[#233554] px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                    >
                      New Recording
                    </button>
                  </div>
                </div>
              )}

              {/* Empty transcript (silence detected) */}
              {transcript?.status === "completed" &&
                transcript.raw_transcript === "" &&
                !isTranscribing && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400">
                      No speech detected in the recording. The audio may have been
                      silent or too quiet.
                    </p>
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="rounded border border-[#233554] px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
