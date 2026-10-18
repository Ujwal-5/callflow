"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ConversationGap,
  ConversationGapType,
  ConversationGapStatus,
  Commitment,
  MissedOpportunity,
  CommitmentRecordStatus,
} from "@/types";
import { api } from "@/lib/api";

interface ConversationReviewProps {
  callId: string;
  isReadOnly?: boolean;
  onFollowupCreated?: (gap: ConversationGap) => void;
  onCommitmentsChange?: (commitments: Commitment[]) => void;
  className?: string;
  /** If true, shows an "Analyzing call…" banner and disables manual triggers */
  isAutoAnalyzing?: boolean;
  /** Called when auto-analysis should be triggered (used by parent to kick off analysis) */
  onRequestAnalysis?: () => void;
}

export const ConversationReview: React.FC<ConversationReviewProps> = ({
  callId,
  isReadOnly = false,
  onFollowupCreated,
  onCommitmentsChange,
  className = "",
  isAutoAnalyzing = false,
  onRequestAnalysis,
}) => {
  // ── Gap findings state ──
  const [findings, setFindings] = useState<ConversationGap[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [isLoadingGaps, setIsLoadingGaps] = useState<boolean>(true);
  const [isAnalyzingGaps, setIsAnalyzingGaps] = useState<boolean>(false);
  const [gapError, setGapError] = useState<string | null>(null);
  const [showAllFindings, setShowAllFindings] = useState<boolean>(false);
  const [expandedContextId, setExpandedContextId] = useState<string | null>(null);
  const [showResolvedDismissed, setShowResolvedDismissed] = useState<boolean>(false);
  const [isCreatingFollowup, setIsCreatingFollowup] = useState<string | null>(null);

  // ── Commitment / Radar state ──
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [missedOpps, setMissedOpps] = useState<MissedOpportunity[]>([]);
  const [radarSummary, setRadarSummary] = useState<string>("");
  const [isLoadingRadar, setIsLoadingRadar] = useState<boolean>(true);
  const [isAnalyzingRadar, setIsAnalyzingRadar] = useState<boolean>(false);
  const [radarError, setRadarError] = useState<string | null>(null);

  // ── Commitment inline edit state ──
  const [editingCommitmentId, setEditingCommitmentId] = useState<string | null>(null);
  const [editAction, setEditAction] = useState<string>("");
  const [editTiming, setEditTiming] = useState<string>("");
  const [editChannel, setEditChannel] = useState<string>("unknown");

  // ── Active tab ──
  type Tab = "commitments" | "gaps";
  const [activeTab, setActiveTab] = useState<Tab>("commitments");

  // ─────────────────────────────────────────────────────────
  // Data loading
  // ─────────────────────────────────────────────────────────
  const loadGaps = useCallback(async () => {
    if (!callId) return;
    try {
      setIsLoadingGaps(true);
      setGapError(null);
      const res = await api.getConversationGaps(callId);
      setFindings(res.findings || []);
      setSummary(res.summary || "");
    } catch (err: unknown) {
      console.warn("Could not load conversation gaps:", err);
    } finally {
      setIsLoadingGaps(false);
    }
  }, [callId]);

  const loadRadar = useCallback(async () => {
    if (!callId) return;
    try {
      setIsLoadingRadar(true);
      setRadarError(null);
      const res = await api.getRadar(callId);
      setCommitments(res.commitments || []);
      setMissedOpps(res.missed_opportunities || []);
      setRadarSummary(res.analysis_summary || "");
      if (onCommitmentsChange) onCommitmentsChange(res.commitments || []);
    } catch (err: unknown) {
      console.warn("Could not load radar data:", err);
    } finally {
      setIsLoadingRadar(false);
    }
  }, [callId, onCommitmentsChange]);

  useEffect(() => {
    loadGaps();
    loadRadar();
  }, [loadGaps, loadRadar]);

  // ─────────────────────────────────────────────────────────
  // Manual analyze triggers
  // ─────────────────────────────────────────────────────────
  const handleAnalyzeAll = async () => {
    setIsAnalyzingGaps(true);
    setIsAnalyzingRadar(true);
    setGapError(null);
    setRadarError(null);

    try {
      const [gapRes, radarRes] = await Promise.allSettled([
        api.analyzeConversationGaps(callId),
        api.analyzeRadar(callId),
      ]);

      if (gapRes.status === "fulfilled") {
        setFindings(gapRes.value.findings || []);
        setSummary(gapRes.value.summary || "");
      } else {
        setGapError(gapRes.reason instanceof Error ? gapRes.reason.message : "Gap analysis failed.");
      }

      if (radarRes.status === "fulfilled") {
        setCommitments(radarRes.value.commitments || []);
        setMissedOpps(radarRes.value.missed_opportunities || []);
        setRadarSummary(radarRes.value.analysis_summary || "");
        if (onCommitmentsChange) onCommitmentsChange(radarRes.value.commitments || []);
      } else {
        setRadarError(radarRes.reason instanceof Error ? radarRes.reason.message : "Commitment scan failed.");
      }
    } finally {
      setIsAnalyzingGaps(false);
      setIsAnalyzingRadar(false);
    }
  };

  const isAnalyzing = isAnalyzingGaps || isAnalyzingRadar || isAutoAnalyzing;

  // ─────────────────────────────────────────────────────────
  // Commitment actions
  // ─────────────────────────────────────────────────────────
  const handleUpdateCommitmentStatus = async (
    commitmentId: string,
    status: CommitmentRecordStatus
  ) => {
    try {
      const updated = await api.updateCommitment(callId, commitmentId, { status });
      const nextList = commitments.map((c) => (c.id === commitmentId ? updated : c));
      setCommitments(nextList);
      if (onCommitmentsChange) onCommitmentsChange(nextList);
    } catch (err) {
      console.error("Failed to update commitment status:", err);
    }
  };

  const handleSaveCommitmentEdit = async (commitmentId: string) => {
    try {
      const updated = await api.updateCommitment(callId, commitmentId, {
        action: editAction.trim(),
        relative_due: editTiming.trim() || null,
        channel: editChannel,
      });
      const nextList = commitments.map((c) => (c.id === commitmentId ? updated : c));
      setCommitments(nextList);
      setEditingCommitmentId(null);
      if (onCommitmentsChange) onCommitmentsChange(nextList);
    } catch (err) {
      console.error("Failed to save commitment edit:", err);
    }
  };

  const handleUpdateMissedOppStatus = async (
    oppId: string,
    status: "pending" | "confirmed" | "dismissed"
  ) => {
    try {
      const updated = await api.updateMissedOpportunity(callId, oppId, { status });
      setMissedOpps((prev) => prev.map((o) => (o.id === oppId ? updated : o)));
    } catch (err) {
      console.error("Failed to update missed opportunity status:", err);
    }
  };

  // ─────────────────────────────────────────────────────────
  // Gap actions
  // ─────────────────────────────────────────────────────────
  const handleUpdateGapStatus = async (gapId: string, status: ConversationGapStatus) => {
    try {
      const updated = await api.updateConversationGap(callId, gapId, { status });
      setFindings((prev) => prev.map((g) => (g.id === gapId ? updated : g)));
    } catch (err) {
      console.error("Failed to update gap status:", err);
    }
  };

  const handleCreateFollowup = async (gapId: string) => {
    setIsCreatingFollowup(gapId);
    try {
      const updated = await api.createGapFollowup(callId, gapId);
      setFindings((prev) => prev.map((g) => (g.id === gapId ? updated : g)));
      if (onFollowupCreated) onFollowupCreated(updated);
    } catch (err) {
      console.error("Failed to create follow-up from gap:", err);
    } finally {
      setIsCreatingFollowup(null);
    }
  };

  // ─────────────────────────────────────────────────────────
  // Badge helpers
  // ─────────────────────────────────────────────────────────
  const getGapCategoryBadge = (type: ConversationGapType) => {
    switch (type) {
      case "missed_discovery":
        return { label: "Missed Discovery", style: "bg-amber-950/80 text-amber-300 border-amber-500/40", icon: "🔍" };
      case "unresolved_question":
        return { label: "Unresolved Question", style: "bg-cyan-950/80 text-cyan-300 border-cyan-500/40", icon: "❓" };
      case "unconfirmed_agreement":
        return { label: "Unconfirmed Agreement", style: "bg-purple-950/80 text-purple-300 border-purple-500/40", icon: "🤝" };
      case "unaddressed_objection":
        return { label: "Unaddressed Objection", style: "bg-rose-950/80 text-rose-300 border-rose-500/40", icon: "🛡️" };
      case "unexplored_referral":
        return { label: "Unexplored Referral", style: "bg-indigo-950/80 text-indigo-300 border-indigo-500/40", icon: "👥" };
      default:
        return { label: "Conversation Gap", style: "bg-slate-800 text-slate-300 border-slate-700", icon: "💬" };
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev.toLowerCase()) {
      case "high": return "bg-rose-950/60 text-rose-400 border-rose-500/30";
      case "medium": return "bg-amber-950/60 text-amber-400 border-amber-500/30";
      default: return "bg-slate-800 text-slate-300 border-slate-700";
    }
  };

  const getCommitmentStatusBadge = (status: CommitmentRecordStatus) => {
    switch (status) {
      case "confirmed": return "bg-emerald-950/80 text-emerald-400 border-emerald-500/40";
      case "completed": return "bg-blue-950/80 text-blue-400 border-blue-500/40";
      case "dismissed": return "bg-slate-800 text-slate-400 border-slate-700";
      default: return "bg-amber-950/80 text-amber-300 border-amber-500/40";
    }
  };

  const getCommitmentTypeBadge = (status: string) => {
    switch (status) {
      case "explicitly_agreed": return "bg-purple-950/80 text-purple-300 border-purple-500/30";
      case "promised": return "bg-cyan-950/80 text-cyan-300 border-cyan-500/30";
      case "requested": return "bg-indigo-950/80 text-indigo-300 border-indigo-500/30";
      default: return "bg-slate-800 text-slate-300 border-slate-700";
    }
  };

  const formatOppType = (type: string) => {
    switch (type) {
      case "need_not_explored": return "Unexplored Need";
      case "objection_unresolved": return "Unresolved Objection";
      case "question_unanswered": return "Unanswered Question";
      case "referral_untracked": return "Untracked Referral";
      case "meeting_unconfirmed": return "Unconfirmed Meeting";
      case "no_next_step": return "No Next Step";
      default: return "Observation";
    }
  };

  // ─────────────────────────────────────────────────────────
  // Derived data
  // ─────────────────────────────────────────────────────────
  const severityWeight = (s: string) => (s === "high" ? 3 : s === "medium" ? 2 : 1);

  const openFindings = findings
    .filter((f) => f.status === "open")
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));

  const resolvedOrDismissed = findings.filter((f) => f.status !== "open");
  const displayedOpenFindings = showAllFindings ? openFindings : openFindings.slice(0, 2);

  const visibleCommitments = commitments.filter((c) => c.status !== "dismissed");
  const visibleMissedOpps = missedOpps.filter((o) => o.status !== "dismissed").slice(0, 2);

  const hasAnyData =
    openFindings.length > 0 ||
    commitments.length > 0 ||
    missedOpps.length > 0;

  const isLoading = isLoadingGaps || isLoadingRadar;

  // Count for tab badges
  const commitmentCount = visibleCommitments.length + visibleMissedOpps.length;
  const gapCount = openFindings.length;

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div
      className={`rounded-lg border border-[#233554] bg-[#0b132b] p-4 sm:p-5 shadow-lg ${className}`}
    >
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#233554] pb-3.5">
        <div className="flex items-center space-x-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0062ff]/20 text-[#0062ff] border border-[#0062ff]/40 text-sm">
            🔭
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Conversation Review
              </h2>
              <span className="rounded bg-indigo-950/80 border border-indigo-500/40 px-1.5 py-0.5 text-[10px] font-mono font-medium text-indigo-300">
                Gap & Commitment Detector
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Commitments, callbacks, referrals, gaps, and missed opportunities — evidence-backed.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Auto-analysis indicator */}
          {isAutoAnalyzing && (
            <span className="flex items-center space-x-1.5 rounded border border-[#0062ff]/40 bg-[#0062ff]/10 px-2.5 py-1 text-[11px] font-semibold text-[#60a5fa]">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>Analyzing call…</span>
            </span>
          )}

          {/* Manual trigger */}
          {!isReadOnly && !isAutoAnalyzing && (
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={handleAnalyzeAll}
              className="flex items-center space-x-1.5 rounded bg-[#0062ff] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0052d9] transition-all disabled:opacity-60 shadow"
            >
              {isAnalyzing ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>Analyzing…</span>
                </>
              ) : (
                <>
                  <span>✦</span>
                  <span>{hasAnyData ? "Re-scan" : "Scan for Findings"}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Auto-analysis in-progress banner ── */}
      {isAutoAnalyzing && (
        <div className="mt-3 rounded border border-[#0062ff]/30 bg-[#0062ff]/10 px-3 py-2.5 text-xs text-slate-300">
          <span className="font-semibold text-white">Analyzing your call…</span> Gemini is reviewing the transcript and notes for commitments, gaps, and next steps. Results will appear here automatically.
        </div>
      )}

      {/* ── Errors ── */}
      {(gapError || radarError) && (
        <div className="mt-3 rounded border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-300 space-y-1">
          {gapError && <p><span className="font-semibold">Gap analysis:</span> {gapError}</p>}
          {radarError && <p><span className="font-semibold">Commitment scan:</span> {radarError}</p>}
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleAnalyzeAll}
              className="mt-1 rounded border border-rose-500/40 px-2.5 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-900/30 transition-colors"
            >
              ↺ Retry Analysis
            </button>
          )}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {isLoading && !hasAnyData && !isAutoAnalyzing && (
        <div className="py-6 text-center text-xs text-slate-400">
          Loading analysis data…
        </div>
      )}

      {/* ── Tab bar ── */}
      {!isLoading && (
        <div className="mt-4">
          <div className="flex space-x-1 border-b border-[#233554]">
            <button
              type="button"
              onClick={() => setActiveTab("commitments")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors ${
                activeTab === "commitments"
                  ? "border border-b-[#0b132b] border-[#233554] text-white bg-[#0b132b] -mb-px"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🎯 Commitments & Promises
              {commitmentCount > 0 && (
                <span className="ml-1.5 rounded-full bg-[#0062ff]/30 border border-[#0062ff]/40 px-1.5 py-0.5 text-[10px] font-mono text-[#60a5fa]">
                  {commitmentCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("gaps")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors ${
                activeTab === "gaps"
                  ? "border border-b-[#0b132b] border-[#233554] text-white bg-[#0b132b] -mb-px"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🔭 Conversation Gaps
              {gapCount > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-950/60 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">
                  {gapCount}
                </span>
              )}
            </button>
          </div>

          {/* ══════════════════════════════════════════════
              TAB: COMMITMENTS & PROMISES
              ══════════════════════════════════════════════ */}
          {activeTab === "commitments" && (
            <div className="mt-4 space-y-5">
              {/* Overall radar summary */}
              {radarSummary && (
                <div className="rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-xs text-slate-300">
                  <span className="font-semibold text-white">Scan Summary:</span> {radarSummary}
                </div>
              )}

              {/* ── Commitments ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Extracted Commitments ({visibleCommitments.length})
                  </span>
                  {commitments.some((c) => c.status === "dismissed") && (
                    <span className="text-[10px] text-slate-500">
                      {commitments.filter((c) => c.status === "dismissed").length} dismissed hidden
                    </span>
                  )}
                </div>

                {isAutoAnalyzing ? (
                  <div className="rounded border border-dashed border-[#233554] bg-[#070d1e]/50 p-4 text-center text-xs text-slate-400">
                    Scanning for commitments…
                  </div>
                ) : visibleCommitments.length === 0 ? (
                  <div className="rounded border border-dashed border-[#233554] bg-[#070d1e]/50 p-4 text-center">
                    <p className="text-xs text-slate-400">No concrete commitments detected.</p>
                    {!isReadOnly && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Run a scan after adding a transcript or notes.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {visibleCommitments.map((comm) => {
                      const isEditing = editingCommitmentId === comm.id;
                      return (
                        <div
                          key={comm.id}
                          className="rounded border border-[#233554] bg-[#070d1e] p-3 text-xs transition-all hover:border-slate-600"
                        >
                          {isEditing ? (
                            /* Inline Edit Form */
                            <div className="space-y-2">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-slate-400">
                                  Action Description
                                </label>
                                <input
                                  type="text"
                                  value={editAction}
                                  onChange={(e) => setEditAction(e.target.value)}
                                  className="mt-0.5 w-full rounded border border-[#233554] bg-[#0b132b] px-2.5 py-1 text-xs text-white focus:border-[#0062ff] focus:outline-none"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-slate-400">
                                    Timing Phrase
                                  </label>
                                  <input
                                    type="text"
                                    value={editTiming}
                                    onChange={(e) => setEditTiming(e.target.value)}
                                    placeholder="e.g. after 30 minutes"
                                    className="mt-0.5 w-full rounded border border-[#233554] bg-[#0b132b] px-2.5 py-1 text-xs text-white focus:border-[#0062ff] focus:outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-slate-400">
                                    Channel
                                  </label>
                                  <select
                                    value={editChannel}
                                    onChange={(e) => setEditChannel(e.target.value)}
                                    className="mt-0.5 w-full rounded border border-[#233554] bg-[#0b132b] px-2 py-1 text-xs text-white focus:border-[#0062ff] focus:outline-none"
                                  >
                                    <option value="phone">phone</option>
                                    <option value="WhatsApp">WhatsApp</option>
                                    <option value="Google Meet">Google Meet</option>
                                    <option value="email">email</option>
                                    <option value="unknown">unknown</option>
                                  </select>
                                </div>
                              </div>
                              <div className="flex items-center justify-end space-x-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setEditingCommitmentId(null)}
                                  className="rounded border border-[#233554] px-2.5 py-1 text-[11px] text-slate-400 hover:text-white"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveCommitmentEdit(comm.id)}
                                  className="rounded bg-[#0062ff] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0052d9]"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* Read / Action View */
                            <div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getCommitmentStatusBadge(comm.status)}`}>
                                    {comm.status}
                                  </span>
                                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${getCommitmentTypeBadge(comm.commitment_status)}`}>
                                    {comm.commitment_status.replace("_", " ")}
                                  </span>
                                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                                    by {comm.responsible_party}
                                  </span>
                                  {comm.channel !== "unknown" && (
                                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                                      via {comm.channel}
                                    </span>
                                  )}
                                </div>

                                {!isReadOnly && (
                                  <div className="flex items-center space-x-1.5 text-[11px]">
                                    {comm.status === "pending" && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateCommitmentStatus(comm.id, "confirmed")}
                                        className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/60 transition-colors"
                                      >
                                        ✓ Confirm
                                      </button>
                                    )}
                                    {comm.status === "confirmed" && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateCommitmentStatus(comm.id, "completed")}
                                        className="rounded border border-blue-500/40 bg-blue-950/40 px-2 py-0.5 font-semibold text-blue-300 hover:bg-blue-900/60 transition-colors"
                                      >
                                        ✓ Complete
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCommitmentId(comm.id);
                                        setEditAction(comm.action);
                                        setEditTiming(comm.relative_due || "");
                                        setEditChannel(comm.channel || "unknown");
                                      }}
                                      className="rounded border border-[#233554] px-1.5 py-0.5 text-slate-400 hover:text-white transition-colors"
                                      title="Edit Commitment"
                                    >
                                      ✏ Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateCommitmentStatus(comm.id, "dismissed")}
                                      className="rounded border border-[#233554] px-1.5 py-0.5 text-slate-400 hover:text-rose-400 transition-colors"
                                      title="Dismiss"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="mt-1.5">
                                <span className="font-semibold text-white">{comm.action}</span>
                                {comm.relative_due && (
                                  <span className="ml-2 font-mono text-[11px] text-[#3b82f6]">
                                    ⏰ {comm.relative_due}
                                  </span>
                                )}
                              </div>

                              {/* Exact Transcript Evidence */}
                              <div className="mt-1.5 rounded border border-[#233554]/60 bg-[#101c3d]/40 p-2 text-[11px]">
                                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                                  Transcript Evidence:
                                </span>
                                <span className="text-slate-300 italic">&ldquo;{comm.evidence_quote}&rdquo;</span>
                              </div>

                              {/* Why it matters + next action */}
                              {comm.needs_confirmation && comm.status === "pending" && (
                                <div className="mt-1 flex items-center space-x-1 text-[10px] text-amber-400">
                                  <span>⚠</span>
                                  <span>Needs review: verify exact timing or responsibility.</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Missed Opportunities ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Missed Opportunities ({visibleMissedOpps.length})
                  </span>
                  <span className="text-[10px] text-slate-500">Top 2 highlighted</span>
                </div>

                {isAutoAnalyzing ? (
                  <div className="rounded border border-dashed border-[#233554] bg-[#070d1e]/50 p-3 text-center text-xs text-slate-400">
                    Scanning for missed opportunities…
                  </div>
                ) : visibleMissedOpps.length === 0 ? (
                  <div className="rounded border border-dashed border-[#233554] bg-[#070d1e]/50 p-3 text-center text-xs text-slate-400">
                    No acute missed opportunities identified.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {visibleMissedOpps.map((opp) => (
                      <div
                        key={opp.id}
                        className="rounded border border-amber-500/30 bg-[#070d1e] p-3 text-xs space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center space-x-1.5">
                            <span className="rounded bg-amber-950/80 border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                              {formatOppType(opp.type)}
                            </span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 uppercase">
                              {opp.severity} severity
                            </span>
                          </div>
                          {!isReadOnly && (
                            <div className="flex items-center space-x-1.5 text-[11px]">
                              {opp.status === "pending" && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateMissedOppStatus(opp.id, "confirmed")}
                                  className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/60 transition-colors"
                                >
                                  ✓ Acknowledge
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleUpdateMissedOppStatus(opp.id, "dismissed")}
                                className="rounded border border-[#233554] px-1.5 py-0.5 text-slate-400 hover:text-rose-400 transition-colors"
                              >
                                ✕ Dismiss
                              </button>
                            </div>
                          )}
                        </div>

                        <p className="text-slate-200 leading-snug">{opp.description}</p>

                        {/* Transcript Evidence */}
                        <div className="rounded border border-[#233554]/60 bg-[#101c3d]/40 p-2 text-[11px]">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                            Transcript Evidence:
                          </span>
                          <span className="text-slate-300 italic">&ldquo;{opp.evidence_quote}&rdquo;</span>
                        </div>

                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 pt-1 border-t border-[#233554]/60 text-[11px]">
                          <div>
                            <span className="font-semibold text-slate-400">Why it matters: </span>
                            <span className="text-slate-300">{opp.why_it_matters}</span>
                          </div>
                          <div className="rounded bg-[#0062ff]/10 border border-[#0062ff]/30 p-2">
                            <span className="font-semibold text-[#60a5fa] block text-[10px] uppercase">
                              Suggested Next Action:
                            </span>
                            <span className="text-white font-medium leading-snug">{opp.suggested_action}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              TAB: CONVERSATION GAPS
              ══════════════════════════════════════════════ */}
          {activeTab === "gaps" && (
            <div className="mt-4 space-y-4">
              {summary && (
                <div className="rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-xs text-slate-300">
                  <span className="font-semibold text-white">Review Summary:</span> {summary}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Potential Gaps ({openFindings.length})
                  </span>
                  {openFindings.length > 2 && (
                    <span className="text-[10px] text-slate-400">
                      Showing {displayedOpenFindings.length} of {openFindings.length}
                    </span>
                  )}
                </div>

                {isAutoAnalyzing ? (
                  <div className="rounded border border-dashed border-[#233554] bg-[#070d1e]/50 p-4 text-center text-xs text-slate-400">
                    Scanning conversation for gaps…
                  </div>
                ) : openFindings.length === 0 ? (
                  <div className="rounded border border-dashed border-[#233554] bg-[#070d1e]/50 p-4 text-center">
                    <p className="text-xs font-medium text-slate-300">
                      No significant conversation gaps detected.
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      The dialogue showed no unresolved questions, unconfirmed agreements, or dropped discovery topics.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {displayedOpenFindings.map((gap) => {
                      const cat = getGapCategoryBadge(gap.type);
                      const isContextExpanded = expandedContextId === gap.id;

                      return (
                        <div
                          key={gap.id}
                          className="rounded-lg border border-[#233554] bg-[#070d1e] p-3.5 text-xs space-y-2 transition-all hover:border-slate-600"
                        >
                          {/* Top Bar: Badges + Action Buttons */}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase flex items-center space-x-1 ${cat.style}`}>
                                <span>{cat.icon}</span>
                                <span>{cat.label}</span>
                              </span>
                              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getSeverityBadge(gap.severity)}`}>
                                {gap.severity}
                              </span>
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                                {gap.confidence >= 0.8
                                  ? `${Math.round(gap.confidence * 100)}% confidence`
                                  : `Review recommended (${Math.round(gap.confidence * 100)}%)`}
                              </span>
                            </div>

                            {/* Actions: Resolve / Follow-up / Dismiss */}
                            {!isReadOnly && (
                              <div className="flex items-center space-x-1.5 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateGapStatus(gap.id, "resolved")}
                                  className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/60 transition-colors"
                                  title="Mark as resolved"
                                >
                                  ✓ Resolved
                                </button>
                                <button
                                  type="button"
                                  disabled={isCreatingFollowup === gap.id}
                                  onClick={() => handleCreateFollowup(gap.id)}
                                  className="rounded bg-[#0062ff] px-2.5 py-0.5 font-semibold text-white hover:bg-[#0052d9] transition-colors disabled:opacity-60"
                                  title="Create follow-up"
                                >
                                  {isCreatingFollowup === gap.id ? "Creating…" : "＋ Follow-up"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateGapStatus(gap.id, "dismissed")}
                                  className="rounded border border-[#233554] px-1.5 py-0.5 text-slate-400 hover:text-rose-400 transition-colors"
                                  title="Dismiss gap"
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Finding Title & Description */}
                          <div>
                            <h4 className="font-bold text-white text-xs">{gap.title}</h4>
                            <p className="mt-0.5 text-slate-300 leading-relaxed">{gap.description}</p>
                          </div>

                          {/* Exact Supporting Quote */}
                          <div className="rounded border border-[#233554]/70 bg-[#101c3d]/40 p-2.5 text-[11px] text-slate-200">
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                              Exact Transcript Evidence:
                            </span>
                            <blockquote className="italic text-slate-200">
                              &ldquo;{gap.evidence_quote}&rdquo;
                            </blockquote>
                          </div>

                          {/* Optional Context Quote Accordion */}
                          {gap.context_quote && (
                            <div>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedContextId(isContextExpanded ? null : gap.id)
                                }
                                className="text-[10px] text-slate-400 hover:text-white flex items-center space-x-1"
                              >
                                <span>{isContextExpanded ? "▼ Hide dialogue context" : "▶ View surrounding dialogue"}</span>
                              </button>
                              {isContextExpanded && (
                                <div className="mt-1.5 rounded border border-[#233554] bg-[#070d1e] p-2 text-[11px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">
                                  {gap.context_quote}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Consequence & Suggested Move Box */}
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-2 border-t border-[#233554]/60 text-[11px]">
                            <div>
                              <span className="font-semibold text-slate-400 block">Why it matters:</span>
                              <span className="text-slate-300 leading-snug">{gap.why_it_matters}</span>
                            </div>
                            <div className="rounded bg-[#0062ff]/10 border border-[#0062ff]/30 p-2">
                              <span className="font-semibold text-[#60a5fa] block text-[10px] uppercase">
                                Suggested Next Action:
                              </span>
                              <span className="text-white font-medium leading-snug">{gap.suggested_action}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Toggle to view remaining findings */}
                {openFindings.length > 2 && (
                  <div className="mt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setShowAllFindings(!showAllFindings)}
                      className="rounded border border-[#233554] px-3 py-1 text-[11px] font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                    >
                      {showAllFindings
                        ? "Show fewer findings ↑"
                        : `Show ${openFindings.length - 2} more finding(s) ↓`}
                    </button>
                  </div>
                )}
              </div>

              {/* Resolved or Dismissed Findings Section */}
              {resolvedOrDismissed.length > 0 && (
                <div className="pt-2 border-t border-[#233554]/50">
                  <button
                    type="button"
                    onClick={() => setShowResolvedDismissed(!showResolvedDismissed)}
                    className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                  >
                    <span>{showResolvedDismissed ? "▼" : "▶"}</span>
                    <span>{resolvedOrDismissed.length} resolved / dismissed finding(s)</span>
                  </button>

                  {showResolvedDismissed && (
                    <div className="mt-2 space-y-2">
                      {resolvedOrDismissed.map((gap) => (
                        <div
                          key={gap.id}
                          className="rounded border border-[#233554] bg-[#070d1e]/50 p-2.5 text-xs opacity-75 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] uppercase font-bold ${
                                  gap.status === "resolved"
                                    ? "bg-emerald-950 text-emerald-400 border border-emerald-500/40"
                                    : "bg-slate-800 text-slate-400 border border-slate-700"
                                }`}
                              >
                                {gap.status}
                              </span>
                              <span className="font-semibold text-slate-300">{gap.title}</span>
                              {gap.commitment_id && (
                                <span className="rounded bg-blue-950/80 border border-blue-500/30 px-1.5 py-0.5 text-[10px] text-blue-300">
                                  Linked to Commitment
                                </span>
                              )}
                            </div>
                            {!isReadOnly && (
                              <button
                                type="button"
                                onClick={() => handleUpdateGapStatus(gap.id, "open")}
                                className="text-[10px] text-slate-400 hover:text-white"
                              >
                                Reopen
                              </button>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 italic">
                            &ldquo;{gap.evidence_quote}&rdquo;
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
