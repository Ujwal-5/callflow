"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { StageDefinition, StageResult, StageSuggestion } from "@/types";
import { OutcomeButtons } from "./OutcomeButtons";
import { ProspectNotesField } from "./ProspectNotesField";

interface CurrentStagePanelProps {
  stage: StageDefinition;
  totalStages: number;
  allStages?: StageDefinition[];
  stageResult: StageResult | undefined;
  onUpdateOutcome: (outcome: string) => void;
  onUpdateExactWords: (words: string) => void;
  onUpdateNotes: (notes: string) => void;
  onNextStage: () => void;
  onEndCall: () => void;
  onSelectStage?: (stageNumber: number) => void;
  onSkipStage?: (notApplicable?: boolean) => void;
  onQuickEndCall?: (presetOutcome: string) => void;
  stageSuggestion?: StageSuggestion | null;
  onApplyStageSuggestion?: (stageNumber: number) => void;
  onDismissStageSuggestion?: () => void;
  isSaving: boolean;
  isLastStage: boolean;
  /** Called once on mount so the parent can read the panel's latest local text. */
  onRegisterFlush?: (fn: () => { exactWords: string; notes: string }) => void;
  /**
   * Called once on mount so the parent (via TranscriptPanel) can push transcript
   * text into the exactWords field without lifting state to the page.
   */
  onRegisterCopyExactWords?: (fn: (text: string) => void) => void;
}

