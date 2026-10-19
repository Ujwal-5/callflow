"use client";

/**
 * StageAINotesPanel — Displays AI-generated stage notes for the current stage.
 *
 * Shows notes captured from live transcription analysis, with indicators for:
 * - Notes that need caller review
 * - Notes that were manually accepted
 * - Evidence quotes supporting each note
 *
 * AI updates never silently overwrite manually edited notes.
 */

import React, { useState } from "react";
import type { StageNoteItem } from "@/hooks/useStageNotesAnalysis";

interface StageAINotesPanelProps {
  stageNumber: number;
  stageName: string;
  notes: StageNoteItem[];
  isAnalyzing: boolean;
  onMarkReviewed: (index: number) => void;
  onDismiss: (index: number) => void;
}

export const StageAINotesPanel: React.FC<StageAINotesPanelProps> = ({
  stageNumber,
  stageName,
  notes,
  isAnalyzing,
  onMarkReviewed,
  onDismiss,
}) => {
  const [expanded, setExpanded] = useState(true);

  if (!isAnalyzing && notes.length === 0) return null;

  return (
    <div className="rounded border border-indigo-500/30 bg-indigo-950/20 mt-3">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center space-x-2">
          <span className="text-indigo-400">✦</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">
            AI-Captured Notes
          </span>
          {isAnalyzing && (
            <span className="flex items-center space-x-1 text-[10px] text-indigo-400 animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" />
              <span>Analyzing…</span>
            </span>
          )}
          {notes.length > 0 && (
            <span className="rounded bg-indigo-900/60 px-1.5 py-0.5 text-[10px] font-mono text-indigo-300">
              {notes.length}
            </span>
          )}
          {notes.some((n) => n.needs_review && !n.manually_edited) && (
            <span className="rounded bg-amber-950/50 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
              Review needed
            </span>
          )}
        </div>
        <svg
          className={`h-3.5 w-3.5 text-indigo-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-indigo-500/20 px-3 py-2 space-y-2">
          {notes.length === 0 && isAnalyzing && (
            <p className="text-[11px] text-indigo-400/70 italic">
              Classifying transcript into stage notes…
            </p>
          )}

          {notes.map((note, idx) => (
            <div
              key={`${note.source_segment_id}_${idx}`}
              className={`rounded border px-2.5 py-2 space-y-1 ${
                note.manually_edited
                  ? "border-emerald-500/30 bg-emerald-950/20"
                  : note.needs_review
                  ? "border-amber-500/30 bg-amber-950/20"
                  : "border-indigo-500/20 bg-indigo-950/10"
              }`}
            >
              {/* Note text */}
              <p className="text-xs text-slate-200 leading-relaxed">{note.note}</p>

              {/* Evidence quote */}
              {note.evidence_quote && (
                <p className="text-[10px] italic text-slate-400 border-l-2 border-indigo-500/30 pl-2">
                  &ldquo;{note.evidence_quote}&rdquo;
                </p>
              )}

              {/* Footer: confidence + actions */}
              <div className="flex items-center justify-between pt-0.5">
                <div className="flex items-center space-x-2">
                  {note.manually_edited ? (
                    <span className="text-[9px] text-emerald-400 font-semibold">✓ Reviewed</span>
                  ) : note.needs_review ? (
                    <span className="text-[9px] text-amber-400 font-semibold">⚠ Needs review</span>
                  ) : (
                    <span className="text-[9px] text-indigo-400/70">
                      {Math.round(note.confidence * 100)}% confidence
                    </span>
                  )}
                </div>

                {!note.manually_edited && (
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => onMarkReviewed(idx)}
                      title="Mark as reviewed"
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 hover:bg-emerald-950/40 border border-emerald-500/20 transition-colors"
                    >
                      ✓ Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismiss(idx)}
                      title="Dismiss this note"
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 hover:bg-slate-800/40 border border-slate-700/30 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          <p className="text-[9px] text-indigo-400/50 pt-1">
            AI notes are suggestions. Verify before use — manual notes take priority.
          </p>
        </div>
      )}
    </div>
  );
};
