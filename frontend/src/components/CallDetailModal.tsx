"use client";

import React, { useState, useEffect } from "react";
import { Call, StageDefinition, Transcript } from "@/types";
import { api } from "@/lib/api";
import { CommitmentRadarPanel } from "@/components/CommitmentRadarPanel";
import { ConversationReview } from "@/components/ConversationReview";


interface CallDetailModalProps {
  call: Call | null;
  stages: StageDefinition[];
  onClose: () => void;
  onResumeCall?: (call: Call) => void;
}

export const CallDetailModal: React.FC<CallDetailModalProps> = ({
  call,
  stages,
  onClose,
  onResumeCall,
}) => {
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [currentCall, setCurrentCall] = useState<Call | null>(call);
  const [callTranscript, setCallTranscript] = useState<Transcript | null>(null);

  useEffect(() => {
    if (call?.id) {
      api.getTranscript(call.id).then(setCallTranscript).catch(() => {});
    }
  }, [call?.id]);

  if (!call || !currentCall) return null;

  const handleGenerateSummary = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    try {
      const res = await api.generateCallSummary(currentCall.id);
      if (res.available && res.summary) {
        setCurrentCall({
          ...currentCall,
          ai_summary: res.summary,
        });
      } else if (res.error) {
        setAiError(res.error);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setAiError(err.message);
      } else {
        setAiError("Failed to generate AI summary.");
      }
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const formatDateTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString(undefined, {
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
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Outcome & Next Step Summary Box */}
          <div className="grid grid-cols-1 gap-4 rounded border border-[#233554] bg-[#070d1e] p-4 sm:grid-cols-3">
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
              {!currentCall.ai_summary && (
                <button
                  type="button"
                  disabled={isGeneratingAi}
                  onClick={handleGenerateSummary}
                  className="rounded bg-[#0062ff] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#0052d9] transition-all disabled:opacity-60"
                >
                  {isGeneratingAi ? "Analyzing..." : "Generate AI Summary"}
                </button>
              )}
            </div>

            {aiError && (
              <div className="mt-3 rounded border border-amber-500/50 bg-amber-950/40 p-2.5 text-xs text-amber-200">
                <span className="font-semibold">Notice:</span> {aiError}
              </div>
            )}

            {currentCall.ai_summary ? (
              <div className="mt-3 space-y-2.5 text-xs">
                <div>
                  <span className="block font-semibold text-slate-400">
                    Executive Summary:
                  </span>
                  <p className="mt-0.5 text-slate-200 leading-relaxed">
                    {currentCall.ai_summary.summary}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1 border-t border-[#233554]">
                  <div>
                    <span className="block font-semibold text-slate-400">
                      Outcome Rationale:
                    </span>
                    <span className="text-slate-300">
                      {currentCall.ai_summary.outcome_rationale}
                    </span>
                  </div>
                  <div>
                    <span className="block font-semibold text-slate-400">
                      Suggested Next Action:
                    </span>
                    <span className="text-slate-300">
                      {currentCall.ai_summary.suggested_next_action}
                    </span>
                    {currentCall.ai_summary.suggested_follow_up_timing && (
                      <span className="block text-[11px] text-[#3b82f6]">
                        Timing: {currentCall.ai_summary.suggested_follow_up_timing}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              !aiError && (
                <p className="mt-3 text-xs text-slate-400">
                  Click &quot;Generate AI Summary&quot; to synthesize the recorded stage results into a concise structured brief using Gemini.
                </p>
              )
            )}
          </div>

          {/* Conversation Review Section (Conversation Gap Detector) */}
          <ConversationReview
            callId={currentCall.id}
            isReadOnly={false}
            className="border-[#233554] bg-[#101c3d]/40"
          />

          {/* Commitment Radar Section */}
          <CommitmentRadarPanel
            callId={currentCall.id}
            isReadOnly={false}
            className="border-[#233554] bg-[#101c3d]/30"
          />

          {/* Stage-by-Stage Results Record */}
          <div className="space-y-3">

            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Stage-by-Stage Captured Notes
            </h3>

            <div className="space-y-2.5">
              {stages.map((stage) => {
                const sr = stageResultsMap.get(stage.stage_number);
                const hasData =
                  sr && (sr.selected_outcome || sr.prospect_exact_words || sr.notes);

                return (
                  <div
                    key={stage.stage_number}
                    className={`rounded border p-3 ${
                      hasData
                        ? "border-[#233554] bg-[#070d1e]"
                        : "border-[#1c2a47] bg-[#070d1e]/40 opacity-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-bold text-slate-400">
                          Stage {stage.stage_number}:
                        </span>
                        <span className="font-semibold text-white text-xs">
                          {stage.name}
                        </span>
                      </div>
                      {sr?.selected_outcome && (
                        <span className="rounded bg-[#0062ff]/20 px-2 py-0.5 text-[10px] font-semibold text-[#60a5fa]">
                          {sr.selected_outcome}
                        </span>
                      )}
                    </div>

                    {/* Exact words (Prominent on Stage 5) */}
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

                    {/* Internal Notes */}
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
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#233554] bg-[#101c3d] px-6 py-3">
          <p className="text-[11px] text-slate-400">
            Viewing historical record. Stored in UTC, displayed in your local time.
          </p>

          <div className="flex items-center space-x-2">
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
