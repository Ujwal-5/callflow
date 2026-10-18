"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/Header";
import { StageProgress } from "@/components/StageProgress";
import { CurrentStagePanel } from "@/components/CurrentStagePanel";
import { StartCallPanel } from "@/components/StartCallPanel";
import { EndCallModal } from "@/components/EndCallModal";
import { PastCallsList } from "@/components/PastCallsList";
import { CallDetailModal } from "@/components/CallDetailModal";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { ServiceStatusBanner, type ServiceStatus } from "@/components/ServiceStatusBanner";

import { api } from "@/lib/api";
import {
  StageDefinition,
  Call,
  CreateCallPayload,
  CloseCallPayload,
  StageResult,
  StageSuggestion,
} from "@/types";

const ACTIVE_CALL_STORAGE_KEY = "callflow_active_call_id";

export default function Home() {
  const [activeView, setActiveView] = useState<"active" | "history">("active");
  const [stages, setStages] = useState<StageDefinition[]>([]);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [currentStageNumber, setCurrentStageNumber] = useState<number>(1);
  const [callsHistory, setCallsHistory] = useState<Call[]>([]);
  const [selectedHistoryCall, setSelectedHistoryCall] = useState<Call | null>(null);

  // UI state
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [isEndingCallModalOpen, setIsEndingCallModalOpen] = useState(false);
  const [initialModalOutcome, setInitialModalOutcome] = useState<string | undefined>(undefined);
  const [stageSuggestion, setStageSuggestion] = useState<StageSuggestion | null>(null);
  const [isSubmittingClose, setIsSubmittingClose] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("online");
  const [wakingElapsed, setWakingElapsed] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Auto-analysis state (triggered after call close)
  const [isAutoAnalyzing, setIsAutoAnalyzing] = useState(false);
  const [autoAnalysisError, setAutoAnalysisError] = useState<string | null>(null);
  /** Tracks which call ID is currently being auto-analyzed to prevent duplicate runs */
  const analysisRunningForRef = useRef<string | null>(null);

  // Wake polling refs
  const wakePollingRef = useRef<NodeJS.Timeout | null>(null);
  const wakeElapsedRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * stagePanelFlushRef holds a callback that CurrentStagePanel registers so the
   * parent can read the latest local text state before navigating away.
   * This avoids lifting exactWords/notes back up to the page (which would cause
   * the whole page to re-render on every keystroke).
   */
  const stagePanelFlushRef = useRef<
    (() => { exactWords: string; notes: string }) | null
  >(null);

  /**
   * copyToExactWordsRef holds a function registered by CurrentStagePanel
   * that lets the TranscriptPanel push text into the exact-words field.
   */
  const copyToExactWordsRef = useRef<((text: string) => void) | null>(null);

  // Initial data loading
  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        // Run health check in parallel but don't let it block stages/history
        const healthRes = await api.getHealth().catch(() => null);
        if (ignore) return;
        if (!healthRes) {
          // Backend is sleeping — still try to load stages from cache or show sleeping state
          setServiceStatus("sleeping");
          setIsLoadingInitial(false);
          return;
        }
        setServiceStatus("online");

        const [stagesRes, historyRes] = await Promise.all([
          api.getStages(),
          api.listCalls(),
        ]);
        if (ignore) return;
        setStages(stagesRes);
        setCallsHistory(historyRes);

        const savedCallId = localStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
        if (savedCallId) {
          try {
            const callData = await api.getCall(savedCallId);
            if (!ignore && callData && callData.status === "in_progress") {
              setActiveCall(callData);
              setCurrentStageNumber(callData.current_stage || 1);
            } else {
              localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
            }
          } catch {
            localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          setServiceStatus("sleeping");
          console.error("Init error:", err);
        }
      } finally {
        if (!ignore) {
          setIsLoadingInitial(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  /**
   * Persist stage data to backend.
   * Fire-and-forget by default (no await) so that UI is never blocked.
   * Returns a promise so callers that need to flush before navigating can await it.
   */
  const persistStageData = useCallback(
    (
      callId: string,
      stageNum: number,
      data: {
        selected_outcome?: string | null;
        prospect_exact_words?: string | null;
        notes?: string | null;
        status?: string | null;
      }
    ): Promise<void> => {
      return api
        .updateStageResult(callId, stageNum, data)
        .then((updatedSr) => {
          setActiveCall((prev) => {
            if (!prev) return null;
            const existingStages = prev.stage_results || [];
            const idx = existingStages.findIndex(
              (s) => s.stage_number === stageNum
            );
            let newStages: StageResult[];
            if (idx >= 0) {
              newStages = [...existingStages];
              newStages[idx] = updatedSr;
            } else {
              newStages = [...existingStages, updatedSr];
            }
            return {
              ...prev,
              current_stage: stageNum,
              highest_stage: Math.max(prev.highest_stage, stageNum),
              stage_results: newStages,
            };
          });
        })
        .catch((err: unknown) => {
          console.error("Failed to save stage result:", err);
        });
    },
    []
  );

  /**
   * Wake the Render backend:
   * 1. Immediately set status to "waking" and start an elapsed-seconds timer.
   * 2. Poll /health every 3s until it responds.
   * 3. On success, load stages + history, then set status to "online".
   */
  const handleWakeService = useCallback(() => {
    if (serviceStatus === "waking") return; // already trying

    // Clear any existing polling
    if (wakePollingRef.current) clearInterval(wakePollingRef.current);
    if (wakeElapsedRef.current) clearInterval(wakeElapsedRef.current);

    setServiceStatus("waking");
    setWakingElapsed(0);

    // Elapsed seconds counter
    let elapsed = 0;
    wakeElapsedRef.current = setInterval(() => {
      elapsed += 1;
      setWakingElapsed(elapsed);
    }, 1000);

    // Poll health every 3 seconds
    const poll = async () => {
      try {
        const healthRes = await api.getHealth().catch(() => null);
        if (healthRes) {
          // Service is up — stop polling
          if (wakePollingRef.current) clearInterval(wakePollingRef.current);
          if (wakeElapsedRef.current) clearInterval(wakeElapsedRef.current);

          setServiceStatus("online");
          setWakingElapsed(0);

          // Now load stages and history
          try {
            const [stagesRes, historyRes] = await Promise.all([
              api.getStages(),
              api.listCalls(),
            ]);
            setStages(stagesRes);
            setCallsHistory(historyRes);
            setIsLoadingInitial(false);
          } catch (err) {
            console.error("Failed to load data after wake:", err);
          }
        }
      } catch {
        // still waking, keep polling
      }
    };

    // Poll immediately, then every 3s
    poll();
    wakePollingRef.current = setInterval(poll, 3000);
  }, [serviceStatus]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (wakePollingRef.current) clearInterval(wakePollingRef.current);
      if (wakeElapsedRef.current) clearInterval(wakeElapsedRef.current);
    };
  }, []);

  // Start Call Handler
  const handleStartCall = async (payload: CreateCallPayload) => {
    setIsStartingCall(true);
    setGlobalError(null);
    try {
      const newCall = await api.createCall(payload);
      // Fetch full call with stage_results
      const fullCall = await api.getCall(newCall.id);
      setActiveCall(fullCall);
      setCurrentStageNumber(1);
      localStorage.setItem(ACTIVE_CALL_STORAGE_KEY, fullCall.id);
      setActiveView("active");

      // Refresh history list in background
      api.listCalls().then(setCallsHistory).catch(() => {});
    } catch (err: unknown) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to start call."
      );
    } finally {
      setIsStartingCall(false);
    }
  };

  /**
   * Outcome selection: fire save in background — no await, no loading state.
   * CurrentStagePanel already updated the button visually via local state.
   */
  const handleSelectOutcome = useCallback(
    (outcome: string) => {
      if (!activeCall) return;
      persistStageData(activeCall.id, currentStageNumber, {
        selected_outcome: outcome,
      });
    },
    [activeCall, currentStageNumber, persistStageData]
  );

  /**
   * Text changes: debounced save is initiated by CurrentStagePanel.
   * The parent's job here is just to call the API — no state changes that
   * would re-render siblings.
   */
  const handleExactWordsChange = useCallback(
    (text: string) => {
      if (!activeCall) return;
      persistStageData(activeCall.id, currentStageNumber, {
        prospect_exact_words: text,
      });
    },
    [activeCall, currentStageNumber, persistStageData]
  );

  const handleNotesChange = useCallback(
    (text: string) => {
      if (!activeCall) return;
      persistStageData(activeCall.id, currentStageNumber, {
        notes: text,
      });
    },
    [activeCall, currentStageNumber, persistStageData]
  );

  /**
   * Stage navigation: flush the panel's latest text before changing stage,
   * then switch immediately without waiting for the network.
   */
  const handleSelectStage = useCallback(
    (stageNum: number) => {
      if (!activeCall) return;
      // Flush latest local text from panel (non-blocking)
      if (stagePanelFlushRef.current) {
        const { exactWords, notes } = stagePanelFlushRef.current();
        persistStageData(activeCall.id, currentStageNumber, {
          prospect_exact_words: exactWords,
          notes,
        });
      }
      setCurrentStageNumber(stageNum);
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              current_stage: stageNum,
              highest_stage: Math.max(prev.highest_stage, stageNum),
            }
          : null
      );
      api.advanceCallStage(activeCall.id, stageNum).catch(() => {});
    },
    [activeCall, currentStageNumber, persistStageData]
  );

  /**
   * Mark stage as skipped or not applicable and move forward.
   */
  const handleSkipStage = useCallback(
    async (notApplicable: boolean = false) => {
      if (!activeCall) return;
      try {
        if (stagePanelFlushRef.current) {
          const { exactWords, notes } = stagePanelFlushRef.current();
          if (exactWords || notes) {
            await persistStageData(activeCall.id, currentStageNumber, {
              prospect_exact_words: exactWords,
              notes,
            });
          }
        }

        const updatedSr = await api.skipStage(
          activeCall.id,
          currentStageNumber,
          notApplicable
        );

        setActiveCall((prev) => {
          if (!prev) return null;
          const existingStages = prev.stage_results || [];
          const idx = existingStages.findIndex(
            (s) => s.stage_number === currentStageNumber
          );
          let newStages: StageResult[];
          if (idx >= 0) {
            newStages = [...existingStages];
            newStages[idx] = updatedSr;
          } else {
            newStages = [...existingStages, updatedSr];
          }
          return {
            ...prev,
            stage_results: newStages,
          };
        });

        if (currentStageNumber < stages.length) {
          const nextStage = currentStageNumber + 1;
          setCurrentStageNumber(nextStage);
          api.advanceCallStage(activeCall.id, nextStage).catch(() => {});
        }
      } catch (err) {
        console.error("Failed to skip stage:", err);
      }
    },
    [activeCall, currentStageNumber, stages.length, persistStageData]
  );

  /**
   * Quick early call termination presets (e.g. busy, uninterested, ready to schedule)
   */
  const handleQuickEndCall = useCallback((presetOutcome: string) => {
    setInitialModalOutcome(presetOutcome);
    setIsEndingCallModalOpen(true);
  }, []);

  /**
   * AI Stage Suggestion confirmation & dismiss
   */
  const handleApplyStageSuggestion = useCallback(
    (targetStage: number) => {
      handleSelectStage(targetStage);
      setStageSuggestion(null);
    },
    [handleSelectStage]
  );

  const handleDismissStageSuggestion = useCallback(() => {
    setStageSuggestion(null);
  }, []);

  // Poll or check for transcript-grounded stage suggestions
  useEffect(() => {
    if (!activeCall) {
      setStageSuggestion(null);
      return;
    }
    let isMounted = true;
    const checkSuggestion = async () => {
      try {
        const sugg = await api.getStageSuggestion(activeCall.id);
        if (isMounted) {
          setStageSuggestion(sugg);
        }
      } catch {
        // ignore background poll errors
      }
    };

    checkSuggestion();
    const interval = setInterval(checkSuggestion, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeCall?.id, currentStageNumber]);

  // Next Stage navigation
  const handleNextStage = useCallback(async () => {
    if (!activeCall) return;

    // Flush the panel's current text (non-blocking fire-and-forget)
    if (stagePanelFlushRef.current) {
      const { exactWords, notes } = stagePanelFlushRef.current();
      persistStageData(activeCall.id, currentStageNumber, {
        prospect_exact_words: exactWords,
        notes,
      });
    }

    if (currentStageNumber < stages.length) {
      const nextStage = currentStageNumber + 1;
      setCurrentStageNumber(nextStage);
      // Advance call stage in background
      api.advanceCallStage(activeCall.id, nextStage).catch(() => {});
    } else {
      // Reached Stage 8 finish action
      setInitialModalOutcome(undefined);
      setIsEndingCallModalOpen(true);
    }
  }, [activeCall, currentStageNumber, stages.length, persistStageData]);

  // End Call confirmation handler
  const handleConfirmEndCall = async (payload: CloseCallPayload) => {
    if (!activeCall) return;
    setIsSubmittingClose(true);
    try {
      // Flush the panel's current text before closing
      if (stagePanelFlushRef.current) {
        const { exactWords, notes } = stagePanelFlushRef.current();
        await persistStageData(activeCall.id, currentStageNumber, {
          prospect_exact_words: exactWords,
          notes,
        });
      }

      const closedCall = await api.closeCall(activeCall.id, payload);
      localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
      setActiveCall(null);
      setIsEndingCallModalOpen(false);
      setInitialModalOutcome(undefined);

      // Refresh history and open the closed call in detail inspection
      const updatedHistory = await api.listCalls();
      setCallsHistory(updatedHistory);
      setSelectedHistoryCall(closedCall);
      setActiveView("history");

      // ── Auto-analysis: fire-and-forget, non-blocking ──
      // Guard: only run if this call hasn't already been analyzed
      const hasExistingSummary = Boolean(closedCall.ai_summary);
      const callId = closedCall.id;

      if (!hasExistingSummary && analysisRunningForRef.current !== callId) {
        analysisRunningForRef.current = callId;
        setIsAutoAnalyzing(true);
        setAutoAnalysisError(null);

        (async () => {
          try {
            // Run summary + gap analysis + radar concurrently; all results persist to DB.
            // ConversationReview auto-loads persisted gap/radar data on mount, so we only
            // need to capture the summary result here to update the call state.
            const [summaryRes] = await Promise.allSettled([
              api.generateCallSummary(callId),
              api.analyzeConversationGaps(callId),
              api.analyzeRadar(callId),
            ]);

            // Update call with summary if available
            if (summaryRes.status === "fulfilled" && summaryRes.value.available && summaryRes.value.summary) {
              setSelectedHistoryCall((prev) =>
                prev && prev.id === callId
                  ? { ...prev, ai_summary: summaryRes.value.summary! }
                  : prev
              );
            } else if (summaryRes.status === "rejected") {
              const msg = summaryRes.reason instanceof Error
                ? summaryRes.reason.message
                : "AI summary generation failed.";
              setAutoAnalysisError(msg);
            } else if (summaryRes.status === "fulfilled" && summaryRes.value.error) {
              setAutoAnalysisError(summaryRes.value.error);
            }
          } catch {
            setAutoAnalysisError("Analysis failed. You can retry from the AI Summary section.");
          } finally {
            setIsAutoAnalyzing(false);
            analysisRunningForRef.current = null;
          }
        })();
      }
    } catch (err: unknown) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to close call."
      );
    } finally {
      setIsSubmittingClose(false);
    }
  };

  /**
   * Manual retry for auto-analysis — called from CallDetailModal's AI summary section.
   * Safe to call multiple times; guards against concurrent runs.
   */
  const handleRetryAnalysis = async () => {
    if (!selectedHistoryCall) return;
    const callId = selectedHistoryCall.id;
    if (analysisRunningForRef.current === callId) return; // already running

    analysisRunningForRef.current = callId;
    setIsAutoAnalyzing(true);
    setAutoAnalysisError(null);

    try {
      const [summaryRes] = await Promise.allSettled([
        api.generateCallSummary(callId),
        api.analyzeConversationGaps(callId),
        api.analyzeRadar(callId),
      ]);

      if (summaryRes.status === "fulfilled" && summaryRes.value.available && summaryRes.value.summary) {
        setSelectedHistoryCall((prev) =>
          prev && prev.id === callId
            ? { ...prev, ai_summary: summaryRes.value.summary! }
            : prev
        );
      } else if (summaryRes.status === "rejected") {
        setAutoAnalysisError(
          summaryRes.reason instanceof Error ? summaryRes.reason.message : "Retry failed."
        );
      }
    } catch {
      setAutoAnalysisError("Retry failed. Check connection and try again.");
    } finally {
      setIsAutoAnalyzing(false);
      analysisRunningForRef.current = null;
    }
  };

  // Direct inspect call from past calls list
  const handleInspectHistoryCall = async (callId: string) => {
    // Reset any lingering auto-analysis state from a previous call closure
    setAutoAnalysisError(null);
    setIsAutoAnalyzing(false);
    try {
      const fullCall = await api.getCall(callId);
      setSelectedHistoryCall(fullCall);
    } catch (err: unknown) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to load call details."
      );
    }
  };

  const currentStageDef = stages.find(
    (s) => s.stage_number === currentStageNumber
  ) || stages[0];

  const currentStageResult = (activeCall?.stage_results || []).find(
    (s) => s.stage_number === currentStageNumber
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#070d1e] text-slate-100">
      {/* App Header */}
      <Header
        activeView={activeView}
        onViewChange={setActiveView}
        activeCall={activeCall}
        historyCount={callsHistory.length}
        serviceStatus={serviceStatus}
      />

      {/* Service Status Banner (sleeping / waking / online confirmation) */}
      <ServiceStatusBanner
        status={serviceStatus}
        onWake={handleWakeService}
        wakingElapsed={wakingElapsed}
      />

      {/* Global Error Banner (non-connectivity errors only) */}
      {globalError && (
        <div className="border-b border-rose-500/50 bg-rose-950/70 px-4 py-2 text-xs text-rose-200">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <span>{globalError}</span>
            <button
              onClick={() => window.location.reload()}
              className="ml-4 rounded bg-rose-800 px-2 py-0.5 text-[11px] font-semibold hover:bg-rose-700"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1">
        {isLoadingInitial && serviceStatus !== "sleeping" ? (
          <div className="flex h-96 flex-col items-center justify-center space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0062ff] border-t-transparent"></div>
            <p className="text-xs text-slate-400">Initializing CallFlow Assistant...</p>
          </div>
        ) : serviceStatus === "sleeping" ? (
          /* ── Service sleeping splash ── */
          <div className="flex h-96 flex-col items-center justify-center space-y-4 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 bg-[#101c3d]">
              <svg
                className="h-5 w-5 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">Assistant is inactive</p>
              <p className="mt-1 text-xs text-slate-400 max-w-xs">
                Start the service using the banner above, then you&apos;ll be ready to take calls.
              </p>
            </div>
          </div>
        ) : activeView === "history" ? (
          /* SCREEN B: Past Calls History */
          <div className="p-4 sm:p-6">
            <div className="mx-auto max-w-6xl mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-white">Call History</h1>
                <p className="text-xs text-slate-400">
                  Search, review, and analyze previously completed cold-call sessions.
                </p>
              </div>
              {activeCall && (
                <button
                  onClick={() => setActiveView("active")}
                  className="rounded bg-[#0062ff] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0052d9]"
                >
                  Return to Live Call →
                </button>
              )}
            </div>

            <PastCallsList
              calls={callsHistory}
              onSelectCall={handleInspectHistoryCall}
            />
          </div>
        ) : (
          /* SCREEN A: Active Call Workflow */
          <div>
            {!activeCall ? (
              <div className="p-6 sm:p-12">
                <StartCallPanel
                  onStartCall={handleStartCall}
                  isLoading={isStartingCall}
                />
              </div>
            ) : (
              <div>
                {/* Active Call Prospect Details Bar */}
                <div className="border-b border-[#233554] bg-[#0b132b] px-4 py-3 sm:px-6">
                  <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-[#101c3d] text-[#0062ff] font-bold text-xs border border-[#233554]">
                        🏢
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h1 className="text-base font-bold text-white">
                            {activeCall.company_name}
                          </h1>
                          <span className="rounded bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-400 uppercase">
                            Active
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                          {activeCall.contact_name && (
                            <span>
                              <span className="text-slate-400">Contact:</span>{" "}
                              <strong className="text-slate-200">
                                {activeCall.contact_name}
                              </strong>
                            </span>
                          )}
                          {activeCall.phone_number && (
                            <span>
                              <span className="text-slate-400">Phone:</span>{" "}
                              <span className="font-mono text-slate-300">
                                {activeCall.phone_number}
                              </span>
                            </span>
                          )}
                          {activeCall.context && (
                            <span className="italic text-slate-400">
                              &ldquo;{activeCall.context}&rdquo;
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quick End Action */}
                    <button
                      type="button"
                      onClick={() => {
                        setInitialModalOutcome(undefined);
                        setIsEndingCallModalOpen(true);
                      }}
                      className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-1 text-xs font-semibold text-rose-300 hover:border-rose-400 hover:bg-rose-900/50 hover:text-white transition-colors"
                    >
                      End Call
                    </button>
                  </div>
                </div>

                {/* Eight-Stage Stepper Progress */}
                <StageProgress
                  stages={stages}
                  currentStageNumber={currentStageNumber}
                  highestStageReached={activeCall.highest_stage}
                  stageResults={activeCall.stage_results}
                  onSelectStage={handleSelectStage}
                />

                {/* Current Stage Panel */}
                <div className="mx-auto max-w-4xl p-4 sm:p-6">
                  {currentStageDef && (
                    <CurrentStagePanel
                      key={currentStageNumber}
                      stage={currentStageDef}
                      totalStages={stages.length}
                      allStages={stages}
                      stageResult={currentStageResult}
                      onUpdateOutcome={handleSelectOutcome}
                      onUpdateExactWords={handleExactWordsChange}
                      onUpdateNotes={handleNotesChange}
                      onNextStage={handleNextStage}
                      onEndCall={() => {
                        setInitialModalOutcome(undefined);
                        setIsEndingCallModalOpen(true);
                      }}
                      onSelectStage={handleSelectStage}
                      onSkipStage={handleSkipStage}
                      onQuickEndCall={handleQuickEndCall}
                      stageSuggestion={stageSuggestion}
                      onApplyStageSuggestion={handleApplyStageSuggestion}
                      onDismissStageSuggestion={handleDismissStageSuggestion}
                      isSaving={false}
                      isLastStage={currentStageNumber === stages.length}
                      onRegisterFlush={(fn) => {
                        stagePanelFlushRef.current = fn;
                      }}
                      onRegisterCopyExactWords={(fn) => {
                        copyToExactWordsRef.current = fn;
                      }}
                    />
                  )}

                  {/* Transcript Panel — collapsible, additive, does not replace manual notes */}
                  <TranscriptPanel
                    callId={activeCall.id}
                    onCopyToExactWords={(text) => {
                      if (copyToExactWordsRef.current) {
                        copyToExactWordsRef.current(text);
                      }
                    }}
                    onTranscriptChange={() => {
                      if (activeCall) {
                        api
                          .getStageSuggestion(activeCall.id)
                          .then(setStageSuggestion)
                          .catch(() => {});
                      }
                    }}
                  />

                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* End Call Modal */}
      {activeCall && isEndingCallModalOpen && (
        <EndCallModal
          isOpen={isEndingCallModalOpen}
          call={activeCall}
          currentStageNumber={currentStageNumber}
          currentStageName={currentStageDef?.name || "Close"}
          initialOutcome={initialModalOutcome}
          onClose={() => {
            setIsEndingCallModalOpen(false);
            setInitialModalOutcome(undefined);
          }}
          onConfirmEnd={handleConfirmEndCall}
          isSubmitting={isSubmittingClose}
        />
      )}

      {/* Historical Call Detail Inspection Modal */}
      {selectedHistoryCall && (
        <CallDetailModal
          call={selectedHistoryCall}
          stages={stages}
          isAutoAnalyzing={isAutoAnalyzing}
          autoAnalysisError={autoAnalysisError}
          onRetryAnalysis={handleRetryAnalysis}
          onClose={() => {
            setSelectedHistoryCall(null);
            setAutoAnalysisError(null);
          }}
          onResumeCall={(callToResume) => {
            setActiveCall(callToResume);
            setCurrentStageNumber(callToResume.current_stage || 1);
            localStorage.setItem(ACTIVE_CALL_STORAGE_KEY, callToResume.id);
            setSelectedHistoryCall(null);
            setActiveView("active");
          }}
        />
      )}
    </div>
  );
}
