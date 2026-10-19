"use client";

/**
 * TranscriptPanel (Live Streaming Version)
 *
 * This component receives the recording state from the parent via props
 * (not from a locally-owned hook) so that recording survives stage navigation.
 *
 * The parent (page.tsx) owns the useLiveTranscription hook and passes
 * the relevant state down. The panel only provides UI.
 *
 * Features:
 * - Shows connected / recording / stopping / error states
 * - Displays live interim text as it streams
 * - Displays finalized transcript segments
 * - Allows editing and copying finalized transcript
 * - Consent notice shown once per session
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { Transcript } from "@/types";
import type { LiveTranscriptionState, LiveTranscriptionSegment } from "@/hooks/useLiveTranscription";

interface TranscriptPanelProps {
  callId: string;

  // ── Live transcription state (owned by parent) ──
  recordingState: LiveTranscriptionState;
  elapsedSeconds: number;
  finalSegments: LiveTranscriptionSegment[];
  interimText: string;
  finalTranscript: string;
  transcriptionError: string | null;
  consentAcknowledged: boolean;

  // ── Callbacks ──
  onStartRecording: () => void;
  onStopRecording: () => void;
  onAcknowledgeConsent: () => void;
  /** Applies a caller-selected transcript passage to the active stage. */
  onTranscriptSelection?: (text: string) => void;
  /** Exact source passage to reveal in the transcript. */
  highlightText?: string | null;
  /** Called when transcript text changes (for stage suggestion updates) */
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
  recordingState,
  elapsedSeconds,
  interimText,
  finalTranscript,
  transcriptionError,
  consentAcknowledged,
  onStartRecording,
  onStopRecording,
  onAcknowledgeConsent,
  onTranscriptSelection,
  highlightText,
  onTranscriptChange,
}) => {
  // Panel open/collapsed
  const [isOpen, setIsOpen] = useState(true);

  // Existing persisted transcript (from before live recording)
  const [savedTranscript, setSavedTranscript] = useState<Transcript | null>(null);

  // Editable text (from the saved transcript, not the live stream)
  const [editedText, setEditedText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const hasManualEditsRef = useRef(false);
  const lastSyncedTranscriptRef = useRef("");
  const transcriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!highlightText || !transcriptTextareaRef.current) return;
    const transcript = editedText || finalTranscript;
    const start = transcript.toLowerCase().indexOf(highlightText.toLowerCase());
    if (start < 0) return;
    const input = transcriptTextareaRef.current;
    input.focus();
    input.setSelectionRange(start, start + highlightText.length);
    input.scrollTop = Math.max(0, (start / Math.max(transcript.length, 1)) * input.scrollHeight - input.clientHeight / 2);
  }, [highlightText, editedText, finalTranscript]);

  // ── Fetch existing transcript on mount or callId changes ─────────────────
  useEffect(() => {
    let ignore = false;
    async function fetchExisting() {
      try {
        const existing = await api.getTranscript(callId);
        if (!ignore && existing) {
          setSavedTranscript(existing);
          if (existing.status === "completed") {
            setIsOpen(true);
            const text =
              existing.edited_transcript ?? existing.raw_transcript ?? "";
            setEditedText(text);
          }
        }
      } catch {
        // Non-blocking
      }
    }
    fetchExisting();
    return () => {
      ignore = true;
    };
  }, [callId]);

  // ── Sync editedText when live finalTranscript changes ────────────────────
  useEffect(() => {
    if (!finalTranscript) return;
    const previousTranscript = lastSyncedTranscriptRef.current;
    if (!hasManualEditsRef.current) {
      setEditedText(finalTranscript);
    } else if (
      previousTranscript && finalTranscript.startsWith(previousTranscript) &&
      finalTranscript.length > previousTranscript.length
    ) {
      const newlyFinalizedText = finalTranscript.slice(previousTranscript.length).trim();
      if (newlyFinalizedText) {
        setEditedText((previous) => `${previous.trimEnd()}\n${newlyFinalizedText}`.trim());
      }
    }
    lastSyncedTranscriptRef.current = finalTranscript;
    onTranscriptChange?.(finalTranscript);
  }, [finalTranscript, savedTranscript, onTranscriptChange]);

  // ── Auto-open when recording starts ──────────────────────────────────────
  useEffect(() => {
    if (recordingState === "recording" || recordingState === "connecting") {
      setIsOpen(true);
    }
  }, [recordingState]);

  // ── Autosave edited transcript (debounced) ────────────────────────────────
  const handleEditChange = useCallback(
    (value: string) => {
      hasManualEditsRef.current = true;
      setEditedText(value);
      const isCapturing = ["recording", "connecting", "stopping"].includes(recordingState);
      setSaveStatus(isCapturing ? "idle" : "saving");
      onTranscriptChange?.(value);
    },
    [recordingState, onTranscriptChange]
  );

  // Save edits after capture has stopped. While the microphone is active,
  // keep edits local so we don't race transcript creation on the server.
  useEffect(() => {
    if (["recording", "connecting", "stopping"].includes(recordingState) || !hasManualEditsRef.current || !editedText.trim()) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(async () => {
      try {
        const saved = await api.saveEditedTranscript(callId, editedText);
        setSavedTranscript(saved);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 800);
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    };
  }, [callId, editedText, recordingState]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const isRecording = recordingState === "recording";
  const isConnecting = recordingState === "connecting" || recordingState === "requesting";
  const isStopping = recordingState === "stopping";
  const isIdle = recordingState === "idle";
  const isError = recordingState === "error";

  const hasLiveTranscript = finalTranscript.length > 0;
  const hasSavedTranscript =
    savedTranscript?.status === "completed" &&
    savedTranscript.raw_transcript !== null;

  const displayText =
    editedText ||
    (hasSavedTranscript
      ? savedTranscript!.edited_transcript ?? savedTranscript!.raw_transcript ?? ""
      : "");

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
            Live Transcription
          </span>

          {/* Status badges */}
          {isConnecting && (
            <span className="rounded bg-blue-950/50 border border-blue-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400 animate-pulse">
              Connecting…
            </span>
          )}
          {isRecording && (
            <span className="flex items-center space-x-1 rounded bg-rose-950/60 border border-rose-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
              <span>● LIVE {formatDuration(elapsedSeconds)}</span>
            </span>
          )}
          {isStopping && (
            <span className="rounded bg-amber-950/50 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 animate-pulse">
              Finishing…
            </span>
          )}
          {isError && (
            <span className="rounded bg-rose-950/50 border border-rose-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
              ⚠ Error
            </span>
          )}
          {isIdle && hasLiveTranscript && (
            <span className="rounded bg-emerald-950/50 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              ✓ Transcript ready
            </span>
          )}
          {isIdle && hasSavedTranscript && !hasLiveTranscript && (
            <span className="rounded bg-emerald-950/50 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              ✓ Saved transcript
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
                onClick={onAcknowledgeConsent}
                className="rounded bg-amber-600/80 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-500 transition-colors"
              >
                I understand — continue
              </button>
            </div>
          )}

          {consentAcknowledged && (
            <>
              {/* ── IDLE: Start Recording button ── */}
              {isIdle && !hasLiveTranscript && !hasSavedTranscript && !isError && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Start live transcription to capture the conversation in real time.
                    The audio is processed on the server — your API keys never leave the backend.
                    Recording continues across all 8 stages without interruption.
                  </p>
                  <button
                    type="button"
                    onClick={onStartRecording}
                    className="flex items-center space-x-2 rounded bg-[#0062ff] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0052d9] transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="8" />
                    </svg>
                    <span>Start Live Transcription</span>
                  </button>
                </div>
              )}

              {/* ── CONNECTING state ── */}
              {isConnecting && (
                <div className="flex items-center space-x-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0062ff] border-t-transparent" />
                  <span className="text-xs text-slate-400">
                    {recordingState === "requesting"
                      ? "Requesting microphone permission…"
                      : transcriptionError
                      ? "Live connection interrupted. Reconnecting; microphone audio is being buffered…"
                      : "Connecting to transcription server…"}
                  </span>
                </div>
              )}

              {/* ── RECORDING state ── */}
              {isRecording && (
                <div className="space-y-3">
                  {/* Timer & status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="flex items-center space-x-1.5 text-sm font-mono text-rose-400">
                        <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
                        <span>{formatDuration(elapsedSeconds)}</span>
                      </span>
                      <span className="text-xs text-slate-400">
                        Live transcription active — navigate freely between stages
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={onStopRecording}
                      className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/40 transition-colors"
                    >
                      Stop Recording
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Live Transcript</label>
                    <textarea
                      ref={transcriptTextareaRef}
                      rows={5}
                      value={editedText || finalTranscript}
                      onChange={(event) => handleEditChange(event.target.value)}
                      onMouseUp={(event) => {
                        const input = event.currentTarget;
                        const selection = input.value.slice(input.selectionStart, input.selectionEnd).trim();
                        if (selection) onTranscriptSelection?.(selection);
                      }}
                      placeholder="Listening… Start speaking to see live transcription"
                      className="w-full min-h-[100px] max-h-64 rounded border border-[#233554] bg-[#070d1e] p-3 text-xs leading-relaxed text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none resize-y"
                    />
                    {interimText && <p className="text-xs italic text-slate-500">Hearing: {interimText}</p>}
                  </div>
                </div>
              )}

              {/* ── STOPPING state ── */}
              {isStopping && (
                <div className="flex items-center space-x-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                  <span className="text-xs text-slate-400">
                    Finishing transcription…
                  </span>
                </div>
              )}

              {/* ── ERROR state ── */}
              {isError && (
                <div className="rounded border border-rose-500/30 bg-rose-950/20 p-3 space-y-2">
                  <p className="text-xs font-semibold text-rose-300">Transcription error</p>
                  {transcriptionError && (
                    <p className="text-xs text-rose-400">{transcriptionError}</p>
                  )}
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={onStartRecording}
                      className="rounded bg-rose-800/60 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 transition-colors"
                    >
                      Retry Recording
                    </button>
                    {hasLiveTranscript && (
                      <span className="text-[10px] text-slate-400">
                        Transcript data preserved above
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* ── LIVE TRANSCRIPT AVAILABLE (after stop or during idle with data) ── */}
              {(hasLiveTranscript || hasSavedTranscript) && !isRecording && !isStopping && !isConnecting && (
                <div className="space-y-3">
                  {/* Show live transcript if available */}
                  {hasLiveTranscript && (
                    <>
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                          Live Transcript
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
                        </span>
                      </div>

                      <textarea
                        ref={transcriptTextareaRef}
                        rows={6}
                        value={editedText || finalTranscript}
                        onChange={(event) => handleEditChange(event.target.value)}
                        onMouseUp={(event) => {
                          const input = event.currentTarget;
                          const selection = input.value.slice(input.selectionStart, input.selectionEnd).trim();
                          if (selection) onTranscriptSelection?.(selection);
                        }}
                        className="w-full resize-y rounded border border-[#233554] bg-[#070d1e] p-3 text-xs leading-relaxed text-slate-200 focus:border-blue-500 focus:outline-none"
                      />

                    </>
                  )}

                  {/* Show saved transcript if no live transcript */}
                  {hasSavedTranscript && !hasLiveTranscript && (
                    <>
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                          Transcript
                          {savedTranscript!.edited_transcript !== null && (
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
                      <textarea
                        ref={transcriptTextareaRef}
                        rows={6}
                        value={displayText}
                        onChange={(event) => handleEditChange(event.target.value)}
                        onMouseUp={(event) => {
                          const input = event.currentTarget;
                          const selection = input.value.slice(input.selectionStart, input.selectionEnd).trim();
                          if (selection) onTranscriptSelection?.(selection);
                        }}
                        placeholder="Transcript will appear here…"
                        className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-y"
                      />
                    </>
                  )}

                  {/* Action row */}
                  <div className="flex flex-wrap items-center gap-2">
                    {isIdle && (
                      <button
                        type="button"
                        onClick={onStartRecording}
                        className="rounded border border-[#0062ff]/40 bg-[#0062ff]/10 px-3 py-1.5 text-[11px] text-[#60a5fa] hover:bg-[#0062ff]/20 transition-colors"
                      >
                        {hasLiveTranscript || hasSavedTranscript
                          ? "Continue Recording"
                          : "Start Recording"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
