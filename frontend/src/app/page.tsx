"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/Header";
import { StageProgress } from "@/components/StageProgress";
import { CurrentStagePanel } from "@/components/CurrentStagePanel";
import { StartCallPanel } from "@/components/StartCallPanel";
import { EndCallModal } from "@/components/EndCallModal";
import { PastCallsList } from "@/components/PastCallsList";
import { CallDetailModal } from "@/components/CallDetailModal";
import { api } from "@/lib/api";
import {
  StageDefinition,
  Call,
  CreateCallPayload,
  CloseCallPayload,
  StageResult,
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
  const [isSavingStage, setIsSavingStage] = useState(false);
  const [isEndingCallModalOpen, setIsEndingCallModalOpen] = useState(false);
  const [isSubmittingClose, setIsSubmittingClose] = useState(false);
  const [apiConnected, setApiConnected] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Staged notes state for immediate responsiveness
  const [currentExactWords, setCurrentExactWords] = useState("");
  const [currentNotes, setCurrentNotes] = useState("");
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initial data loading
  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [healthRes, stagesRes, historyRes] = await Promise.all([
          api.getHealth().catch(() => null),
          api.getStages(),
          api.listCalls(),
        ]);
        if (ignore) return;
        setApiConnected(Boolean(healthRes));
        setStages(stagesRes);
        setCallsHistory(historyRes);

        const savedCallId = localStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
        if (savedCallId) {
          try {
            const callData = await api.getCall(savedCallId);
            if (!ignore && callData && callData.status === "in_progress") {
              setActiveCall(callData);
              const stageNum = callData.current_stage || 1;
              setCurrentStageNumber(stageNum);
              const stageRes = (callData.stage_results || []).find(
                (s) => s.stage_number === stageNum
              );
              setCurrentExactWords(stageRes?.prospect_exact_words || "");
              setCurrentNotes(stageRes?.notes || "");
            } else {
              localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
            }
          } catch {
            localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          setApiConnected(false);
          setGlobalError(
            err instanceof Error
              ? err.message
              : "Could not connect to CallFlow backend. Is the server running?"
          );
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

  // Helper to persist stage changes to backend with debouncing for text inputs
  const persistStageData = useCallback(
    async (
      stageNum: number,
      data: {
        selected_outcome?: string | null;
        prospect_exact_words?: string | null;
        notes?: string | null;
      }
    ) => {
      if (!activeCall) return;
      setIsSavingStage(true);
      try {
        const updatedSr = await api.updateStageResult(activeCall.id, stageNum, data);

        // Update local activeCall state
        setActiveCall((prev) => {
          if (!prev) return null;
          const existingStages = prev.stage_results || [];
          const idx = existingStages.findIndex((s) => s.stage_number === stageNum);
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
      } catch (err: unknown) {
        console.error("Failed to save stage result:", err);
      } finally {
        setIsSavingStage(false);
      }
    },
    [activeCall]
  );

  // Start Call Handler
  const handleStartCall = async (payload: CreateCallPayload) => {
    setIsStartingCall(true);
    setGlobalError(null);
    try {
      const newCall = await api.createCall(payload);
      // Fetch full call with empty stage_results
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

  // Outcome selection handler
  const handleSelectOutcome = (outcome: string) => {
    if (!activeCall) return;
    persistStageData(currentStageNumber, {
      selected_outcome: outcome,
      prospect_exact_words: currentExactWords,
      notes: currentNotes,
    });
  };

  // Debounced text changes
  const handleExactWordsChange = (text: string) => {
    setCurrentExactWords(text);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      persistStageData(currentStageNumber, {
        prospect_exact_words: text,
      });
    }, 700);
  };

  const handleNotesChange = (text: string) => {
    setCurrentNotes(text);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      persistStageData(currentStageNumber, {
        notes: text,
      });
    }, 700);
  };

  // Stage navigation
  const handleSelectStage = useCallback((stageNum: number) => {
    if (!activeCall) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      persistStageData(currentStageNumber, {
        prospect_exact_words: currentExactWords,
        notes: currentNotes,
      });
    }
    setCurrentStageNumber(stageNum);
    const targetSr = (activeCall.stage_results || []).find(
      (s) => s.stage_number === stageNum
    );
    setCurrentExactWords(targetSr?.prospect_exact_words || "");
    setCurrentNotes(targetSr?.notes || "");
  }, [activeCall, currentStageNumber, currentExactWords, currentNotes, persistStageData]);

  // Next Stage navigation
  const handleNextStage = async () => {
    if (!activeCall) return;

    // Immediately flush any pending notes to backend
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    await persistStageData(currentStageNumber, {
      prospect_exact_words: currentExactWords,
      notes: currentNotes,
    });

    if (currentStageNumber < stages.length) {
      const nextStage = currentStageNumber + 1;
      setCurrentStageNumber(nextStage);
      const targetSr = (activeCall.stage_results || []).find(
        (s) => s.stage_number === nextStage
      );
      setCurrentExactWords(targetSr?.prospect_exact_words || "");
      setCurrentNotes(targetSr?.notes || "");
      await api.advanceCallStage(activeCall.id, nextStage).catch(() => {});
    } else {
      // Reached Stage 8 finish action
      setIsEndingCallModalOpen(true);
    }
  };

  // End Call confirmation handler
  const handleConfirmEndCall = async (payload: CloseCallPayload) => {
    if (!activeCall) return;
    setIsSubmittingClose(true);
    try {
      // Save current stage data first
      await persistStageData(currentStageNumber, {
        prospect_exact_words: currentExactWords,
        notes: currentNotes,
      });

      const closedCall = await api.closeCall(activeCall.id, payload);
      localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
      setActiveCall(null);
      setIsEndingCallModalOpen(false);

      // Refresh history and open the closed call in detail inspection
      const updatedHistory = await api.listCalls();
      setCallsHistory(updatedHistory);
      setSelectedHistoryCall(closedCall);
      setActiveView("history");
    } catch (err: unknown) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to close call."
      );
    } finally {
      setIsSubmittingClose(false);
    }
  };

  // Direct inspect call from past calls list
  const handleInspectHistoryCall = async (callId: string) => {
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
        apiConnected={apiConnected}
      />

      {/* Global Error Banner */}
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
        {isLoadingInitial ? (
          <div className="flex h-96 flex-col items-center justify-center space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0062ff] border-t-transparent"></div>
            <p className="text-xs text-slate-400">Initializing CallFlow Assistant...</p>
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
                      onClick={() => setIsEndingCallModalOpen(true)}
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
                      stage={currentStageDef}
                      totalStages={stages.length}
                      stageResult={currentStageResult}
                      onUpdateOutcome={handleSelectOutcome}
                      onUpdateExactWords={handleExactWordsChange}
                      onUpdateNotes={handleNotesChange}
                      onNextStage={handleNextStage}
                      onEndCall={() => setIsEndingCallModalOpen(true)}
                      isSaving={isSavingStage}
                      isLastStage={currentStageNumber === stages.length}
                    />
                  )}
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
          onClose={() => setIsEndingCallModalOpen(false)}
          onConfirmEnd={handleConfirmEndCall}
          isSubmitting={isSubmittingClose}
        />
      )}

      {/* Historical Call Detail Inspection Modal */}
      {selectedHistoryCall && (
        <CallDetailModal
          call={selectedHistoryCall}
          stages={stages}
          onClose={() => setSelectedHistoryCall(null)}
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