export const CurrentStagePanel: React.FC<CurrentStagePanelProps> = ({
  stage,
  totalStages,
  allStages = [],
  stageResult,
  onUpdateOutcome,
  onUpdateExactWords,
  onUpdateNotes,
  onNextStage,
  onEndCall,
  onSelectStage,
  onSkipStage,
  onQuickEndCall,
  stageSuggestion,
  onApplyStageSuggestion,
  onDismissStageSuggestion,
  isSaving,
  isLastStage,
  onRegisterFlush,
  onRegisterCopyExactWords,
}) => {
  // Local optimistic state – decoupled from the server-owned stageResult prop.
  const [localOutcome, setLocalOutcome] = useState<string | null>(
    stageResult?.selected_outcome ?? null
  );
  const [localExactWords, setLocalExactWords] = useState(
    stageResult?.prospect_exact_words ?? ""
  );
  const [localNotes, setLocalNotes] = useState(stageResult?.notes ?? "");
  const [localSaving, setLocalSaving] = useState(false);

  // Refs to hold latest values for the flush callback (avoids stale closures)
  const localExactWordsRef = useRef(localExactWords);
  const localNotesRef = useRef(localNotes);
  useEffect(() => { localExactWordsRef.current = localExactWords; }, [localExactWords]);
  useEffect(() => { localNotesRef.current = localNotes; }, [localNotes]);

  // Register a flush function so the parent can read local text without lifting state.
  useEffect(() => {
    if (onRegisterFlush) {
      onRegisterFlush(() => ({
        exactWords: localExactWordsRef.current,
        notes: localNotesRef.current,
      }));
    }
  }, [onRegisterFlush]);

  const exactWordsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const notesDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Register a copy-to-exact-words function so TranscriptPanel can inject text.
  useEffect(() => {
    if (onRegisterCopyExactWords) {
      onRegisterCopyExactWords((text: string) => {
        setLocalExactWords(text);
        localExactWordsRef.current = text;
        if (exactWordsDebounceRef.current) clearTimeout(exactWordsDebounceRef.current);
        setLocalSaving(true);
        exactWordsDebounceRef.current = setTimeout(() => {
          onUpdateExactWords(text);
          setLocalSaving(false);
        }, 400);
      });
    }
  }, [onRegisterCopyExactWords]);

  // Re-sync local state when switching stages (stage_number changes).
  useEffect(() => {
    setLocalOutcome(stageResult?.selected_outcome ?? null);
    setLocalExactWords(stageResult?.prospect_exact_words ?? "");
    setLocalNotes(stageResult?.notes ?? "");
    if (exactWordsDebounceRef.current) clearTimeout(exactWordsDebounceRef.current);
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
  }, [stage.stage_number]);

  useEffect(() => {
    if (
      stageResult?.selected_outcome !== undefined &&
      stageResult.selected_outcome !== localOutcome
    ) {
      setLocalOutcome(stageResult.selected_outcome);
    }
  }, [stageResult?.selected_outcome]);

  const handleOutcomeClick = useCallback(
    (outcome: string) => {
      setLocalOutcome(outcome);
      onUpdateOutcome(outcome);
    },
    [onUpdateOutcome]
  );

  const handleExactWordsChange = useCallback(
    (text: string) => {
      setLocalExactWords(text);
      if (exactWordsDebounceRef.current) clearTimeout(exactWordsDebounceRef.current);
      setLocalSaving(true);
      exactWordsDebounceRef.current = setTimeout(() => {
        onUpdateExactWords(text);
        setLocalSaving(false);
      }, 400);
    },
    [onUpdateExactWords]
  );

  const handleNotesChange = useCallback(
    (text: string) => {
      setLocalNotes(text);
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
      setLocalSaving(true);
      notesDebounceRef.current = setTimeout(() => {
        onUpdateNotes(text);
        setLocalSaving(false);
      }, 400);
    },
    [onUpdateNotes]
  );

  const effectiveSaving = localSaving || isSaving;

  const hasPendingSuggestion =
    Boolean(stageSuggestion?.has_suggestion) &&
    stageSuggestion?.suggested_stage_number !== undefined &&
    stageSuggestion?.suggested_stage_number !== null &&
    stageSuggestion.suggested_stage_number !== stage.stage_number;

  const currentStatus = stageResult?.status;

  return (
    <div className="rounded-lg border border-[#233554] bg-[#0b132b] shadow-xl">
      {/* Top stage header */}
      <div className="border-b border-[#233554] bg-[#101c3d]/70 px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Stage badge & manual dropdown selector */}
          <div className="flex items-center space-x-2">
            {currentStatus === "skipped" && (
              <span className="rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300 uppercase tracking-wide">
                Marked Skipped
              </span>
            )}
            {currentStatus === "not_applicable" && (
              <span className="rounded border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
                Not Applicable
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {stage.has_exact_words_prominent && (
              <span className="rounded border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300 uppercase tracking-wide">
                Key Discovery Stage
              </span>
            )}
          </div>
        </div>

        <h2 className="mt-1 text-xl font-bold tracking-tight text-white">
          {stage.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">
          <span className="font-semibold text-slate-400">Purpose: </span>
          {stage.purpose}
        </p>
      </div>

      {/* Suggested Stage Change Banner (shown ONLY when transcript evidence is detected; NEVER auto-applied) */}
      {hasPendingSuggestion && stageSuggestion && (
        <div className="border-b border-indigo-500/40 bg-gradient-to-r from-indigo-950/60 via-[#101c3d] to-indigo-950/60 px-5 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start space-x-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-900/80 text-xs text-indigo-300 border border-indigo-500/30">
                💡
              </span>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-white">
                    Suggested Transition: Stage {stageSuggestion.suggested_stage_number} ({stageSuggestion.suggested_stage_name})
                  </span>
                  <span className="text-[10px] text-indigo-300 font-mono">
                    (Requires your confirmation)
                  </span>
                </div>
                {stageSuggestion.reason && (
                  <p className="mt-0.5 text-xs text-slate-200">
                    {stageSuggestion.reason}
                  </p>
                )}
                {stageSuggestion.evidence_quote && (
                  <p className="mt-1 text-[11px] italic text-indigo-200/90 bg-indigo-950/40 border border-indigo-500/20 rounded px-2 py-0.5">
                    &ldquo;{stageSuggestion.evidence_quote}&rdquo;
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
              {onApplyStageSuggestion && stageSuggestion.suggested_stage_number && (
                <button
                  type="button"
                  onClick={() => onApplyStageSuggestion(stageSuggestion.suggested_stage_number!)}
                  className="rounded bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white shadow transition-colors"
                >
                  Switch to Stage {stageSuggestion.suggested_stage_number} →
                </button>
              )}
              {onDismissStageSuggestion && (
                <button
                  type="button"
                  onClick={onDismissStageSuggestion}
                  className="rounded border border-slate-700 bg-slate-800/60 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-5 p-5">
        {/* Common responses card */}
        <div className="rounded border border-[#233554] bg-[#070d1e]/70 p-3.5">
          <div className="mb-2 flex items-center space-x-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <svg
              className="h-3.5 w-3.5 text-[#0062ff]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <span>Common Prospect Responses at This Stage</span>
          </div>
          <ul className="space-y-1.5">
            {stage.common_responses.map((resp, i) => (
              <li
                key={i}
                className="flex items-start space-x-2 text-xs text-slate-300"
              >
                <span className="mt-0.5 text-xs text-[#0062ff]">•</span>
                <span className="leading-snug">{resp}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* What Happened? Outcome Buttons — driven by LOCAL optimistic state */}
        <OutcomeButtons
          options={stage.outcome_options}
          selectedOutcome={localOutcome}
          onSelectOutcome={handleOutcomeClick}
        />

        {/* Prospect exact words & notes field — driven by LOCAL state */}
        <ProspectNotesField
          isStage5={stage.stage_number === 5}
          exactWords={localExactWords}
          notes={localNotes}
          onExactWordsChange={handleExactWordsChange}
          onNotesChange={handleNotesChange}
          isSaving={effectiveSaving}
        />
      </div>

      {/* Action Footer */}
      <div className="flex flex-col gap-3 border-t border-[#233554] bg-[#101c3d]/50 p-4">
        {/* Early call termination presets for natural conversations */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#233554]/60 pb-3 text-xs">
          <div className="flex items-center space-x-1.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
            <span>Fast Call Resolution:</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onQuickEndCall && (
              <>
                <button
                  type="button"
                  onClick={() => onQuickEndCall("Callback requested")}
                  title="Prospect is busy, driving, or in a meeting — schedule callback"
                  className="rounded border border-blue-500/30 bg-blue-950/30 hover:bg-blue-900/40 px-2.5 py-1 text-[11px] font-semibold text-blue-300 hover:text-white transition-colors"
                >
                  📞 Prospect Busy (Callback)
                </button>
                <button
                  type="button"
                  onClick={() => onQuickEndCall("Not interested")}
                  title="Prospect not interested or declined — log objection and exit"
                  className="rounded border border-slate-700 bg-slate-800/40 hover:bg-slate-700/60 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  🚫 Not Interested
                </button>
                <button
                  type="button"
                  onClick={() => onQuickEndCall("Interested; follow-up agreed")}
                  title="Prospect agreed to meet or move forward immediately"
                  className="rounded border border-emerald-500/30 bg-emerald-950/30 hover:bg-emerald-900/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:text-white transition-colors"
                >
                  📅 Ready to Schedule
                </button>
              </>
            )}
          </div>
        </div>

        {/* Navigation & Controls Row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: General End Call */}
          <button
            type="button"
            onClick={onEndCall}
            className="flex items-center justify-center space-x-1.5 rounded border border-rose-500/50 bg-rose-950/20 px-3.5 py-2 text-xs font-semibold text-rose-300 transition-colors hover:border-rose-400 hover:bg-rose-900/40 hover:text-white"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z"
              />
            </svg>
            <span>End Call Early</span>
          </button>

          {/* Right: Skip Stage & Next Stage */}
          <div className="flex items-center justify-between space-x-2 sm:justify-end">
            {onSkipStage && (
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => onSkipStage(false)}
                  title="Mark this stage as skipped and move forward"
                  className="rounded border border-amber-500/30 bg-amber-950/20 px-2.5 py-2 text-xs font-medium text-amber-300 hover:border-amber-400 hover:text-white transition-colors"
                >
                  ⏭ Skip Stage
                </button>
                <button
                  type="button"
                  onClick={() => onSkipStage(true)}
                  title="Mark this stage as Not Applicable for this conversation"
                  className="rounded border border-slate-700 bg-slate-800/40 px-2 py-2 text-xs font-medium text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
                >
                  N/A
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onNextStage}
              className={`flex items-center space-x-2 rounded px-4 py-2 text-xs font-bold text-white shadow-md transition-all ${
                isLastStage
                  ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30"
                  : "bg-[#0062ff] hover:bg-[#0052d9] shadow-[#0062ff]/30 ring-1 ring-blue-400/40"
              }`}
            >
              <span>{isLastStage ? "Complete Call" : "Next Stage"}</span>
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d={isLastStage ? "M5 13l4 4L19 7" : "M9 5l7 7-7 7"}
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
