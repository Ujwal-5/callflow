"use client";

import React, { useState, useEffect } from "react";
import { Call, FollowUpItem, Prospect, MainNavigationArea } from "@/types";

interface OverviewViewProps {
  calls: Call[];
  followups: FollowUpItem[];
  prospects: Prospect[];
  activeCall: Call | null;
  onNavigate: (view: MainNavigationArea) => void;
  onSelectCall: (callId: string) => void;
  onSelectProspect: (prospectId: string) => void;
  onCompleteFollowup: (followupId: string) => void;
  onRescheduleFollowup: (followup: FollowUpItem) => void;
  onStartCallWithProspect: (prospect: Prospect) => void;
  onStartNewCall: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  calls,
  followups,
  prospects,
  activeCall,
  onNavigate,
  onSelectCall,
  onSelectProspect,
  onCompleteFollowup,
  onRescheduleFollowup,
  onStartCallWithProspect,
  onStartNewCall,
}) => {
  const [currentDate, setCurrentDate] = useState<Date | null>(null);

  useEffect(() => {
    setCurrentDate(new Date());
  }, []);

  const startOfToday = currentDate
    ? new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
    : null;
  const endOfToday = currentDate
    ? new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 23, 59, 59, 999)
    : null;

  const isOverdue = (item: FollowUpItem) => {
    if (!currentDate || !startOfToday) return false;
    if (item.status === "completed" || item.status === "dismissed") return false;
    if (item.due_at) {
      try {
        const d = new Date(item.due_at);
        return d < startOfToday;
      } catch {
        // continue to text check
      }
    }
    const rel = (item.relative_due || "").toLowerCase();
    if (rel.includes("yesterday") || rel.includes("last week")) return true;
    
    // Check if created in past with relative "tomorrow" or "today"
    if (item.created_at) {
      try {
        const createdDate = new Date(item.created_at);
        const daysDiff = (currentDate.getTime() - createdDate.getTime()) / (1000 * 3600 * 24);
        if (daysDiff > 2 && (rel.includes("tomorrow") || rel.includes("today") || rel.includes("30 min") || rel.includes("evening"))) {
          return true;
        }
      } catch {
        // ignore
      }
    }
    return false;
  };

  const isDueToday = (item: FollowUpItem) => {
    if (!currentDate || !startOfToday || !endOfToday) return false;
    if (item.status === "completed" || item.status === "dismissed") return false;
    if (isOverdue(item)) return false;
    if (item.due_at) {
      try {
        const d = new Date(item.due_at);
        return d >= startOfToday && d <= endOfToday;
      } catch {
        // continue
      }
    }
    const rel = (item.relative_due || "").toLowerCase();
    if (rel.includes("today") || rel.includes("evening") || rel.includes("30 min") || rel.includes("afternoon")) {
      return true;
    }
    return false;
  };

  const overdueItems = followups.filter(isOverdue);
  const dueTodayItems = followups.filter(isDueToday);
  const pendingCount = followups.filter((f) => f.status === "pending" || f.status === "confirmed").length;

  const recentCalls = calls.slice(0, 5);

  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  const getOutcomeBadge = (outcome: string | null) => {
    if (!outcome) {
      return (
        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
          In progress
        </span>
      );
    }
    if (outcome.includes("agreed") || outcome.includes("Interested")) {
      return (
        <span className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
          {outcome}
        </span>
      );
    }
    if (outcome.includes("requested") || outcome.includes("Referred")) {
      return (
        <span className="rounded border border-blue-500/40 bg-blue-950/40 px-2 py-0.5 text-[10px] font-medium text-blue-300">
          {outcome}
        </span>
      );
    }
    return (
      <span className="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-300">
        {outcome}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#233554] pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Sales Overview</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Today&apos;s priorities, scheduled follow-ups, and recent call activity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeCall && activeCall.status === "in_progress" ? (
            <button
              onClick={() => onNavigate("active")}
              className="flex items-center space-x-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-all shadow-md shadow-emerald-900/30"
            >
              <span className="h-2 w-2 rounded-full bg-white animate-ping" />
              <span>Resume Active Call ({activeCall.company_name}) →</span>
            </button>
          ) : (
            <button
              onClick={onStartNewCall}
              className="flex items-center space-x-1.5 rounded-lg bg-[#0062ff] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#0052d9] transition-all shadow-md shadow-[#0062ff]/20"
            >
              <span>+ Start Cold Call</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Summary Metrics Strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          onClick={() => onNavigate("followups")}
          className="cursor-pointer rounded-lg border border-[#233554] bg-[#0b132b] p-3 hover:border-slate-500 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Overdue Actions
            </span>
            <span className="h-2 w-2 rounded-full bg-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className={`text-2xl font-bold ${overdueItems.length > 0 ? "text-rose-400" : "text-white"}`}>
              {overdueItems.length}
            </span>
            <span className="text-[11px] text-slate-400">require attention</span>
          </div>
        </div>

        <div
          onClick={() => onNavigate("followups")}
          className="cursor-pointer rounded-lg border border-[#233554] bg-[#0b132b] p-3 hover:border-slate-500 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Due Today
            </span>
            <span className="h-2 w-2 rounded-full bg-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-amber-300">{dueTodayItems.length}</span>
            <span className="text-[11px] text-slate-400">scheduled</span>
          </div>
        </div>

        <div
          onClick={() => onNavigate("prospects")}
          className="cursor-pointer rounded-lg border border-[#233554] bg-[#0b132b] p-3 hover:border-slate-500 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Prospect Directory
            </span>
            <span className="h-2 w-2 rounded-full bg-[#0062ff]" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white">{prospects.length}</span>
            <span className="text-[11px] text-slate-400">total leads</span>
          </div>
        </div>

        <div
          onClick={() => onNavigate("history")}
          className="cursor-pointer rounded-lg border border-[#233554] bg-[#0b132b] p-3 hover:border-slate-500 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Completed Calls
            </span>
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white">{calls.length}</span>
            <span className="text-[11px] text-slate-400">sessions recorded</span>
          </div>
        </div>
      </div>

      {/* ── Two-Column Layout: Priorities & Follow-ups on Left, Recent Activity on Right ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): Overdue & Due Today Priorities */}
        <div className="lg:col-span-2 space-y-6">
          {/* Overdue Follow-ups Section */}
          <div className="rounded-lg border border-[#233554] bg-[#0b132b] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#233554] px-4 py-3 bg-[#101c3d]/50">
              <div className="flex items-center space-x-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-rose-950 border border-rose-500/40 text-[10px] text-rose-400 font-bold">
                  !
                </span>
                <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                  Overdue Priorities ({overdueItems.length})
                </h2>
              </div>
              <button
                onClick={() => onNavigate("followups")}
                className="text-xs text-[#60a5fa] hover:text-white transition-colors"
              >
                View all follow-ups →
              </button>
            </div>

            {overdueItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                <span className="text-emerald-400 font-semibold">✓ All caught up!</span> No overdue follow-ups.
              </div>
            ) : (
              <div className="divide-y divide-[#1c2a47]">
                {overdueItems.slice(0, 4).map((item) => (
                  <div key={item.id} className="p-3 sm:px-4 hover:bg-[#101c3d]/40 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              const match = prospects.find(
                                (p) => p.company_name.toLowerCase() === item.company_name.toLowerCase()
                              );
                              if (match) onSelectProspect(match.id);
                              else onNavigate("prospects");
                            }}
                            className="font-bold text-white hover:text-[#60a5fa] text-xs text-left"
                          >
                            {item.company_name}
                          </button>
                          {item.contact_name && (
                            <span className="text-[11px] text-slate-400">
                              ({item.contact_name})
                            </span>
                          )}
                          <span className="rounded bg-rose-950/80 border border-rose-500/40 px-1.5 py-0.2 text-[9px] font-semibold uppercase text-rose-300">
                            Overdue
                          </span>
                        </div>
                        <p className="text-xs text-slate-200">{item.action}</p>
                        {item.relative_due && (
                          <span className="text-[11px] font-mono text-rose-300">
                            ⏰ Was scheduled: {item.relative_due}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-1.5 shrink-0 self-start sm:self-auto pt-1 sm:pt-0">
                        <button
                          type="button"
                          onClick={() => onCompleteFollowup(item.id)}
                          className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/60"
                        >
                          ✓ Done
                        </button>
                        <button
                          type="button"
                          onClick={() => onRescheduleFollowup(item)}
                          className="rounded border border-[#233554] bg-[#070d1e] px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white"
                        >
                          📅 Reschedule
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Due Today Tasks Section */}
          <div className="rounded-lg border border-[#233554] bg-[#0b132b] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#233554] px-4 py-3 bg-[#101c3d]/50">
              <div className="flex items-center space-x-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-950 border border-amber-500/40 text-[10px] text-amber-300 font-bold">
                  ⏰
                </span>
                <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                  Actions Due Today ({dueTodayItems.length})
                </h2>
              </div>
              <button
                onClick={() => onNavigate("followups")}
                className="text-xs text-[#60a5fa] hover:text-white transition-colors"
              >
                View all →
              </button>
            </div>

            {dueTodayItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No specific follow-up actions scheduled for today. Check upcoming follow-ups or start calling prospects.
              </div>
            ) : (
              <div className="divide-y divide-[#1c2a47]">
                {dueTodayItems.slice(0, 4).map((item) => (
                  <div key={item.id} className="p-3 sm:px-4 hover:bg-[#101c3d]/40 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              const match = prospects.find(
                                (p) => p.company_name.toLowerCase() === item.company_name.toLowerCase()
                              );
                              if (match) onSelectProspect(match.id);
                              else onNavigate("prospects");
                            }}
                            className="font-bold text-white hover:text-[#60a5fa] text-xs text-left"
                          >
                            {item.company_name}
                          </button>
                          {item.channel && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[9px] font-mono text-slate-300">
                              via {item.channel}
                            </span>
                          )}
                          <span className="rounded bg-amber-950/80 border border-amber-500/40 px-1.5 py-0.2 text-[9px] font-semibold uppercase text-amber-300">
                            Today
                          </span>
                        </div>
                        <p className="text-xs text-slate-200">{item.action}</p>
                        {item.relative_due && (
                          <span className="text-[11px] font-mono text-amber-300">
                            ⏰ {item.relative_due}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-1.5 shrink-0 self-start sm:self-auto pt-1 sm:pt-0">
                        <button
                          type="button"
                          onClick={() => onCompleteFollowup(item.id)}
                          className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/60"
                        >
                          ✓ Done
                        </button>
                        <button
                          type="button"
                          onClick={() => onRescheduleFollowup(item)}
                          className="rounded border border-[#233554] bg-[#070d1e] px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white"
                        >
                          📅 Reschedule
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 span): Recent Activity & Quick Action */}
        <div className="space-y-6">
          {/* Quick Call Action Card */}
          <div className="rounded-lg border border-[#233554] bg-gradient-to-b from-[#101c3d] to-[#0b132b] p-4 space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#3884ff]">
              Quick Start
            </span>
            <h3 className="text-sm font-bold text-white">Next Cold Call</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Open the prospect directory to choose an organization or start a call session immediately.
            </p>
            <div className="pt-1 flex flex-col gap-2">
              <button
                type="button"
                onClick={onStartNewCall}
                className="w-full rounded bg-[#0062ff] px-3 py-2 text-xs font-bold text-white hover:bg-[#0052d9] transition-all shadow-sm shadow-[#0062ff]/30 text-center"
              >
                + Launch New Call
              </button>
              <button
                type="button"
                onClick={() => onNavigate("prospects")}
                className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-500 text-center"
              >
                Browse Directory ({prospects.length}) →
              </button>
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="rounded-lg border border-[#233554] bg-[#0b132b] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#233554] px-4 py-3 bg-[#101c3d]/50">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                Recent Activity ({recentCalls.length})
              </h2>
              <button
                onClick={() => onNavigate("history")}
                className="text-xs text-[#60a5fa] hover:text-white transition-colors"
              >
                All calls →
              </button>
            </div>

            {recentCalls.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No recent calls recorded.
              </div>
            ) : (
              <div className="divide-y divide-[#1c2a47]">
                {recentCalls.map((call) => (
                  <div
                    key={call.id}
                    onClick={() => onSelectCall(call.id)}
                    className="p-3 hover:bg-[#101c3d]/40 cursor-pointer transition-colors space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs truncate max-w-[150px]">
                        {call.company_name}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {formatTimeAgo(call.started_at)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <div>{getOutcomeBadge(call.final_outcome)}</div>
                      <span className="text-[10px] font-mono text-slate-400">
                        Stage {call.highest_stage}/8
                      </span>
                    </div>

                    {call.next_action && (
                      <p className="text-[11px] text-slate-300 line-clamp-1 italic">
                        &ldquo;{call.next_action}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
