"use client";

import React, { useState, useEffect, useRef } from "react";
import { Call, StageDefinition, Transcript } from "@/types";
import { api } from "@/lib/api";
import { ConversationReview } from "@/components/ConversationReview";

interface CallDetailModalProps {
  call: Call | null;
  stages: StageDefinition[];
  onClose: () => void;
  onResumeCall?: (call: Call) => void;
  /**
   * When true the modal was just opened from a freshly-closed call and Gemini
   * analysis is running in the background (triggered by the parent).
   */
  isAutoAnalyzing?: boolean;
  /** Called when the user clicks "Retry Analysis" from the AI summary error state */
  onRetryAnalysis?: () => void;
  /** AI-summary error passed in from the parent after auto-analysis attempt */
  autoAnalysisError?: string | null;
  onDeleteCall?: (callId: string) => void | Promise<void>;
}

export const CallDetailModal: React.FC<CallDetailModalProps> = ({
  call,
  stages,
  onClose,
  onResumeCall,
  onDeleteCall,
  isAutoAnalyzing = false,
  onRetryAnalysis,
  autoAnalysisError = null,
}) => {
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [currentCall, setCurrentCall] = useState<Call | null>(call);
  const [callTranscript, setCallTranscript] = useState<Transcript | null>(null);
  const [notesExpanded, setNotesExpanded] = useState(false);

  // Track whether we've already synced the summary from the auto-analysis prop
  const prevAutoAnalyzingRef = useRef(isAutoAnalyzing);

  // Sync incoming call prop changes (e.g. parent updates ai_summary after auto-analysis)
  useEffect(() => {
    setCurrentCall(call);
  }, [call]);

  // When auto-analysis finishes (isAutoAnalyzing flips from true→false), the parent
  // passes the updated call with ai_summary populated — handled via the above effect.
  useEffect(() => {
    prevAutoAnalyzingRef.current = isAutoAnalyzing;
  }, [isAutoAnalyzing]);

  useEffect(() => {
    if (call?.id) {
      api.getTranscript(call.id).then(setCallTranscript).catch(() => {});
    }
  }, [call?.id]);

  // Merge external error into local aiError
  useEffect(() => {
    if (autoAnalysisError) setAiError(autoAnalysisError);
  }, [autoAnalysisError]);

  if (!call || !currentCall) return null;

  const handleGenerateSummary = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    try {
      const res = await api.generateCallSummary(currentCall.id);
      if (res.available && res.summary) {
        setCurrentCall({ ...currentCall, ai_summary: res.summary });
      } else if (res.error) {
        setAiError(res.error);
      }
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : "Failed to generate AI summary.");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const formatDateTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return isoString;
    }
  };

  const stageResultsMap = new Map();
  (currentCall.stage_results || []).forEach((sr) => {
    stageResultsMap.set(sr.stage_number, sr);
  });

  // Count stages that have data for the compact heading
  const stagesWithData = stages.filter((s) => {
    const sr = stageResultsMap.get(s.stage_number);
    return sr && (sr.selected_outcome || sr.prospect_exact_words || sr.notes || sr.status === "skipped" || sr.status === "not_applicable");
  }).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-[#233554] bg-[#0b132b] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#233554] bg-[#101c3d] px-6 py-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#0062ff]">
                Historical Call Record
              </span>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                Read-only
              </span>
            </div>
            <h2 className="mt-1 text-xl font-bold text-white">
              {currentCall.company_name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-slate-300">
              {currentCall.contact_name && (
                <span>
                  <strong className="text-slate-400">Contact:</strong>{" "}
                  {currentCall.contact_name}
                </span>
              )}
              {currentCall.phone_number && (
                <span>
                  <strong className="text-slate-400">Phone:</strong>{" "}
                  {currentCall.phone_number}
                </span>
              )}
              <span>
                <strong className="text-slate-400">Recorded:</strong>{" "}
                {formatDateTime(currentCall.started_at)}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-[#233554] hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Outcome & Next Step Summary Box */}
          <div className="rounded border border-[#233554] bg-[#070d1e] p-4 space-y-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Final Call Outcome
                </span>
                <span className="mt-1 block font-semibold text-white">
                  {currentCall.final_outcome || "Not logged / In progress"}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Highest Stage Reached
                </span>
                <span className="mt-1 block font-mono font-semibold text-slate-200">
                  Stage {currentCall.highest_stage} of 8
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Next Action Agreed
                </span>
                <span className="mt-1 block text-slate-200">
                  {currentCall.next_action || "None specified"}
                </span>
                {currentCall.follow_up_time && (
                  <span className="mt-0.5 block text-[11px] text-[#3b82f6]">
                    Timing: {currentCall.follow_up_time} ({currentCall.follow_up_channel || "WhatsApp"})
                  </span>
                )}
              </div>
            </div>

            {/* Additional recorded non-linear outcomes */}
            {(currentCall.referral_name || currentCall.objection || currentCall.prospect_statement) && (
              <div className="border-t border-[#233554] pt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                {currentCall.referral_name && (
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-purple-300">
                      👥 Referred Contact
                    </span>
                    <span className="text-white font-medium">{currentCall.referral_name}</span>
                    {currentCall.referral_contact && (
                      <span className="block text-[11px] text-slate-400 font-mono">
                        {currentCall.referral_contact}
                      </span>
                    )}
                  </div>
                )}
                {currentCall.objection && (
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      🚫 Primary Objection
                    </span>
                    <span className="text-slate-200">{currentCall.objection}</span>
                  </div>
                )}
                {currentCall.prospect_statement && (
                  <div className={currentCall.referral_name && currentCall.objection ? "" : "sm:col-span-2"}>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-[#60a5fa]">
                      💬 Prospect&apos;s Words
                    </span>
                    <span className="italic text-slate-300">&ldquo;{currentCall.prospect_statement}&rdquo;</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Call Audio Transcript (if recorded) */}
          {callTranscript && callTranscript.status === "completed" && (
            <div className="rounded-lg border border-[#233554] bg-[#070d1e] p-4">
              <div className="flex items-center justify-between border-b border-[#233554] pb-2.5">
                <div className="flex items-center space-x-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30 text-xs">
                    🎤
                  </span>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Audio Call Transcript
                  </h3>
                </div>
                {callTranscript.edited_transcript && (
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                    User Edited
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
                {callTranscript.edited_transcript || callTranscript.raw_transcript || "No words transcribed."}
              </p>
              {callTranscript.edited_transcript && callTranscript.raw_transcript && (
                <details className="mt-2 text-[10px] text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-400">
                    View original audio-derived transcript
                  </summary>
                  <p className="mt-1 rounded border border-[#233554] bg-[#101c3d]/40 p-2 leading-relaxed whitespace-pre-wrap">
                    {callTranscript.raw_transcript}
                  </p>
                </details>
              )}
            </div>
          )}

          {/* AI Summary Section (Gemini) */}
          <div className="rounded-lg border border-[#233554] bg-[#101c3d]/50 p-4">
            <div className="flex items-center justify-between border-b border-[#233554] pb-3">
              <div className="flex items-center space-x-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-[#0062ff] text-white text-[11px]">
                  ✦
                </span>
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Gemini AI Summary & Action Analysis
                </h3>
              </div>

              {/* Show spinner when auto-analyzing, retry when error, or generate button when neither */}
              {isAutoAnalyzing ? (
                <span className="flex items-center space-x-1.5 text-[11px] text-[#60a5fa]">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>Analyzing…</span>
                </span>
              ) : !currentCall.ai_summary && (
                <button
                  type="button"
                  disabled={isGeneratingAi}
                  onClick={onRetryAnalysis || handleGenerateSummary}
                  className="rounded bg-[#0062ff] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#0052d9] transition-all disabled:opacity-60"
                >
                  {isGeneratingAi ? "Analyzing..." : aiError ? "↺ Retry" : "Generate AI Summary"}
                </button>
              )}
            </div>

            {/* Auto-analysis banner */}
            {isAutoAnalyzing && !currentCall.ai_summary && (
              <div className="mt-3 rounded border border-[#0062ff]/30 bg-[#0062ff]/10 px-3 py-2 text-xs text-slate-300">
                <span className="font-semibold text-white">Analyzing call…</span>{" "}
                Gemini is reviewing stage notes and transcript. The summary will appear here automatically.
              </div>
            )}

            {aiError && (
              <div className="mt-3 rounded border border-amber-500/50 bg-amber-950/40 p-2.5 text-xs text-amber-200">
                <span className="font-semibold">Notice:</span> {aiError}
              </div>
            )}

            {currentCall.ai_summary ? (
              <div className="mt-3 space-y-2.5 text-xs">
                <div>
                  <span className="block font-semibold text-slate-400">Executive Summary:</span>
                  <p className="mt-0.5 text-slate-200 leading-relaxed">
                    {currentCall.ai_summary.summary}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1 border-t border-[#233554]">
                  <div>
                    <span className="block font-semibold text-slate-400">Outcome Rationale:</span>
                    <span className="text-slate-300">{currentCall.ai_summary.outcome_rationale}</span>
                  </div>
                  <div>
                    <span className="block font-semibold text-slate-400">Suggested Next Action:</span>
                    <span className="text-slate-300">{currentCall.ai_summary.suggested_next_action}</span>
                    {currentCall.ai_summary.suggested_follow_up_timing && (
                      <span className="block text-[11px] text-[#3b82f6]">
                        Timing: {currentCall.ai_summary.suggested_follow_up_timing}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              !aiError && !isAutoAnalyzing && (
                <p className="mt-3 text-xs text-slate-400">
                  Click &quot;Generate AI Summary&quot; to synthesize the recorded stage results into a concise structured brief using Gemini.
                </p>
              )
            )}
          </div>

          {/* Merged Conversation Review Section (gaps + commitments + radar) */}
          <ConversationReview
            key={`${currentCall.id}-${currentCall.updated_at}`}
            callId={currentCall.id}
            initialFindings={currentCall.conversation_gaps || []}
            initialCommitments={currentCall.commitments || []}
            initialMissedOpportunities={currentCall.missed_opportunities || []}
            isReadOnly={false}
            isAutoAnalyzing={isAutoAnalyzing}
            className="border-[#233554] bg-[#101c3d]/40"
          />

          {/* Stage-by-Stage Results Record (collapsed by default) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setNotesExpanded(!notesExpanded)}
              className="flex w-full items-center justify-between rounded border border-[#233554] bg-[#070d1e] px-4 py-2.5 text-xs hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="font-bold uppercase tracking-wider text-slate-300">
                  Stage-by-Stage Captured Notes
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                  {stagesWithData} of {stages.length} stages recorded
                </span>
              </div>
              <span className="text-slate-400">{notesExpanded ? "▼ Collapse" : "▶ Expand"}</span>
            </button>

            {notesExpanded && (
              <div className="space-y-2.5">
                {stages.map((stage) => {
                  const sr = stageResultsMap.get(stage.stage_number);
                  const isSkipped = sr?.status === "skipped";
                  const isNotApplicable = sr?.status === "not_applicable";
                  const isCompleted =
                    sr?.status === "completed" ||
                    Boolean(
                      sr &&
                        (sr.selected_outcome || sr.prospect_exact_words || sr.notes) &&
                        !isSkipped &&
                        !isNotApplicable
                    );
                  const hasData = isCompleted || isSkipped || isNotApplicable;

                  return (
                    <div
                      key={stage.stage_number}
                      className={`rounded border p-3 ${
                        isCompleted
                          ? "border-emerald-500/30 bg-[#070d1e]"
                          : isSkipped
                          ? "border-amber-500/30 bg-amber-950/15"
                          : isNotApplicable
                          ? "border-slate-700 bg-slate-900/40"
                          : "border-[#1c2a47] bg-[#070d1e]/40 opacity-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs font-bold text-slate-400">
                            Stage {stage.stage_number}:
                          </span>
                          <span className="font-semibold text-white text-xs">{stage.name}</span>
                          {isCompleted && (
                            <span className="rounded bg-emerald-950/60 border border-emerald-500/40 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-300">
                              ✓ Completed
                            </span>
                          )}
                          {isSkipped && (
                            <span className="rounded bg-amber-950/60 border border-amber-500/40 px-1.5 py-0.2 text-[9px] font-semibold text-amber-300">
                              ⏭ Skipped
                            </span>
                          )}
                          {isNotApplicable && (
                            <span className="rounded bg-slate-800 border border-slate-600 px-1.5 py-0.2 text-[9px] font-semibold text-slate-300">
                              — N/A
                            </span>
                          )}
                          {!hasData && (
                            <span className="text-[10px] text-slate-500 italic">(Unvisited)</span>
                          )}
                        </div>
                        {sr?.selected_outcome && (
                          <span className="rounded bg-[#0062ff]/20 px-2 py-0.5 text-[10px] font-semibold text-[#60a5fa]">
                            {sr.selected_outcome}
                          </span>
                        )}
                      </div>

                      {sr?.prospect_exact_words && (
                        <div className="mt-2 rounded border border-[#233554] bg-[#101c3d]/60 p-2 text-xs">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-[#3b82f6]">
                            Prospect&apos;s Exact Words (Verbatim):
                          </span>
                          <p className="mt-0.5 italic text-slate-200">
                            &ldquo;{sr.prospect_exact_words}&rdquo;
                          </p>
                        </div>
                      )}

                      {sr?.notes && (
                        <div className="mt-1 text-xs text-slate-400">
                          <span className="font-semibold text-slate-400">Note:</span> {sr.notes}
                        </div>
                      )}

                      {!hasData && (
                        <span className="mt-1 block text-[11px] text-slate-600">
                          No outcome recorded for this stage.
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#233554] bg-[#101c3d] px-6 py-3">
          <p className="text-[11px] text-slate-400">
            Viewing historical record. Stored in UTC, displayed in your local time.
          </p>

          <div className="flex items-center space-x-2">
            {onDeleteCall && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Are you sure you want to delete the call record for "${currentCall.company_name}"? This cannot be undone.`)) {
                    onDeleteCall(currentCall.id);
                    onClose();
                  }
                }}
                className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/50 hover:text-white transition-colors"
              >
                Delete Call
              </button>
            )}
            {onResumeCall && currentCall.status === "in_progress" && (
              <button
                type="button"
                onClick={() => onResumeCall(currentCall)}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Resume Active Call
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[#233554] px-4 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
