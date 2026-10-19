"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { NavigationSidebar } from "@/components/NavigationSidebar";
import { OverviewView } from "@/components/OverviewView";
import { ProspectWorkspace } from "@/components/ProspectWorkspace";
import { FollowupsView } from "@/components/FollowupsView";
import { StageProgress } from "@/components/StageProgress";
import { CurrentStagePanel } from "@/components/CurrentStagePanel";
import { StartCallPanel } from "@/components/StartCallPanel";
import { EndCallModal } from "@/components/EndCallModal";
import { PastCallsList } from "@/components/PastCallsList";
import { CallDetailModal } from "@/components/CallDetailModal";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { ServiceStatusBanner, type ServiceStatus } from "@/components/ServiceStatusBanner";
import { StageAINotesPanel } from "@/components/StageAINotesPanel";
import { useLiveTranscription } from "@/hooks/useLiveTranscription";
import { useStageNotesAnalysis } from "@/hooks/useStageNotesAnalysis";

import { api, isBackendSleepingError } from "@/lib/api";
import {
  StageDefinition,
  Call,
  CreateCallPayload,
  CloseCallPayload,
  StageResult,
  StageSuggestion,
  StageAssistRecommendation,
  Prospect,
  FollowUpItem,
  CreateProspectPayload,
  MainNavigationArea,
} from "@/types";

const ACTIVE_CALL_STORAGE_KEY = "callflow_active_call_id";
const KEEP_ALIVE_STORAGE_KEY = "callflow_keep_alive_enabled";
const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;

