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
  highestStageReached,
  stageResults = [],
  onSelectStage,
}) => {
  // Map of completed stages
  const recordedStageMap = new Map<number, boolean>();
  stageResults.forEach((sr) => {
    if (sr.selected_outcome || sr.prospect_exact_words || sr.notes) {
      recordedStageMap.set(sr.stage_number, true);
    }
  });

  return (
    <div className="w-full border-b border-[#233554] bg-[#0b132b]/80 px-4 py-3 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-slate-400">
            Call Progression
          </span>
          <span className="font-mono text-slate-300">
            Stage <span className="font-bold text-[#0062ff]">{currentStageNumber}</span> of {stages.length}
          </span>
        </div>

        {/* Horizontal Stepper */}
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {stages.map((stage) => {
            const isCurrent = stage.stage_number === currentStageNumber;
            const isCompleted = recordedStageMap.get(stage.stage_number);
            const isReached = stage.stage_number <= highestStageReached;

            return (
              <button
                key={stage.stage_number}
                type="button"
                onClick={() => onSelectStage(stage.stage_number)}
                className={`group relative flex flex-col items-start rounded border p-2 text-left transition-all ${
                  isCurrent
                    ? "border-[#0062ff] bg-[#0062ff]/15 ring-1 ring-[#0062ff]"
                    : isCompleted
                    ? "border-emerald-500/40 bg-emerald-950/20 hover:border-emerald-400"
                    : isReached
                    ? "border-[#233554] bg-[#101c3d] hover:border-slate-500"
                    : "border-[#1c2a47] bg-[#0a1128]/50 opacity-60 hover:opacity-100"
                }`}
              >
                {/* Header line: Stage number + status */}
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`font-mono text-[10px] font-bold uppercase ${
                      isCurrent
                        ? "text-[#3b82f6]"
                        : isCompleted
                        ? "text-emerald-400"
                        : "text-slate-400"
                    }`}
                  >
                    0{stage.stage_number}
                  </span>

                  {isCompleted ? (
                    <span className="text-[10px] text-emerald-400" title="Data recorded">
                      ✓
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
                      : "text-slate-400"
                  }`}
                >
                  {stage.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
