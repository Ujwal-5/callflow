"use client";

/**
 * useStageNotesAnalysis — Debounced incremental stage-note classification.
 *
 * Listens to incoming finalized transcript segments and periodically sends
 * them to the backend /calls/{callId}/analyze-stage-notes endpoint.
 *
 * Key behaviors:
 * - Debounces analysis: sends a request only after a meaningful chunk
 *   of finalized text has accumulated (or a max wait period expires).
 * - Deduplicates: each segment ID is tracked; already-analyzed text
 *   is never re-sent.
 * - Does NOT overwrite manually-edited stage notes — adds AI notes as
 *   suggestions that the caller can accept, edit, or dismiss.
 * - Processes any remaining unanalyzed text when recording stops.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "@/lib/api";

export interface StageNoteItem {
  stage_number: number;
  stage_name: string;
  note: string;
  evidence_quote: string;
  confidence: number;
  needs_review: boolean;
  /** Local: the segment ID that produced this note */
  source_segment_id?: string;
  /** Local: timestamp when this note was generated */
  generated_at: number;
  /** Local: whether the caller has manually edited/accepted this note */
  manually_edited?: boolean;
}

export interface StageNotesState {
  /** stage_number → list of AI-generated notes */
  notes: Map<number, StageNoteItem[]>;
  /** stage_number → is analysis running */
  analyzing: Set<number>;
  /** stage_number → has notes that need review */
  needsReview: Set<number>;
  /** Last analysis error, if any */
  lastError: string | null;
}

export interface UseStageNotesAnalysisReturn {
  stageNotesState: StageNotesState;
  /** Get notes for a specific stage */
  getStageNotes: (stageNumber: number) => StageNoteItem[];
  /** Whether any stage is currently being analyzed */
  isAnalyzing: boolean;
  /** Whether a specific stage has notes */
  stageHasNotes: (stageNumber: number) => boolean;
  /** Whether a specific stage has notes that need review */
  stageNeedsReview: (stageNumber: number) => boolean;
  /** Whether a specific stage is currently being analyzed */
  stageIsAnalyzing: (stageNumber: number) => boolean;
  /** Mark a note as manually reviewed (prevents AI from overwriting) */
  markNoteReviewed: (stageNumber: number, noteIndex: number) => void;
  /** Dismiss an AI note for a stage */
  dismissNote: (stageNumber: number, noteIndex: number) => void;
  /** Trigger final analysis when recording stops */
  runFinalAnalysis: (callId: string, remainingText: string) => Promise<void>;
  /** Reset all notes state */
  resetNotes: () => void;
  /** Feed new finalized transcript text for incremental analysis */
  feedSegment: (callId: string, segmentId: string, text: string) => void;
}

/** Min characters to accumulate before triggering analysis */
// Wait for a useful, speaker-labelled batch.  Smaller batches create many
// nearly context-free model calls and quickly build a queue behind Gemini.
const MIN_CHARS_FOR_ANALYSIS = 600;

/** Max wait before forcing analysis even if not enough chars */
const MAX_DEBOUNCE_MS = 12_000;

/** Min interval between analysis requests */
const MIN_ANALYSIS_INTERVAL_MS = 6_000;

