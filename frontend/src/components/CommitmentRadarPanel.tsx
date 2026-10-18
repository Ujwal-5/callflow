"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Commitment,
  MissedOpportunity,
  HistoricalMatch,
  CommitmentRecordStatus,
} from "@/types";
import { api } from "@/lib/api";

interface CommitmentRadarPanelProps {
  callId: string;
  isReadOnly?: boolean;
  onCommitmentsChange?: (commitments: Commitment[]) => void;
  className?: string;
}

export const CommitmentRadarPanel: React.FC<CommitmentRadarPanelProps> = ({
  callId,
  isReadOnly = false,
  onCommitmentsChange,
  className = "",
}) => {
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [missedOpportunities, setMissedOpportunities] = useState<MissedOpportunity[]>([]);
  const [historicalMatches, setHistoricalMatches] = useState<HistoricalMatch[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCommitmentId, setEditingCommitmentId] = useState<string | null>(null);
  const [editAction, setEditAction] = useState<string>("");
  const [editTiming, setEditTiming] = useState<string>("");
  const [editChannel, setEditChannel] = useState<string>("unknown");

  const loadRadarData = useCallback(async () => {
    if (!callId) return;
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.getRadar(callId);
      setCommitments(res.commitments || []);
      setMissedOpportunities(res.missed_opportunities || []);
      setHistoricalMatches(res.historical_matches || []);
      setAnalysisSummary(res.analysis_summary || "");
      if (onCommitmentsChange) {
        onCommitmentsChange(res.commitments || []);
      }
    } catch (err: unknown) {
      console.warn("Could not load radar data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [callId, onCommitmentsChange]);

  useEffect(() => {
    loadRadarData();
  }, [loadRadarData]);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await api.analyzeRadar(callId);
      setCommitments(res.commitments || []);
      setMissedOpportunities(res.missed_opportunities || []);
      setHistoricalMatches(res.historical_matches || []);
      setAnalysisSummary(res.analysis_summary || "");
      if (onCommitmentsChange) {
        onCommitmentsChange(res.commitments || []);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to run Commitment Radar analysis.");
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdateCommitmentStatus = async (
    commitmentId: string,
    status: CommitmentRecordStatus
  ) => {
    try {
      const updated = await api.updateCommitment(callId, commitmentId, { status });
      const nextList = commitments.map((c) => (c.id === commitmentId ? updated : c));
      setCommitments(nextList);
      if (onCommitmentsChange) {
        onCommitmentsChange(nextList);
      }
    } catch (err: unknown) {
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
      if (onCommitmentsChange) {
        onCommitmentsChange(nextList);
      }
    } catch (err: unknown) {
      console.error("Failed to save commitment edit:", err);
    }
  };

  const handleUpdateMissedOppStatus = async (
    oppId: string,
    status: "pending" | "confirmed" | "dismissed"
  ) => {
    try {
      const updated = await api.updateMissedOpportunity(callId, oppId, { status });
      setMissedOpportunities((prev) =>
        prev.map((o) => (o.id === oppId ? updated : o))
      );
    } catch (err: unknown) {
      console.error("Failed to update missed opportunity status:", err);
    }
  };

  const getStatusBadge = (status: CommitmentRecordStatus) => {
    switch (status) {
      case "confirmed":
        return "bg-emerald-950/80 text-emerald-400 border-emerald-500/40";
      case "completed":
        return "bg-blue-950/80 text-blue-400 border-blue-500/40";
      case "dismissed":
        return "bg-slate-800 text-slate-400 border-slate-700";
      default:
        return "bg-amber-950/80 text-amber-300 border-amber-500/40";
    }
  };

  const getCommitmentTypeBadge = (status: string) => {
    switch (status) {
      case "explicitly_agreed":
        return "bg-purple-950/80 text-purple-300 border-purple-500/30";
      case "promised":
        return "bg-cyan-950/80 text-cyan-300 border-cyan-500/30";
      case "requested":
        return "bg-indigo-950/80 text-indigo-300 border-indigo-500/30";
      default:
        return "bg-slate-800 text-slate-300 border-slate-700";
    }
  };

  const formatOppType = (type: string) => {
    switch (type) {
      case "need_not_explored":
        return "Unexplored Need";
      case "objection_unresolved":
        return "Unresolved Objection";
      case "question_unanswered":
        return "Unanswered Question";
      case "referral_untracked":
        return "Untracked Referral";
      case "meeting_unconfirmed":
        return "Unconfirmed Meeting";
      case "no_next_step":
        return "No Next Step";
      default:
        return "Observation";
    }
  };

  const visibleCommitments = commitments.filter((c) => c.status !== "dismissed");
  const visibleOpps = missedOpportunities.filter((o) => o.status !== "dismissed").slice(0, 2);

  return (
    <div
      className={`rounded-lg border border-[#233554] bg-[#0b132b] p-4 sm:p-5 shadow-lg ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#233554] pb-3.5">
        <div className="flex items-center space-x-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0062ff]/20 text-[#0062ff] border border-[#0062ff]/40 text-sm">
            🎯
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Commitment Radar
              </h2>
              <span className="rounded bg-indigo-950/80 border border-indigo-500/40 px-1.5 py-0.5 text-[10px] font-mono font-medium text-indigo-300">
                Ground Truth
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Evidence-backed next steps, unlogged callbacks & missed opportunities.
            </p>
          </div>
        </div>

        {!isReadOnly && (
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={handleAnalyze}
            className="flex items-center space-x-1.5 rounded bg-[#0062ff] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0052d9] transition-all disabled:opacity-60 shadow"
          >
            {isAnalyzing ? (
              <>
                <svg
                  className="h-3.5 w-3.5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                <span>Scanning Dialogue...</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>{commitments.length > 0 ? "Refresh Radar" : "Scan Dialogue"}</span>
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-300">
          <span className="font-semibold">Notice:</span> {error}
        </div>
      )}

      {analysisSummary && (
        <div className="mt-3 rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-xs text-slate-300">
          <span className="font-semibold text-white">Analysis Summary:</span> {analysisSummary}
        </div>
      )}

      {isLoading && commitments.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          Loading Commitment Radar...
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {/* 1. Commitments Section */}
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

            {visibleCommitments.length === 0 ? (
              <div className="rounded border border-dashed border-[#233554] bg-[#070d1e]/50 p-4 text-center">
                <p className="text-xs text-slate-400">
                  No concrete commitments detected yet.
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Record transcript audio or add notes, then click &ldquo;Scan Dialogue&rdquo;.
                </p>
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
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getStatusBadge(
                                  comm.status
                                )}`}
                              >
                                {comm.status}
                              </span>
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${getCommitmentTypeBadge(
                                  comm.commitment_status
                                )}`}
                              >
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

                            {/* Status Control Actions */}
                            {!isReadOnly && (
                              <div className="flex items-center space-x-1.5 text-[11px]">
                                {comm.status === "pending" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateCommitmentStatus(comm.id, "confirmed")
                                    }
                                    className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/60 transition-colors"
                                  >
                                    ✓ Confirm
                                  </button>
                                )}
                                {comm.status === "confirmed" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateCommitmentStatus(comm.id, "completed")
                                    }
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
                                  onClick={() =>
                                    handleUpdateCommitmentStatus(comm.id, "dismissed")
                                  }
                                  className="rounded border border-[#233554] px-1.5 py-0.5 text-slate-400 hover:text-rose-400 transition-colors"
                                  title="Dismiss Commitment"
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="mt-1.5">
                            <span className="font-semibold text-white">
                              {comm.action}
                            </span>
                            {comm.relative_due && (
                              <span className="ml-2 font-mono text-[11px] text-[#3b82f6]">
                                ⏰ {comm.relative_due}
                              </span>
                            )}
                          </div>

                          {/* Verbatim Supporting Quote */}
                          <div className="mt-1.5 rounded border border-[#233554]/60 bg-[#101c3d]/40 p-2 text-[11px] text-slate-300 italic">
                            &ldquo;{comm.evidence_quote}&rdquo;
                          </div>

                          {comm.needs_confirmation && comm.status === "pending" && (
                            <div className="mt-1 flex items-center space-x-1 text-[10px] text-amber-400">
                              <span>⚠</span>
                              <span>
                                Needs salesperson review: verify exact timing or responsibility.
                              </span>
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

          {/* 2. Missed Opportunities Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Potential Missed Opportunities ({visibleOpps.length})
              </span>
              <span className="text-[10px] text-slate-500">Max 2 highlighted</span>
            </div>

            {visibleOpps.length === 0 ? (
              <div className="rounded border border-dashed border-[#233554] bg-[#070d1e]/50 p-3 text-center text-xs text-slate-400">
                No acute missed opportunities identified.
              </div>
            ) : (
              <div className="space-y-2.5">
                {visibleOpps.map((opp) => (
                  <div
                    key={opp.id}
                    className="rounded border border-amber-500/30 bg-[#070d1e] p-3 text-xs space-y-1.5"
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
                              onClick={() =>
                                handleUpdateMissedOppStatus(opp.id, "confirmed")
                              }
                              className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/60 transition-colors"
                            >
                              ✓ Acknowledge
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateMissedOppStatus(opp.id, "dismissed")
                            }
                            className="rounded border border-[#233554] px-1.5 py-0.5 text-slate-400 hover:text-rose-400 transition-colors"
                          >
                            ✕ Dismiss
                          </button>
                        </div>
                      )}
                    </div>

                    <p className="text-slate-200 leading-snug">{opp.description}</p>

                    <div className="rounded border border-[#233554]/60 bg-[#101c3d]/40 p-2 text-[11px] text-slate-300 italic">
                      &ldquo;{opp.evidence_quote}&rdquo;
                    </div>

                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 pt-1 border-t border-[#233554]/60 text-[11px]">
                      <div>
                        <span className="font-semibold text-slate-400">Why it matters: </span>
                        <span className="text-slate-300">{opp.why_it_matters}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-[#0062ff]">Suggested Move: </span>
                        <span className="text-slate-200">{opp.suggested_action}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Historical Comparison Grounding */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Historical Cold-Call Precedents (100 Calls Dataset)
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Audited & Grounded
              </span>
            </div>

            {historicalMatches.length === 0 ? (
              <div className="rounded border border-[#233554] bg-[#070d1e] p-3 text-xs text-slate-400">
                No strong historical match found for this conversation scenario.
              </div>
            ) : (
              <div className="space-y-2">
                {historicalMatches.map((m, idx) => (
                  <div
                    key={`${m.transcript_id}-${idx}`}
                    className="rounded border border-[#233554] bg-[#101c3d]/40 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="rounded bg-[#0062ff]/20 border border-[#0062ff]/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#0062ff]">
                          {m.transcript_id}
                        </span>
                        {m.company && (
                          <span className="font-semibold text-white">
                            {m.company}
                          </span>
                        )}
                      </div>
                      <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                        Logged Outcome: <strong className="text-amber-300">{m.recorded_outcome}</strong>
                      </span>
                    </div>

                    <div className="rounded border border-[#233554] bg-[#070d1e] p-2 text-[11px] text-slate-300 italic">
                      &ldquo;{m.quote}&rdquo;
                    </div>

                    <p className="text-[11px] text-slate-400 leading-snug">
                      <strong className="text-slate-300">Relevance:</strong> {m.relevance}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
