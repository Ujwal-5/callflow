"use client";

import React from "react";

interface ProspectNotesFieldProps {
  isStage5: boolean;
  exactWords: string;
  notes: string;
  onExactWordsChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  isSaving?: boolean;
}

export const ProspectNotesField: React.FC<ProspectNotesFieldProps> = ({
  isStage5,
  exactWords,
  notes,
  onExactWordsChange,
  onNotesChange,
  isSaving = false,
}) => {
  return (
    <div className="space-y-3">
      {/* Prominent Exact Words field - highlighted on Stage 5 */}
      <div
        className={`rounded border transition-all ${
          isStage5
            ? "border-[#0062ff]/60 bg-[#0062ff]/5 p-3.5 ring-1 ring-[#0062ff]/40"
            : "border-[#233554] bg-[#101c3d]/60 p-3"
        }`}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <label className="flex items-center space-x-2 text-[11px] font-bold uppercase tracking-wider text-slate-300">
            <span className={isStage5 ? "text-[#3b82f6]" : "text-slate-400"}>
              Prospect&apos;s Exact Words
            </span>
            {isStage5 && (
              <span className="rounded bg-[#0062ff]/20 px-1.5 py-0.5 text-[9px] font-semibold text-[#60a5fa] uppercase tracking-normal">
                Verbatim capture — Critical for Stage 5
              </span>
            )}
          </label>
          {isSaving ? (
            <span className="text-[10px] text-slate-400 animate-pulse">
              Saving...
            </span>
          ) : (
            <span className="text-[10px] text-slate-500">Auto-saved</span>
          )}
        </div>

        <textarea
          rows={isStage5 ? 3 : 2}
          value={exactWords}
          onChange={(e) => onExactWordsChange(e.target.value)}
          placeholder={
            isStage5
              ? 'Type or paste the prospect\'s actual quote here (e.g., "Our company majorly works on job work... margin technically there is hardly any")'
              : "Record any direct quote from the prospect at this stage..."
          }
          className={`w-full rounded border bg-[#070d1e] px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none ${
            isStage5
              ? "border-[#0062ff]/60 focus:border-[#0062ff] focus:ring-1 focus:ring-[#0062ff]"
              : "border-[#233554] focus:border-slate-400"
          }`}
        />
        <p className="mt-1 text-[10px] text-slate-400">
          Preserves original wording without AI rewriting or paraphrasing.
        </p>
      </div>

      {/* Internal notes field */}
      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Internal Notes & Context
        </label>
        <input
          type="text"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Brief observations, tone, follow-up notes, or next person mentioned..."
          className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-slate-400 focus:outline-none"
        />
      </div>
    </div>
  );
};