export function useStageNotesAnalysis(): UseStageNotesAnalysisReturn {
  const [stageNotesState, setStageNotesState] = useState<StageNotesState>({
    notes: new Map(),
    analyzing: new Set(),
    needsReview: new Set(),
    lastError: null,
  });

  // Buffer for incoming segment text not yet analyzed
  const pendingBufferRef = useRef<{ id: string; text: string }[]>([]);
  const analyzedSegmentIdsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastAnalysisTimeRef = useRef<number>(0);
  const isAnalyzingRef = useRef(false);
  const analysisGenerationRef = useRef(0);

  const isAnalyzing = stageNotesState.analyzing.size > 0;

  // ── Internal: run analysis request ───────────────────────────────────────

  const runAnalysis = useCallback(async (callId: string, text: string, segmentId: string) => {
    if (!text.trim()) return;
    // Serialize requests. Returning here used to discard flushed transcript
    // chunks whenever another analysis request was still in flight.
    while (isAnalyzingRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    isAnalyzingRef.current = true;
    const generation = analysisGenerationRef.current;
    lastAnalysisTimeRef.current = Date.now();

    // Mark stages as analyzing
    setStageNotesState((prev) => ({
      ...prev,
      analyzing: new Set([...prev.analyzing, -1]), // -1 = global spinner
    }));

    try {
      const result = await api.analyzeStageNotes(callId, text, segmentId);
      if (generation !== analysisGenerationRef.current) return;

      if (result.stage_notes && result.stage_notes.length > 0) {
        setStageNotesState((prev) => {
          const newNotes = new Map(prev.notes);
          const newNeedsReview = new Set(prev.needsReview);
          const newAnalyzing = new Set(prev.analyzing);
          newAnalyzing.delete(-1);

          for (const note of result.stage_notes) {
            const existing = newNotes.get(note.stage_number) || [];
            // Don't add duplicate notes (same evidence_quote)
            const isDuplicate = existing.some(
              (e) => e.evidence_quote.trim().toLowerCase() === (note.evidence_quote || "").trim().toLowerCase()
            );
            if (!isDuplicate) {
              const newNote: StageNoteItem = {
                ...note,
                source_segment_id: segmentId,
                generated_at: Date.now(),
                manually_edited: false,
              };
              newNotes.set(note.stage_number, [...existing, newNote]);
              if (note.needs_review) {
                newNeedsReview.add(note.stage_number);
              }
            }
          }

          return {
            ...prev,
            notes: newNotes,
            analyzing: newAnalyzing,
            needsReview: newNeedsReview,
            lastError: null,
          };
        });
      } else {
        setStageNotesState((prev) => {
          const newAnalyzing = new Set(prev.analyzing);
          newAnalyzing.delete(-1);
          return { ...prev, analyzing: newAnalyzing };
        });
      }
    } catch (err) {
      if (generation !== analysisGenerationRef.current) return;
      const msg = err instanceof Error ? err.message : "Stage analysis failed";
      setStageNotesState((prev) => {
        const newAnalyzing = new Set(prev.analyzing);
        newAnalyzing.delete(-1);
        return { ...prev, analyzing: newAnalyzing, lastError: msg };
      });
    } finally {
      isAnalyzingRef.current = false;
    }
  }, []);

  // ── Flush pending buffer ──────────────────────────────────────────────────

  const flushPendingBuffer = useCallback(async (callId: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const pending = pendingBufferRef.current;
    if (pending.length === 0) return;

    const combinedText = pending.map((s) => s.text).join(" ");
    const combinedId = pending.map((s) => s.id).join("|");

    pendingBufferRef.current = [];

    await runAnalysis(callId, combinedText, combinedId);
  }, [runAnalysis]);

  // ── Feed a new finalized segment ─────────────────────────────────────────

  const feedSegment = useCallback((callId: string, segmentId: string, text: string) => {
    if (!text.trim()) return;

    // Skip already-analyzed segments
    if (analyzedSegmentIdsRef.current.has(segmentId)) return;
    analyzedSegmentIdsRef.current.add(segmentId);

    pendingBufferRef.current.push({ id: segmentId, text });
    const totalChars = pendingBufferRef.current.reduce((sum, s) => sum + s.text.length, 0);

    // Clear existing debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const timeSinceLast = Date.now() - lastAnalysisTimeRef.current;

    if (totalChars >= MIN_CHARS_FOR_ANALYSIS && timeSinceLast >= MIN_ANALYSIS_INTERVAL_MS) {
      // Enough content and enough time — analyze now
      flushPendingBuffer(callId);
    } else {
      // Schedule analysis after debounce
      const delay = Math.max(
        MIN_ANALYSIS_INTERVAL_MS - timeSinceLast,
        totalChars >= MIN_CHARS_FOR_ANALYSIS ? 500 : MAX_DEBOUNCE_MS
      );
      debounceTimerRef.current = setTimeout(() => {
        flushPendingBuffer(callId);
      }, delay);
    }
  }, [flushPendingBuffer]);

  // ── Run final analysis when recording stops ───────────────────────────────

  const runFinalAnalysis = useCallback(async (callId: string, remainingText: string) => {
    // finalTranscript is assembled from finalSegments, which are already fed
    // individually by page.tsx. Re-analyzing that whole string here repeats
    // every prior segment and spends quota without adding new evidence.
    void remainingText;
    await flushPendingBuffer(callId);
  }, [flushPendingBuffer]);

  // ── Mark note as reviewed ─────────────────────────────────────────────────

  const markNoteReviewed = useCallback((stageNumber: number, noteIndex: number) => {
    setStageNotesState((prev) => {
      const newNotes = new Map(prev.notes);
      const stageNotes = [...(newNotes.get(stageNumber) || [])];
      if (stageNotes[noteIndex]) {
        stageNotes[noteIndex] = { ...stageNotes[noteIndex], manually_edited: true, needs_review: false };
        newNotes.set(stageNumber, stageNotes);
      }
      const newNeedsReview = new Set(prev.needsReview);
      if (!stageNotes.some((n) => n.needs_review)) {
        newNeedsReview.delete(stageNumber);
      }
      return { ...prev, notes: newNotes, needsReview: newNeedsReview };
    });
  }, []);

  // ── Dismiss a note ────────────────────────────────────────────────────────

  const dismissNote = useCallback((stageNumber: number, noteIndex: number) => {
    setStageNotesState((prev) => {
      const newNotes = new Map(prev.notes);
      const stageNotes = [...(newNotes.get(stageNumber) || [])];
      stageNotes.splice(noteIndex, 1);
      newNotes.set(stageNumber, stageNotes);
      return { ...prev, notes: newNotes };
    });
  }, []);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const resetNotes = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingBufferRef.current = [];
    analyzedSegmentIdsRef.current = new Set();
    lastAnalysisTimeRef.current = 0;
    analysisGenerationRef.current += 1;
    setStageNotesState({
      notes: new Map(),
      analyzing: new Set(),
      needsReview: new Set(),
      lastError: null,
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getStageNotes = useCallback((stageNumber: number): StageNoteItem[] => {
    return stageNotesState.notes.get(stageNumber) || [];
  }, [stageNotesState.notes]);

  const stageHasNotes = useCallback((stageNumber: number): boolean => {
    return (stageNotesState.notes.get(stageNumber) || []).length > 0;
  }, [stageNotesState.notes]);

  const stageNeedsReview = useCallback((stageNumber: number): boolean => {
    return stageNotesState.needsReview.has(stageNumber);
  }, [stageNotesState.needsReview]);

  const stageIsAnalyzing = useCallback((_stageNumber: number): boolean => {
    return stageNotesState.analyzing.has(-1); // global indicator
  }, [stageNotesState.analyzing]);

  return {
    stageNotesState,
    getStageNotes,
    isAnalyzing,
    stageHasNotes,
    stageNeedsReview,
    stageIsAnalyzing,
    markNoteReviewed,
    dismissNote,
    runFinalAnalysis,
    resetNotes,
    feedSegment,
  };
}
