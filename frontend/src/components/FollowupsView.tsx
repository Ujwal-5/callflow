"use client";

import React, { useState, useEffect, useMemo } from "react";
import { FollowUpItem, Prospect } from "@/types";

interface FollowupsViewProps {
  followups: FollowUpItem[];
  prospects: Prospect[];
  onCompleteFollowup: (followupId: string) => void;
  onRescheduleFollowup: (followupId: string, newTiming: string, newDate?: string) => void;
  onSelectProspect: (prospectId: string) => void;
  onInspectCall: (callId: string) => void;
  onStartCallWithProspect: (prospect: Prospect) => void;
  onDeleteFollowup?: (followupId: string) => void | Promise<void>;
}

export const FollowupsView: React.FC<FollowupsViewProps> = ({
  followups,
  prospects,
  onCompleteFollowup,
  onRescheduleFollowup,
  onSelectProspect,
  onInspectCall,
  onStartCallWithProspect,
  onDeleteFollowup,
}) => {
  const [activeTab, setActiveTab] = useState<"overdue" | "today" | "upcoming" | "completed" | "all">("overdue");
  const [search, setSearch] = useState("");
  const [reschedulingItem, setReschedulingItem] = useState<FollowUpItem | null>(null);
  const [rescheduleTiming, setRescheduleTiming] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [isSubmittingReschedule, setIsSubmittingReschedule] = useState(false);
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
        // continue
      }
    }
    const rel = (item.relative_due || "").toLowerCase();
    if (rel.includes("yesterday") || rel.includes("last week")) return true;

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

  const isUpcoming = (item: FollowUpItem) => {
    if (item.status === "completed" || item.status === "dismissed") return false;
    return !isOverdue(item) && !isDueToday(item);
  };

  const overdueList = useMemo(() => followups.filter(isOverdue), [followups, currentDate]);
  const todayList = useMemo(() => followups.filter(isDueToday), [followups, currentDate]);
  const upcomingList = useMemo(() => followups.filter(isUpcoming), [followups, currentDate]);
  const completedList = useMemo(() => followups.filter((f) => f.status === "completed"), [followups]);

  // Tab list selection
  const currentList = useMemo(() => {
    let list: FollowUpItem[] = [];
    if (activeTab === "overdue") list = overdueList;
    else if (activeTab === "today") list = todayList;
    else if (activeTab === "upcoming") list = upcomingList;
    else if (activeTab === "completed") list = completedList;
    else list = followups.filter((f) => f.status !== "dismissed");

    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(
      (f) =>
        f.company_name.toLowerCase().includes(q) ||
        (f.contact_name && f.contact_name.toLowerCase().includes(q)) ||
        f.action.toLowerCase().includes(q)
    );
  }, [activeTab, overdueList, todayList, upcomingList, completedList, followups, search]);

  const handleOpenReschedule = (item: FollowUpItem) => {
    setReschedulingItem(item);
    setRescheduleTiming(item.relative_due || "");
    setRescheduleDate(item.due_at ? item.due_at.slice(0, 10) : "");
  };

  const handleSaveReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reschedulingItem) return;
    setIsSubmittingReschedule(true);
    try {
      await onRescheduleFollowup(
        reschedulingItem.id,
        rescheduleTiming.trim() || "Rescheduled",
        rescheduleDate ? new Date(rescheduleDate).toISOString() : undefined
      );
      setReschedulingItem(null);
    } finally {
      setIsSubmittingReschedule(false);
    }
  };

  const findProspect = (companyName: string) => {
    return prospects.find((p) => p.company_name.toLowerCase() === companyName.toLowerCase());
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#233554] pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Follow-up Management</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Track commitments, callbacks, and scheduled next steps using actual persisted data.
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search follow-ups..."
            className="w-full rounded border border-[#233554] bg-[#070d1e] py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none"
          />
          <svg
            className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#233554] pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("overdue")}
          className={`flex items-center space-x-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            activeTab === "overdue"
              ? "bg-rose-950/80 border border-rose-500/40 text-rose-300"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <span>Overdue</span>
          {overdueList.length > 0 && (
            <span className="rounded bg-rose-500/30 px-1.5 py-0.2 text-[10px] font-mono text-rose-300 font-bold">
              {overdueList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("today")}
          className={`flex items-center space-x-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            activeTab === "today"
              ? "bg-amber-950/80 border border-amber-500/40 text-amber-300"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <span>Due Today</span>
          {todayList.length > 0 && (
            <span className="rounded bg-amber-500/30 px-1.5 py-0.2 text-[10px] font-mono text-amber-300 font-bold">
              {todayList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("upcoming")}
          className={`flex items-center space-x-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            activeTab === "upcoming"
              ? "bg-blue-950/80 border border-blue-500/40 text-blue-300"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <span>Upcoming</span>
          {upcomingList.length > 0 && (
            <span className="rounded bg-blue-500/30 px-1.5 py-0.2 text-[10px] font-mono text-blue-300 font-bold">
              {upcomingList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("completed")}
          className={`flex items-center space-x-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            activeTab === "completed"
              ? "bg-emerald-950/80 border border-emerald-500/40 text-emerald-300"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <span>Completed</span>
          {completedList.length > 0 && (
            <span className="rounded bg-emerald-500/30 px-1.5 py-0.2 text-[10px] font-mono text-emerald-300 font-bold">
              {completedList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={`flex items-center space-x-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            activeTab === "all"
              ? "bg-[#101c3d] text-white border border-[#233554]"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <span>All ({followups.length})</span>
        </button>
      </div>

      {/* ── Follow-ups Table / Card List ── */}
      <div className="rounded-lg border border-[#233554] bg-[#0b132b] overflow-hidden shadow-lg">
        {currentList.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">No follow-ups found in this view.</p>
            <p>
              {activeTab === "overdue"
                ? "No overdue action items. All current follow-ups are up to date."
                : "No follow-up items matched your filter or search criteria."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#1c2a47]">
            {currentList.map((item) => {
              const prospect = findProspect(item.company_name);
              const overdue = isOverdue(item);
              const dueToday = isDueToday(item);
              const isDone = item.status === "completed";

              return (
                <div
                  key={item.id}
                  className={`p-4 transition-colors hover:bg-[#101c3d]/40 ${
                    overdue
                      ? "border-l-2 border-rose-500 bg-rose-950/10"
                      : dueToday
                      ? "border-l-2 border-amber-500 bg-amber-950/10"
                      : isDone
                      ? "opacity-75"
                      : ""
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div className="space-y-1.5 flex-1">
                      {/* Top metadata row */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Prospect Link */}
                        <button
                          type="button"
                          onClick={() => {
                            if (prospect) onSelectProspect(prospect.id);
                          }}
                          className="font-bold text-white text-xs hover:text-[#60a5fa] transition-colors"
                        >
                          {item.company_name}
                        </button>

                        {item.contact_name && (
                          <span className="text-[11px] text-slate-400">
                            • {item.contact_name}
                          </span>
                        )}

                        {/* Status badge */}
                        {overdue ? (
                          <span className="rounded bg-rose-950 border border-rose-500/40 px-1.5 py-0.2 text-[9px] font-bold uppercase text-rose-300">
                            Overdue
                          </span>
                        ) : dueToday ? (
                          <span className="rounded bg-amber-950 border border-amber-500/40 px-1.5 py-0.2 text-[9px] font-bold uppercase text-amber-300">
                            Due Today
                          </span>
                        ) : isDone ? (
                          <span className="rounded bg-emerald-950 border border-emerald-500/40 px-1.5 py-0.2 text-[9px] font-semibold uppercase text-emerald-300">
                            ✓ Completed
                          </span>
                        ) : (
                          <span className="rounded bg-blue-950 border border-blue-500/40 px-1.5 py-0.2 text-[9px] font-semibold uppercase text-blue-300">
                            Upcoming
                          </span>
                        )}

                        {/* Channel badge */}
                        {item.channel && item.channel !== "unknown" && (
                          <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[9px] font-mono text-slate-300">
                            via {item.channel}
                          </span>
                        )}
                      </div>

                      {/* Action description */}
                      <p className={`text-xs font-semibold ${isDone ? "line-through text-slate-400" : "text-slate-100"}`}>
                        {item.action}
                      </p>

                      {/* Timing & Originating Call links */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                        {item.relative_due && (
                          <span className={`font-mono ${overdue ? "text-rose-300 font-semibold" : dueToday ? "text-amber-300 font-semibold" : "text-blue-300"}`}>
                            ⏰ Timing: {item.relative_due}
                          </span>
                        )}

                        {item.call_id && (
                          <button
                            type="button"
                            onClick={() => onInspectCall(item.call_id)}
                            className="text-[#60a5fa] hover:text-white underline"
                          >
                            Originating Call Record →
                          </button>
                        )}
                      </div>

                      {/* Evidence quote */}
                      {item.evidence_quote && (
                        <div className="rounded border border-[#233554]/60 bg-[#070d1e] p-2 text-[11px] text-slate-300 italic">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 not-italic block mb-0.5">
                            Recorded Evidence:
                          </span>
                          &ldquo;{item.evidence_quote}&rdquo;
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center space-x-2 shrink-0 pt-1 lg:pt-0">
                      {!isDone && (
                        <button
                          type="button"
                          onClick={() => onCompleteFollowup(item.id)}
                          className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/60 transition-colors"
                        >
                          ✓ Mark Complete
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleOpenReschedule(item)}
                        className="rounded border border-[#233554] bg-[#070d1e] px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                      >
                        📅 Reschedule
                      </button>

                      {prospect && (
                        <button
                          type="button"
                          onClick={() => onStartCallWithProspect(prospect)}
                          className="rounded bg-[#0062ff] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0052d9] transition-colors"
                        >
                          📞 Call Prospect
                        </button>
                      )}

                      {onDeleteFollowup && (
                        <button
                          type="button"
                          title="Delete follow-up"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete this follow-up: "${item.action}"? This cannot be undone.`)) {
                              onDeleteFollowup(item.id);
                            }
                          }}
                          className="rounded border border-rose-500/30 bg-rose-950/20 p-1.5 text-rose-400 hover:border-rose-400 hover:bg-rose-900/40 hover:text-white transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Reschedule Modal ── */}
      {reschedulingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-lg border border-[#233554] bg-[#0b132b] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#233554] pb-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Reschedule Follow-up
              </h3>
              <button
                type="button"
                onClick={() => setReschedulingItem(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Update scheduled timing for follow-up with{" "}
              <strong className="text-white">{reschedulingItem.company_name}</strong>.
            </p>

            <form onSubmit={handleSaveReschedule} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-200 mb-1">
                  Timing Phrase / Description <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={rescheduleTiming}
                  onChange={(e) => setRescheduleTiming(e.target.value)}
                  placeholder="e.g. Tomorrow 10 AM, Friday afternoon, next week"
                  className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-white focus:border-[#0062ff] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-200 mb-1">
                  Optional Target Date
                </label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-white focus:border-[#0062ff] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#233554]">
                <button
                  type="button"
                  onClick={() => setReschedulingItem(null)}
                  className="rounded border border-[#233554] px-3 py-1 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReschedule}
                  className="rounded bg-[#0062ff] px-4 py-1 text-xs font-bold text-white hover:bg-[#0052d9] disabled:opacity-60"
                >
                  {isSubmittingReschedule ? "Saving..." : "Save New Timing"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
