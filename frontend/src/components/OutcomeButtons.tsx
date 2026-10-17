"use client";

import React from "react";

interface OutcomeButtonsProps {
  options: string[];
  selectedOutcome: string | null;
  onSelectOutcome: (outcome: string) => void;
  disabled?: boolean;
}

export const OutcomeButtons: React.FC<OutcomeButtonsProps> = ({
  options,
  selectedOutcome,
  onSelectOutcome,
  disabled = false,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          What happened? <span className="font-normal text-slate-400">(Select one outcome)</span>
        </label>
        {selectedOutcome ? (
          <span className="text-[11px] font-medium text-emerald-400 flex items-center gap-1">
            <span>●</span> Outcome recorded
          </span>
        ) : (
          <span className="text-[11px] font-medium text-amber-400/80">
            Optional: no outcome selected
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const isSelected = selectedOutcome === option;
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onSelectOutcome(option)}
              className={`flex items-center justify-between rounded border px-3.5 py-2.5 text-left text-xs font-medium transition-all ${
                isSelected
                  ? "border-[#0062ff] bg-[#0062ff]/20 text-white ring-1 ring-[#0062ff] shadow-sm shadow-[#0062ff]/20"
                  : "border-[#233554] bg-[#101c3d] text-slate-300 hover:border-slate-500 hover:bg-[#16254e] hover:text-white"
              } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <span>{option}</span>
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  isSelected
                    ? "border-[#0062ff] bg-[#0062ff] text-white"
                    : "border-slate-600 bg-transparent"
                }`}
              >
                {isSelected && (
                  <svg
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