export default function Home() {
  const [activeView, setActiveView] = useState<MainNavigationArea>("overview");
  const [stages, setStages] = useState<StageDefinition[]>([]);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [currentStageNumber, setCurrentStageNumber] = useState<number>(1);
  const [callsHistory, setCallsHistory] = useState<Call[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [followups, setFollowups] = useState<FollowUpItem[]>([]);
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null);
  const [selectedHistoryCall, setSelectedHistoryCall] = useState<Call | null>(null);

  // ── Live transcription & AI stage-note analysis (page-level, survives stage nav) ──
  const liveTranscription = useLiveTranscription();
  const stageNotesAnalysis = useStageNotesAnalysis();

  // Pre-call briefing and prefilled prospect for Active Call
  const [initialCallProspect, setInitialCallProspect] = useState<Prospect | null>(null);
  const [preCallBriefing, setPreCallBriefing] = useState<string | null>(null);

  // UI state
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [isEndingCallModalOpen, setIsEndingCallModalOpen] = useState(false);
  const [initialModalOutcome, setInitialModalOutcome] = useState<string | undefined>(undefined);
  const [stageSuggestion, setStageSuggestion] = useState<StageSuggestion | null>(null);
  const [stageAssistRecommendations, setStageAssistRecommendations] = useState<Map<number, StageAssistRecommendation>>(new Map());
  const [transcriptHighlight, setTranscriptHighlight] = useState<string | null>(null);
  const stageSuggestionRequestRef = useRef<{ callId: string; stage: number; transcript: string } | null>(null);
  const [isSubmittingClose, setIsSubmittingClose] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("online");
  const [keepAliveEnabled, setKeepAliveEnabled] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem(KEEP_ALIVE_STORAGE_KEY) === "true"
  );
  const [wakingElapsed, setWakingElapsed] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isLiveAssistVisible, setIsLiveAssistVisible] = useState(false);

  useEffect(() => {
    if (["requesting", "connecting", "recording", "stopping"].includes(liveTranscription.state)) {
      setIsLiveAssistVisible(true);
    }
  }, [liveTranscription.state]);

  // Auto-analysis state (triggered after call close)
  const [isAutoAnalyzing, setIsAutoAnalyzing] = useState(false);
  const [autoAnalysisError, setAutoAnalysisError] = useState<string | null>(null);
  const analysisRunningForRef = useRef<string | null>(null);

  // Wake polling refs
  const wakePollingRef = useRef<NodeJS.Timeout | null>(null);
  const wakeElapsedRef = useRef<NodeJS.Timeout | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stagePanelFlushRef = useRef<
    (() => { exactWords: string; notes: string }) | null
  >(null);

  const copyToExactWordsRef = useRef<((text: string) => void) | null>(null);
  const appendStageNotesRef = useRef<((text: string) => void) | null>(null);
  const stageAssistRequestRef = useRef<Map<number, number>>(new Map());

  // Feed each new final segment to stage-note analysis (deduplication is inside the hook)
  useEffect(() => {
    if (!activeCall || liveTranscription.finalSegments.length === 0) return;
    const latest = liveTranscription.finalSegments[liveTranscription.finalSegments.length - 1];
    if (latest) {
      stageNotesAnalysis.feedSegment(activeCall.id, latest.id, latest.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTranscription.finalSegments]);

  // One advisory stage-assist request only after meaningful finalized evidence.
  // It never writes notes or outcomes; confirmed caller choices remain untouched.
  useEffect(() => {
    if (!activeCall) return;
    const transcript = liveTranscription.finalTranscript.trim();
    if (transcript.length < 80) return;
    const priorLength = stageAssistRequestRef.current.get(currentStageNumber) || 0;
    if (transcript.length - priorLength < 200 && priorLength !== 0) return;
    const timeout = setTimeout(async () => {
      stageAssistRequestRef.current.set(currentStageNumber, transcript.length);
      try {
        const recommendation = await api.getStageAssistRecommendation(activeCall.id, currentStageNumber, transcript);
        setStageAssistRecommendations((previous) => {
          const next = new Map(previous);
          next.set(currentStageNumber, recommendation);
          return next;
        });
      } catch {
        // Assistive suggestions must not disrupt the call UI.
      }
    }, 1200);
    return () => clearTimeout(timeout);
  }, [activeCall?.id, currentStageNumber, liveTranscription.finalTranscript]);

  const showError = useCallback(async (err: unknown, fallback: string) => {
    try {
      const isInactive = await api.isRenderReallyInactive();
      if (isInactive) {
        setServiceStatus("sleeping");
        setGlobalError(null);
        return;
      }
    } catch {
      // ignore
    }
    setGlobalError(err instanceof Error ? err.message : fallback);
  }, []);

  // Listen for background service inactivity from API client
  useEffect(() => {
    const unsub = api.onServiceUnavailable(() => {
      setServiceStatus("sleeping");
      setGlobalError(null);
    });
    return unsub;
  }, []);

  // Render's free tier sleeps after inactivity. A lightweight health request
  // every ten minutes keeps it warm while this page remains open.
  useEffect(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }

    if (!keepAliveEnabled || serviceStatus !== "online") return;

    const ping = async () => {
      const healthRes = await api.getHealth({ retries: 0, delayMs: 0 }).catch(() => null);
      if (!healthRes) {
        setServiceStatus("sleeping");
      }
    };

    keepAliveRef.current = setInterval(ping, KEEP_ALIVE_INTERVAL_MS);
    return () => {
      if (keepAliveRef.current) {
        clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
    };
  }, [keepAliveEnabled, serviceStatus]);

  // Initial data loading
  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const healthRes = await api.getHealth().catch(() => null);
        if (ignore) return;
        if (!healthRes) {
          const reallyInactive = await api.isRenderReallyInactive();
          if (ignore) return;
          if (reallyInactive) {
            setServiceStatus("sleeping");
            setIsLoadingInitial(false);
            return;
          }
        }
        setServiceStatus("online");

        const [stagesRes, historyRes, prospectsRes, followupsRes] = await Promise.all([
          api.getStages().catch(() => []),
          api.listCalls().catch(() => []),
          api.listProspects().catch(() => []),
          api.listFollowups().catch(() => []),
        ]);
        if (ignore) return;
        setStages(stagesRes);
        setCallsHistory(historyRes);
        setProspects(prospectsRes);
        setFollowups(followupsRes);

        const savedCallId = localStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
        if (savedCallId) {
          try {
            const callData = await api.getCall(savedCallId);
            if (!ignore && callData && callData.status === "in_progress") {
              setActiveCall(callData);
              setCurrentStageNumber(callData.current_stage || 1);
              setActiveView("active");
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

  const [overdueCount, setOverdueCount] = useState(0);

  // Compute overdue count for badge in effect to prevent prerender hydration errors
  useEffect(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const count = followups.filter((item) => {
      if (item.status === "completed" || item.status === "dismissed") return false;
      if (item.due_at) {
        try {
          return new Date(item.due_at) < startOfToday;
        } catch {}
      }
      const rel = (item.relative_due || "").toLowerCase();
      if (rel.includes("yesterday") || rel.includes("last week")) return true;
      if (item.created_at) {
        try {
          const daysDiff = (now.getTime() - new Date(item.created_at).getTime()) / (1000 * 3600 * 24);
          if (daysDiff > 2 && (rel.includes("tomorrow") || rel.includes("today") || rel.includes("30 min") || rel.includes("evening"))) {
            return true;
          }
        } catch {}
      }
      return false;
    }).length;
    setOverdueCount(count);
  }, [followups]);

  // Persist stage data
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
          setGlobalError("Couldn’t save this stage yet. Your edits remain in the form; try again or navigate away and back to retry.");
        });
    },
    []
  );

  // Wake backend helper
  const handleWakeService = useCallback(() => {
    if (serviceStatus === "waking") return;

    if (wakePollingRef.current) clearInterval(wakePollingRef.current);
    if (wakeElapsedRef.current) clearInterval(wakeElapsedRef.current);

    setServiceStatus("waking");
    setKeepAliveEnabled(true);
    localStorage.setItem(KEEP_ALIVE_STORAGE_KEY, "true");
    setWakingElapsed(0);

    let elapsed = 0;
    wakeElapsedRef.current = setInterval(() => {
      elapsed += 1;
      setWakingElapsed(elapsed);
    }, 1000);

    const poll = async () => {
      try {
        const healthRes = await api.getHealth({ retries: 0 }).catch(() => null);
        if (healthRes) {
          if (wakePollingRef.current) clearInterval(wakePollingRef.current);
          if (wakeElapsedRef.current) clearInterval(wakeElapsedRef.current);

          setServiceStatus("online");
          setWakingElapsed(0);

          try {
            const [stagesRes, historyRes, prospectsRes, followupsRes] = await Promise.all([
              api.getStages(),
              api.listCalls(),
              api.listProspects(),
              api.listFollowups(),
            ]);
            setStages(stagesRes);
            setCallsHistory(historyRes);
            setProspects(prospectsRes);
            setFollowups(followupsRes);
            setIsLoadingInitial(false);
          } catch (err) {
            console.error("Failed to load data after wake:", err);
          }
        }
      } catch {}
    };

    poll();
    wakePollingRef.current = setInterval(poll, 3000);
  }, [serviceStatus]);

  const handleToggleKeepAlive = useCallback(() => {
    setKeepAliveEnabled((enabled) => {
      const nextEnabled = !enabled;
      localStorage.setItem(KEEP_ALIVE_STORAGE_KEY, String(nextEnabled));
      return nextEnabled;
    });
  }, []);

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
      const fullCall = await api.getCall(newCall.id);
      setActiveCall(fullCall);
      setCurrentStageNumber(1);
      localStorage.setItem(ACTIVE_CALL_STORAGE_KEY, fullCall.id);
      setActiveView("active");

      // Reset live transcription and AI note state for the new call
      liveTranscription.reset();
      stageNotesAnalysis.resetNotes();
      setStageAssistRecommendations(new Map());
      stageAssistRequestRef.current = new Map();

      // Refresh calls in background
      api.listCalls().then(setCallsHistory).catch(() => {});
    } catch (err: unknown) {
      showError(err, "Failed to start call.");
    } finally {
      setIsStartingCall(false);
    }
  };

  // Start call targeting a selected prospect
  const handleStartCallWithProspect = (prospect: Prospect, briefing?: string) => {
    setInitialCallProspect(prospect);
    setPreCallBriefing(briefing || null);
    setSelectedProspectId(prospect.id);
    setActiveView("active");
  };

  const handleStartNewCall = () => {
    setInitialCallProspect(null);
    setPreCallBriefing(null);
    setActiveView("active");
  };

  const handleSelectOutcome = useCallback(
    (outcome: string) => {
      if (!activeCall) return;
      persistStageData(activeCall.id, currentStageNumber, {
        selected_outcome: outcome,
      });
    },
    [activeCall, currentStageNumber, persistStageData]
  );

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

  const handleSelectStage = useCallback(
    (stageNum: number) => {
      if (!activeCall) return;
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

  const handleQuickEndCall = useCallback((presetOutcome: string) => {
    setInitialModalOutcome(presetOutcome);
    setIsEndingCallModalOpen(true);
  }, []);

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

  // Re-evaluate stage suggestions when the call/stage changes or new finalized
  // transcript text arrives. Polling here re-ran Gemini against identical text.
  useEffect(() => {
    if (!activeCall) {
      setStageSuggestion(null);
      return;
    }
    let isMounted = true;
    const transcript = liveTranscription.finalTranscript.trim();
    const previousRequest = stageSuggestionRequestRef.current;
    const sameContext = previousRequest?.callId === activeCall.id && previousRequest.stage === currentStageNumber;
    if (
      transcript && sameContext && previousRequest.transcript &&
      transcript.length - previousRequest.transcript.length < 200
    ) return;
    const checkSuggestion = async () => {
      try {
        stageSuggestionRequestRef.current = { callId: activeCall.id, stage: currentStageNumber, transcript };
        const sugg = await api.getStageSuggestion(
          activeCall.id,
          transcript || undefined,
          currentStageNumber
        );
        if (isMounted) {
          setStageSuggestion(sugg);
        }
      } catch {}
    };

    const timeout = setTimeout(checkSuggestion, transcript ? 1200 : 0);
    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [activeCall?.id, currentStageNumber, liveTranscription.finalTranscript]);

  const handleNextStage = useCallback(async () => {
    if (!activeCall) return;

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
      api.advanceCallStage(activeCall.id, nextStage).catch(() => {});
    } else {
      setInitialModalOutcome(undefined);
      setIsEndingCallModalOpen(true);
    }
  }, [activeCall, currentStageNumber, stages.length, persistStageData]);

  // End Call confirmation handler
  const handleConfirmEndCall = async (payload: CloseCallPayload) => {
    if (!activeCall) return;
    setIsSubmittingClose(true);
    try {
      if (stagePanelFlushRef.current) {
        const { exactWords, notes } = stagePanelFlushRef.current();
        await persistStageData(activeCall.id, currentStageNumber, {
          prospect_exact_words: exactWords,
          notes,
        });
      }

      // ── Stop live recording and run any remaining analysis ──
      const capturedCallId = activeCall.id;
      const capturedTranscript = liveTranscription.finalTranscript;
      if (
        liveTranscription.state === "recording" ||
        liveTranscription.state === "connecting"
      ) {
        liveTranscription.stopRecording();
        // Brief grace period for the final WebSocket response
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Run any outstanding stage-note analysis on remaining transcript
      await stageNotesAnalysis.runFinalAnalysis(capturedCallId, capturedTranscript).catch(() => {});

      const closedCall = await api.closeCall(activeCall.id, payload);
      localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
      setActiveCall(null);
      setIsEndingCallModalOpen(false);
      setInitialModalOutcome(undefined);
      setPreCallBriefing(null);
      setInitialCallProspect(null);

      // Refresh history & follow-ups
      const [updatedHistory, updatedFollowups] = await Promise.all([
        api.listCalls(),
        api.listFollowups(),
      ]);
      setCallsHistory(updatedHistory);
      setFollowups(updatedFollowups);
      setSelectedHistoryCall(closedCall);

      // ── Auto-analysis in background ──
      const hasExistingSummary = Boolean(closedCall.ai_summary);
      const callId = closedCall.id;

      if (!hasExistingSummary && analysisRunningForRef.current !== callId) {
        analysisRunningForRef.current = callId;
        setIsAutoAnalyzing(true);
        setAutoAnalysisError(null);

        (async () => {
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
                summaryRes.reason instanceof Error
                  ? summaryRes.reason.message
                  : "AI summary generation failed."
              );
            }
            // Refresh follow-ups with freshly extracted commitments
            api.listFollowups().then(setFollowups).catch(() => {});
          } catch {
            setAutoAnalysisError("Analysis failed. You can retry from the AI Summary section.");
          } finally {
            setIsAutoAnalyzing(false);
            analysisRunningForRef.current = null;
          }
        })();
      }
    } catch (err: unknown) {
      showError(err, "Failed to close call.");
    } finally {
      setIsSubmittingClose(false);
    }
  };

  const handleRetryAnalysis = async () => {
    if (!selectedHistoryCall) return;
    const callId = selectedHistoryCall.id;
    if (analysisRunningForRef.current === callId) return;

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
      }
      api.listFollowups().then(setFollowups).catch(() => {});
    } catch {
      setAutoAnalysisError("Retry failed. Check connection and try again.");
    } finally {
      setIsAutoAnalyzing(false);
      analysisRunningForRef.current = null;
    }
  };

  // Inspect history call
  const handleInspectHistoryCall = async (callId: string) => {
    setAutoAnalysisError(null);
    setIsAutoAnalyzing(false);
    try {
      const fullCall = await api.getCall(callId);
      setSelectedHistoryCall(fullCall);
    } catch (err: unknown) {
      showError(err, "Failed to load call details.");
    }
  };

  // Follow-up actions
  const handleCompleteFollowup = async (followupId: string) => {
    try {
      const updated = await api.updateFollowup(followupId, { status: "completed" });
      setFollowups((prev) => prev.map((f) => (f.id === followupId ? updated : f)));
    } catch (err) {
      console.error("Failed to complete followup:", err);
    }
  };

  const handleRescheduleFollowup = async (
    followupId: string,
    newTiming: string,
    newDate?: string
  ) => {
    try {
      const updated = await api.updateFollowup(followupId, {
        relative_due: newTiming,
        due_at: newDate,
        status: "pending",
      });
      setFollowups((prev) => prev.map((f) => (f.id === followupId ? updated : f)));
    } catch (err) {
      console.error("Failed to reschedule followup:", err);
    }
  };

  // Prospect creation
  const handleCreateProspect = async (payload: CreateProspectPayload): Promise<Prospect> => {
    const created = await api.createProspect(payload);
    const updatedList = await api.listProspects();
    setProspects(updatedList);
    return created;
  };

  // Delete handlers
  const handleDeleteCall = async (callId: string) => {
    try {
      await api.deleteCall(callId);
      setCallsHistory((prev) => prev.filter((c) => c.id !== callId));
      if (selectedHistoryCall?.id === callId) {
        setSelectedHistoryCall(null);
      }
      if (activeCall?.id === callId) {
        setActiveCall(null);
        localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
      }
      setFollowups((prev) => prev.filter((f) => f.call_id !== callId));
    } catch (err: unknown) {
      showError(err, "Failed to delete call record.");
    }
  };

  const handleDeleteProspect = async (prospectId: string) => {
    try {
      await api.deleteProspect(prospectId);
      setProspects((prev) => prev.filter((p) => p.id !== prospectId));
      if (selectedProspectId === prospectId) {
        setSelectedProspectId(null);
      }
    } catch (err: unknown) {
      showError(err, "Failed to delete prospect.");
    }
  };

  const handleDeleteFollowup = async (followupId: string) => {
    try {
      await api.deleteFollowup(followupId);
      setFollowups((prev) => prev.filter((f) => f.id !== followupId));
    } catch (err: unknown) {
      showError(err, "Failed to delete follow-up.");
    }
  };


  const currentStageDef = stages.find(
    (s) => s.stage_number === currentStageNumber
  ) || stages[0];

  const currentStageResult = (activeCall?.stage_results || []).find(
    (s) => s.stage_number === currentStageNumber
  );

  return (
    <div className="flex min-h-screen bg-[#070d1e] text-slate-100">
      {/* ── Persistent Navigation Sidebar ── */}
      <NavigationSidebar
        activeView={activeView}
        onViewChange={setActiveView}
        activeCall={activeCall}
        historyCount={callsHistory.length}
        prospectsCount={prospects.length}
        followupsCount={followups.length}
        overdueCount={overdueCount}
        serviceStatus={serviceStatus}
        onStartNewCall={handleStartNewCall}
      />

      {/* ── Main Layout Column ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Service Status Banner (sleeping / waking) */}
        <ServiceStatusBanner
          status={serviceStatus}
          onWake={handleWakeService}
          keepAliveEnabled={keepAliveEnabled}
          onToggleKeepAlive={handleToggleKeepAlive}
          wakingElapsed={wakingElapsed}
        />

        {/* Global Error Banner */}
        {globalError && serviceStatus !== "sleeping" && (
          <div className="border-b border-rose-500/50 bg-rose-950/70 px-4 py-2 text-xs text-rose-200">
            <div className="mx-auto flex max-w-6xl items-center justify-between">
              <span>{globalError}</span>
              <button
                onClick={() => setGlobalError(null)}
                className="ml-4 rounded bg-rose-800 px-2 py-0.5 text-[11px] font-semibold hover:bg-rose-700"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* ── Main View Content ── */}
        <main className={`flex-1 p-4 sm:p-6 lg:p-8 w-full mx-auto ${activeView === "active" ? "max-w-[1600px]" : "max-w-7xl"}`}>
          {isLoadingInitial && serviceStatus !== "sleeping" ? (
            <div className="flex h-96 flex-col items-center justify-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0062ff] border-t-transparent"></div>
              <p className="text-xs text-slate-400">Loading CallFlow Workspace...</p>
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
                <p className="text-sm font-semibold text-slate-200">Assistant is sleeping</p>
                <p className="mt-1 text-xs text-slate-400 max-w-xs">
                  Wake the assistant using the banner above to load your active calls and data.
                </p>
              </div>
            </div>
          ) : activeView === "overview" ? (
            /* ══════════════════════════════════════════════
               1. OVERVIEW AREA
               ══════════════════════════════════════════════ */
            <OverviewView
              calls={callsHistory}
              followups={followups}
              prospects={prospects}
              activeCall={activeCall}
              onNavigate={setActiveView}
              onSelectCall={handleInspectHistoryCall}
              onSelectProspect={(id) => {
                setSelectedProspectId(id);
                setActiveView("prospects");
              }}
              onCompleteFollowup={handleCompleteFollowup}
              onRescheduleFollowup={(item) => {
                handleRescheduleFollowup(item.id, "Rescheduled");
              }}
              onStartCallWithProspect={handleStartCallWithProspect}
              onStartNewCall={handleStartNewCall}
            />
          ) : activeView === "prospects" ? (
            /* ══════════════════════════════════════════════
               2. PROSPECTS WORKSPACE AREA
               ══════════════════════════════════════════════ */
            <ProspectWorkspace
              prospects={prospects}
              calls={callsHistory}
              followups={followups}
              selectedProspectId={selectedProspectId}
              onSelectProspect={setSelectedProspectId}
              onStartCallWithProspect={handleStartCallWithProspect}
              onInspectCall={handleInspectHistoryCall}
              onCompleteFollowup={handleCompleteFollowup}
              onRescheduleFollowup={(item) => {
                handleRescheduleFollowup(item.id, "Rescheduled");
              }}
              onCreateProspect={handleCreateProspect}
              onDeleteProspect={handleDeleteProspect}
            />
          ) : activeView === "followups" ? (
            /* ══════════════════════════════════════════════
               3. FOLLOW-UPS MANAGEMENT AREA
               ══════════════════════════════════════════════ */
            <FollowupsView
              followups={followups}
              prospects={prospects}
              onCompleteFollowup={handleCompleteFollowup}
              onRescheduleFollowup={handleRescheduleFollowup}
              onSelectProspect={(id) => {
                setSelectedProspectId(id);
                setActiveView("prospects");
              }}
              onInspectCall={handleInspectHistoryCall}
              onStartCallWithProspect={handleStartCallWithProspect}
              onDeleteFollowup={handleDeleteFollowup}
            />
          ) : activeView === "history" ? (
            /* ══════════════════════════════════════════════
               4. CALL HISTORY AREA
               ══════════════════════════════════════════════ */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#233554] pb-4">
                <div>
                  <h1 className="text-xl font-bold text-white tracking-tight">Call History</h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Searchable historical cold-call records with outcome, stage, and next action filters.
                  </p>
                </div>
                {activeCall && (
                  <button
                    onClick={() => setActiveView("active")}
                    className="rounded-lg bg-[#0062ff] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0052d9] transition-all self-start sm:self-auto"
                  >
                    Return to Live Call →
                  </button>
                )}
              </div>

              <PastCallsList
                calls={callsHistory}
                onSelectCall={handleInspectHistoryCall}
                onDeleteCall={handleDeleteCall}
              />
            </div>
          ) : (
            /* ══════════════════════════════════════════════
               5. ACTIVE CALL WORKFLOW
               ══════════════════════════════════════════════ */
            <div>
              {!activeCall ? (
                <div className="py-6 sm:py-10">
                  <StartCallPanel
                    onStartCall={handleStartCall}
                    isLoading={isStartingCall}
                    initialProspect={initialCallProspect}
                    initialBriefing={preCallBriefing}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Active Call Prospect Details Bar */}
                  <div className="rounded-lg border border-[#233554] bg-[#0b132b] p-4 sm:px-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center space-x-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#101c3d] text-[#0062ff] font-bold text-xs border border-[#233554]">
                          🏢
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h1 className="text-base font-bold text-white">
                              {activeCall.company_name}
                            </h1>
                            <span className="rounded bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.2 text-[10px] font-semibold text-emerald-400 uppercase">
                              Active Call
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-400 mt-0.5">
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

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            setInitialModalOutcome(undefined);
                            setIsEndingCallModalOpen(true);
                          }}
                          className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3.5 py-1.5 text-xs font-semibold text-rose-300 hover:border-rose-400 hover:bg-rose-900/60 hover:text-white transition-colors"
                        >
                          End Call Session
                        </button>
                      </div>
                    </div>

                    {/* Compact Previous Conversation Briefing Bar (when active call was linked to prospect) */}
                    {preCallBriefing && (
                      <div className="mt-3 pt-3 border-t border-[#233554]/70 flex items-start space-x-2 text-xs text-[#60a5fa]">
                        <span className="font-bold text-[10px] uppercase tracking-wider shrink-0 mt-0.5">
                          ✦ Previous Briefing:
                        </span>
                        <span className="text-slate-200 leading-relaxed">
                          {preCallBriefing}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsLiveAssistVisible((visible) => !visible)}
                      aria-expanded={isLiveAssistVisible}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${isLiveAssistVisible ? "border-blue-500/40 bg-blue-950/30 text-blue-200 hover:bg-blue-900/40" : "border-[#233554] bg-[#0b132b] text-slate-300 hover:border-blue-500/40 hover:text-white"}`}
                    >
                      {isLiveAssistVisible ? "Hide Live Assist" : liveTranscription.state === "idle" && liveTranscription.finalTranscript ? "Review Live Assist" : "Enable Live Transcription"}
                      {liveTranscription.state === "recording" && <span className="ml-2 text-rose-300">● LIVE</span>}
                    </button>
                  </div>

                  <div className={`grid items-start gap-4 transition-[grid-template-columns] duration-300 ease-in-out ${isLiveAssistVisible ? "grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]" : "grid-cols-1"}`}>
                  <div className="min-w-0 space-y-4">
                  {/* Eight-Stage Stepper Progress */}
                  <StageProgress
                    stages={stages}
                    currentStageNumber={currentStageNumber}
                    highestStageReached={activeCall.highest_stage}
                    stageResults={activeCall.stage_results}
                    onSelectStage={handleSelectStage}
                    stagesWithNotes={new Set(
                      [
                        ...[...stageNotesAnalysis.stageNotesState.notes.entries()]
                          .filter(([, notes]) => notes.some((note) => !note.manually_edited))
                          .map(([k]) => k),
                        ...(activeCall.stage_results || [])
                          .filter((result) => Boolean(result.notes?.trim()))
                          .map((result) => result.stage_number),
                      ]
                    )}
                    stagesNeedingReview={stageNotesAnalysis.stageNotesState.needsReview}
                    stagesAnalyzing={
                      stageNotesAnalysis.stageNotesState.analyzing.has(-1)
                        ? new Set(stages.map((s) => s.stage_number))
                        : new Set<number>()
                    }
                    stagesWithRecommendations={new Set(
                      [...stageAssistRecommendations.entries()]
                        .filter(([stageNumber, recommendation]) => recommendation.suggested_outcome && !(activeCall.stage_results || []).some((result) => result.stage_number === stageNumber && result.selected_outcome))
                        .map(([stageNumber]) => stageNumber)
                    )}
                  />

                  {/* Current Stage Panel */}
                  <div className="mx-auto max-w-4xl pt-2">
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
                        stageAssistRecommendation={stageAssistRecommendations.get(currentStageNumber) || null}
                        onConfirmOutcomeSuggestion={(outcome) => {
                          handleSelectOutcome(outcome);
                          const evidence = stageAssistRecommendations.get(currentStageNumber)?.evidence_quote;
                          if (evidence) appendStageNotesRef.current?.(`Outcome confirmed from transcript evidence: “${evidence}”`);
                        }}
                        onDismissOutcomeSuggestion={() => setStageAssistRecommendations((previous) => {
                          const next = new Map(previous);
                          const current = next.get(currentStageNumber);
                          if (current) next.set(currentStageNumber, { ...current, suggested_outcome: null, outcome_reason: null, evidence_quote: null });
                          return next;
                        })}
                        onShowTranscriptEvidence={(quote) => {
                          setTranscriptHighlight(quote);
                          setIsLiveAssistVisible(true);
                        }}
                        isSaving={false}
                        isLastStage={currentStageNumber === stages.length}
                        onRegisterFlush={(fn) => {
                          stagePanelFlushRef.current = fn;
                        }}
                        onRegisterCopyExactWords={(fn) => {
                          copyToExactWordsRef.current = fn;
                        }}
                        onRegisterAppendNotes={(fn) => {
                          appendStageNotesRef.current = fn;
                        }}
                      />
                    )}
                  </div>

                  </div>

                  {/* Live Audio Transcription Panel */}
                  <aside aria-hidden={!isLiveAssistVisible} className={`min-w-0 lg:sticky lg:top-4 transition-opacity duration-200 ${isLiveAssistVisible ? "opacity-100" : "hidden"}`}>
                    <div className="mx-auto max-w-4xl">
                    <StageAINotesPanel
                      notes={stageNotesAnalysis.getStageNotes(currentStageNumber)}
                      isAnalyzing={stageNotesAnalysis.stageIsAnalyzing(currentStageNumber)}
                      onDismiss={(idx) => stageNotesAnalysis.dismissNote(currentStageNumber, idx)}
                      onAcceptToStageNotes={(idx, note) => {
                        appendStageNotesRef.current?.(note);
                        stageNotesAnalysis.markNoteReviewed(currentStageNumber, idx);
                      }}
                    />
                  </div>
                  <div className="mx-auto max-w-4xl pt-2">
                    <TranscriptPanel
                      callId={activeCall.id}
                      recordingState={liveTranscription.state}
                      elapsedSeconds={liveTranscription.elapsedSeconds}
                      finalSegments={liveTranscription.finalSegments}
                      interimText={liveTranscription.interimText}
                      finalTranscript={liveTranscription.finalTranscript}
                      transcriptionError={liveTranscription.error}
                      consentAcknowledged={liveTranscription.consentAcknowledged}
                      onStartRecording={() =>
                        liveTranscription.startRecording(activeCall.id)
                      }
                      onStopRecording={() => liveTranscription.stopRecording()}
                      onAcknowledgeConsent={() =>
                        liveTranscription.acknowledgeConsent()
                      }
                      onTranscriptSelection={(text: string) => {
                        if (copyToExactWordsRef.current) {
                          copyToExactWordsRef.current(text);
                        }
                      }}
                      highlightText={transcriptHighlight}
                    />
                  </div>
                  </aside>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Call Detail Inspection Modal / Drawer ── */}
      {selectedHistoryCall && (
        <CallDetailModal
          call={selectedHistoryCall}
          stages={stages}
          onClose={() => setSelectedHistoryCall(null)}
          onResumeCall={(call) => {
            setActiveCall(call);
            setCurrentStageNumber(call.current_stage || 1);
            setSelectedHistoryCall(null);
            setActiveView("active");
          }}
          isAutoAnalyzing={isAutoAnalyzing}
          onRetryAnalysis={handleRetryAnalysis}
          autoAnalysisError={autoAnalysisError}
          onDeleteCall={handleDeleteCall}
        />
      )}

      {/* ── End Call Confirmation Modal ── */}
      {isEndingCallModalOpen && activeCall && (
        <EndCallModal
          isOpen={isEndingCallModalOpen}
          call={activeCall}
          currentStageNumber={currentStageNumber}
          currentStageName={currentStageDef?.name || `Stage ${currentStageNumber}`}
          initialOutcome={initialModalOutcome}
          onClose={() => setIsEndingCallModalOpen(false)}
          onConfirmEnd={handleConfirmEndCall}
          isSubmitting={isSubmittingClose}
        />
      )}
    </div>
  );
}
