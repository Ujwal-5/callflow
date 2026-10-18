"use client";

import React from "react";
import { StageDefinition, StageResult } from "@/types";

interface StageProgressProps {
  stages: StageDefinition[];
  currentStageNumber: number;
  highestStageReached: number;
  stageResults?: StageResult[];
  onSelectStage: (stageNumber: number) => void;
}

export const StageProgress: React.FC<StageProgressProps> = ({
  stages,
  currentStageNumber,
  highestStageReached: _highestStageReached,
  stageResults = [],
  onSelectStage,
}) => {
  // Map of stage status: completed | skipped | not_applicable
  const stageStatusMap = new Map<number, "completed" | "skipped" | "not_applicable">();
  stageResults.forEach((sr) => {
    if (sr.status === "skipped" || sr.status === "not_applicable") {
      stageStatusMap.set(sr.stage_number, sr.status);
    } else if (sr.selected_outcome || sr.prospect_exact_words || sr.notes) {
      stageStatusMap.set(sr.stage_number, "completed");
    }
  });

  return (
    <div className="w-full border-b border-[#233554] bg-[#0b132b]/80 px-4 py-3 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <span className="font-semibold uppercase tracking-wider text-slate-400">
              Call Progression
            </span>
            <span className="hidden sm:inline-block text-[10px] text-slate-500 font-normal">
              (Non-linear guidance — click any stage to jump, skip, or revisit)
            </span>
          </div>
          <span className="font-mono text-slate-300">
            Active: <span className="font-bold text-[#0062ff]">Stage {currentStageNumber}</span> of {stages.length}
          </span>
        </div>

        {/* Horizontal Non-linear Stepper */}
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {stages.map((stage) => {
            const isCurrent = stage.stage_number === currentStageNumber;
            const status = stageStatusMap.get(stage.stage_number);
            const isCompleted = status === "completed";
            const isSkipped = status === "skipped";
            const isNotApplicable = status === "not_applicable";

            return (
              <button
                key={stage.stage_number}
                type="button"
                onClick={() => onSelectStage(stage.stage_number)}
                title={`Click to jump directly to Stage ${stage.stage_number}: ${stage.name}`}
                className={`group relative flex flex-col items-start rounded border p-2 text-left cursor-pointer transition-all ${
                  isCurrent
                    ? "border-[#0062ff] bg-[#0062ff]/15 ring-1 ring-[#0062ff] shadow-sm shadow-[#0062ff]/20"
                    : isCompleted
                    ? "border-emerald-500/40 bg-emerald-950/20 hover:border-emerald-400 hover:bg-emerald-950/30"
                    : isSkipped
                    ? "border-amber-500/40 bg-amber-950/20 hover:border-amber-400"
                    : isNotApplicable
                    ? "border-slate-600 bg-slate-900/40 hover:border-slate-500"
                    : "border-[#1c2a47] bg-[#0a1128]/50 hover:border-slate-500 opacity-70 hover:opacity-100"
                }`}
              >
                {/* Header line: Stage number + status indicator */}
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`font-mono text-[10px] font-bold uppercase ${
                      isCurrent
                        ? "text-[#3b82f6]"
                        : isCompleted
                        ? "text-emerald-400"
                        : isSkipped
                        ? "text-amber-400"
                        : isNotApplicable
                        ? "text-slate-400"
                        : "text-slate-400"
                    }`}
                  >
                    0{stage.stage_number}
                  </span>

                  {isCompleted ? (
                    <span className="text-[10px] font-bold text-emerald-400" title="Completed stage">
                      ✓
                    </span>
                  ) : isSkipped ? (
                    <span className="text-[10px] font-bold text-amber-400" title="Skipped stage">
                      ⏭
                    </span>
                  ) : isNotApplicable ? (
                    <span className="text-[10px] font-bold text-slate-400" title="Not applicable">
                      —
                    </span>
                  ) : isCurrent ? (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0062ff] opacity-75"></span>
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#0062ff]"></span>
                    </span>
                  ) : null}
                </div>

                {/* Stage title */}
                <span
                  className={`mt-1 line-clamp-1 text-xs font-semibold leading-tight ${
                    isCurrent
                      ? "text-white"
                      : isCompleted
                      ? "text-slate-200"
                      : isSkipped
                      ? "text-amber-200/90"
                      : isNotApplicable
                      ? "text-slate-400"
                      : "text-slate-400 group-hover:text-slate-200"
                  }`}
                >
                  {stage.name}
                </span>

                {/* Status subtext */}
                <span className="mt-0.5 text-[9px] font-medium leading-none">
                  {isCurrent ? (
                    <span className="text-[#60a5fa]">Active</span>
                  ) : isCompleted ? (
                    <span className="text-emerald-400/90">Completed</span>
                  ) : isSkipped ? (
                    <span className="text-amber-400/90">Skipped</span>
                  ) : isNotApplicable ? (
                    <span className="text-slate-400">N/A</span>
                  ) : (
                    <span className="text-slate-500">Unvisited</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
