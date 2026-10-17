"use client";

import React from "react";
import { StageDefinition, StageResult } from "@/types";
import { OutcomeButtons } from "./OutcomeButtons";
import { ProspectNotesField } from "./ProspectNotesField";

interface CurrentStagePanelProps {
  stage: StageDefinition;
  totalStages: number;
  stageResult: StageResult | undefined;
  onUpdateOutcome: (outcome: string) => void;
  onUpdateExactWords: (words: string) => void;
  onUpdateNotes: (notes: string) => void;
  onNextStage: () => void;
  onEndCall: () => void;
  isSaving: boolean;
  isLastStage: boolean;
}

export const CurrentStagePanel: React.FC<CurrentStagePanelProps> = ({
  stage,
  totalStages,
  stageResult,
  onUpdateOutcome,
  onUpdateExactWords,
  onUpdateNotes,
  onNextStage,
  onEndCall,
  isSaving,
  isLastStage,
}) => {
  const selectedOutcome = stageResult?.selected_outcome || null;
  const exactWords = stageResult?.prospect_exact_words || "";
  const notes = stageResult?.notes || "";

  return (
    <div className="rounded-lg border border-[#233554] bg-[#0b132b] shadow-xl">
      {/* Top stage header */}
      <div className="border-b border-[#233554] bg-[#101c3d]/70 px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#0062ff]">
            Stage {stage.stage_number} of {totalStages}
          </span>
          {stage.has_exact_words_prominent && (
            <span className="rounded border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300 uppercase tracking-wide">
              Key Discovery Stage
            </span>
          )}
        </div>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-white">
          {stage.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">
          <span className="font-semibold text-slate-400">Purpose: </span>
          {stage.purpose}
        </p>
      </div>

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

        {/* What Happened? Outcome Buttons */}
        <OutcomeButtons
          options={stage.outcome_options}
          selectedOutcome={selectedOutcome}
          onSelectOutcome={onUpdateOutcome}
        />

        {/* Prospect exact words & notes field */}
        <ProspectNotesField
          isStage5={stage.stage_number === 5}
          exactWords={exactWords}
          notes={notes}
          onExactWordsChange={onUpdateExactWords}
          onNotesChange={onUpdateNotes}
          isSaving={isSaving}
        />
      </div>

      {/* Action Footer */}
      <div className="flex flex-col gap-3 border-t border-[#233554] bg-[#101c3d]/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Visible End Call button */}
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

        {/* Right: Next Stage Info & Action */}
        <div className="flex items-center justify-between space-x-3 sm:justify-end">
          {stage.next_stage_name && (
            <div className="text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Next Stage
              </span>
              <span className="text-xs font-medium text-slate-200">
                {stage.next_stage_name}
              </span>
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
  );
};
