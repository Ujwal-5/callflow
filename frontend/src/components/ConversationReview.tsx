"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ConversationGap, ConversationGapType, ConversationGapStatus } from "@/types";
import { api } from "@/lib/api";

interface ConversationReviewProps {
  callId: string;
  isReadOnly?: boolean;
  onFollowupCreated?: (gap: ConversationGap) => void;
  className?: string;
}

export const ConversationReview: React.FC<ConversationReviewProps> = ({
  callId,
  isReadOnly = false,
  onFollowupCreated,
  className = "",
}) => {
  const [findings, setFindings] = useState<ConversationGap[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isCreatingFollowup, setIsCreatingFollowup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllFindings, setShowAllFindings] = useState<boolean>(false);
  const [expandedContextId, setExpandedContextId] = useState<string | null>(null);
  const [showResolvedDismissed, setShowResolvedDismissed] = useState<boolean>(false);

  const loadGaps = useCallback(async () => {
    if (!callId) return;
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.getConversationGaps(callId);
      setFindings(res.findings || []);
      setSummary(res.summary || "");
    } catch (err: unknown) {
      console.warn("Could not load conversation gaps:", err);
    } finally {
      setIsLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    loadGaps();
  }, [loadGaps]);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await api.analyzeConversationGaps(callId);
      setFindings(res.findings || []);
      setSummary(res.summary || "");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to run Conversation Gap Detector analysis.");
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdateStatus = async (gapId: string, status: ConversationGapStatus) => {
    try {
      const updated = await api.updateConversationGap(callId, gapId, { status });
      setFindings((prev) => prev.map((g) => (g.id === gapId ? updated : g)));
    } catch (err: unknown) {
      console.error("Failed to update gap status:", err);
    }
  };

  const handleCreateFollowup = async (gapId: string) => {
    setIsCreatingFollowup(gapId);
    try {
      const updated = await api.createGapFollowup(callId, gapId);
      setFindings((prev) => prev.map((g) => (g.id === gapId ? updated : g)));
      if (onFollowupCreated) {
        onFollowupCreated(updated);
      }
    } catch (err: unknown) {
      console.error("Failed to create follow-up from gap:", err);
    } finally {
      setIsCreatingFollowup(null);
    }
  };

  const getCategoryBadge = (type: ConversationGapType) => {
    switch (type) {
      case "missed_discovery":
        return {
          label: "Missed Discovery",
          style: "bg-amber-950/80 text-amber-300 border-amber-500/40",
          icon: "🔍",
        };
      case "unresolved_question":
        return {
          label: "Unresolved Question",
          style: "bg-cyan-950/80 text-cyan-300 border-cyan-500/40",
          icon: "❓",
        };
      case "unconfirmed_agreement":
        return {
          label: "Unconfirmed Agreement",
          style: "bg-purple-950/80 text-purple-300 border-purple-500/40",
          icon: "🤝",
        };
      case "unaddressed_objection":
        return {
          label: "Unaddressed Objection",
          style: "bg-rose-950/80 text-rose-300 border-rose-500/40",
          icon: "🛡️",
        };
      case "unexplored_referral":
        return {
          label: "Unexplored Referral",
          style: "bg-indigo-950/80 text-indigo-300 border-indigo-500/40",
          icon: "👥",
        };
      default:
        return {
          label: "Conversation Gap",
          style: "bg-slate-800 text-slate-300 border-slate-700",
          icon: "💬",
        };
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev.toLowerCase()) {
      case "high":
        return "bg-rose-950/60 text-rose-400 border-rose-500/30";
      case "medium":
        return "bg-amber-950/60 text-amber-400 border-amber-500/30";
      default:
        return "bg-slate-800 text-slate-300 border-slate-700";
    }
  };

  // Severity sorting: high > medium > low
  const severityWeight = (s: string) => {
    if (s === "high") return 3;
    if (s === "medium") return 2;
    return 1;
  };

  const openFindings = findings
    .filter((f) => f.status === "open")
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));

  const resolvedOrDismissed = findings.filter((f) => f.status !== "open");

  // Show at most the two most important findings by default
  const displayedOpenFindings = showAllFindings
    ? openFindings
    : openFindings.slice(0, 2);

  return (
    <div
      className={`rounded-lg border border-[#233554] bg-[#0b132b] p-4 sm:p-5 shadow-lg ${className}`}
    >
      {/* Header */}
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
                Gap Detector
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Identifies potential missed discovery opportunities &amp; unresolved details.
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
                <span>Analyzing Gaps...</span>
              </>
            ) : (
              <>
                <span>✦</span>
                <span>{findings.length > 0 ? "Re-scan Gaps" : "Scan for Gaps"}</span>
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

      {summary && (
        <div className="mt-3 rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-xs text-slate-300">
          <span className="font-semibold text-white">Review Summary:</span> {summary}
        </div>
      )}

      {isLoading && findings.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          Analyzing conversation review data...
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Active Findings Section */}
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

            {openFindings.length === 0 ? (
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
                  const cat = getCategoryBadge(gap.type);
                  const isContextExpanded = expandedContextId === gap.id;

                  return (
                    <div
                      key={gap.id}
                      className="rounded-lg border border-[#233554] bg-[#070d1e] p-3.5 text-xs space-y-2 transition-all hover:border-slate-600"
                    >
                      {/* Top Bar: Badges + Action Buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase flex items-center space-x-1 ${cat.style}`}
                          >
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                          </span>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getSeverityBadge(
                              gap.severity
                            )}`}
                          >
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
                              onClick={() => handleUpdateStatus(gap.id, "resolved")}
                              className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/60 transition-colors"
                              title="Mark this gap as resolved"
                            >
                              ✓ Resolved
                            </button>
                            <button
                              type="button"
                              disabled={isCreatingFollowup === gap.id}
                              onClick={() => handleCreateFollowup(gap.id)}
                              className="rounded bg-[#0062ff] px-2.5 py-0.5 font-semibold text-white hover:bg-[#0052d9] transition-colors disabled:opacity-60"
                              title="Create or link commitment follow-up"
                            >
                              {isCreatingFollowup === gap.id ? "Creating..." : "＋ Create Follow-up"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateStatus(gap.id, "dismissed")}
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
                        <p className="mt-0.5 text-slate-300 leading-relaxed">
                          {gap.description}
                        </p>
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
                          <span className="font-semibold text-slate-400 block">
                            Why it matters:
                          </span>
                          <span className="text-slate-300 leading-snug">
                            {gap.why_it_matters}
                          </span>
                        </div>
                        <div className="rounded bg-[#0062ff]/10 border border-[#0062ff]/30 p-2">
                          <span className="font-semibold text-[#60a5fa] block text-[10px] uppercase">
                            Suggested Next Action:
                          </span>
                          <span className="text-white font-medium leading-snug">
                            {gap.suggested_action}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Toggle to view remaining findings if > 2 */}
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

          {/* Resolved or Dismissed Findings Section (Collapsible) */}
          {resolvedOrDismissed.length > 0 && (
            <div className="pt-2 border-t border-[#233554]/50">
              <button
                type="button"
                onClick={() => setShowResolvedDismissed(!showResolvedDismissed)}
                className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center space-x-1"
              >
                <span>{showResolvedDismissed ? "▼" : "▶"}</span>
                <span>
                  {resolvedOrDismissed.length} resolved / dismissed finding(s)
                </span>
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
                          <span className="font-semibold text-slate-300">
                            {gap.title}
                          </span>
                          {gap.commitment_id && (
                            <span className="rounded bg-blue-950/80 border border-blue-500/30 px-1.5 py-0.5 text-[10px] text-blue-300">
                              Linked to Commitment
                            </span>
                          )}
                        </div>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(gap.id, "open")}
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
  );
};
