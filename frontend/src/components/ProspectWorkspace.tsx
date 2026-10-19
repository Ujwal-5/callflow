"use client";

import React, { useState, useMemo } from "react";
import { Prospect, Call, FollowUpItem, CreateProspectPayload } from "@/types";

interface ProspectWorkspaceProps {
  prospects: Prospect[];
  calls: Call[];
  followups: FollowUpItem[];
  selectedProspectId: string | null;
  onSelectProspect: (prospectId: string) => void;
  onStartCallWithProspect: (prospect: Prospect, briefing?: string) => void;
  onInspectCall: (callId: string) => void;
  onCompleteFollowup: (followupId: string) => void;
  onRescheduleFollowup: (followup: FollowUpItem) => void;
  onCreateProspect: (payload: CreateProspectPayload) => Promise<Prospect>;
  onDeleteProspect?: (prospectId: string) => void | Promise<void>;
}

export const ProspectWorkspace: React.FC<ProspectWorkspaceProps> = ({
  prospects,
  calls,
  followups,
  selectedProspectId,
  onSelectProspect,
  onStartCallWithProspect,
  onInspectCall,
  onCompleteFollowup,
  onRescheduleFollowup,
  onCreateProspect,
  onDeleteProspect,
}) => {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "has_calls" | "has_followups">("all");
  const [isCreatingProspect, setIsCreatingProspect] = useState(false);

  // New Prospect form state
  const [newCompany, setNewCompany] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newContext, setNewContext] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);

  // Map calls to prospects by company_name (case-insensitive)
  const callsByProspect = useMemo(() => {
    const map = new Map<string, Call[]>();
    for (const call of calls) {
      const compKey = (call.company_name || "").trim().toLowerCase();
      if (!map.has(compKey)) {
        map.set(compKey, []);
      }
      map.get(compKey)!.push(call);
    }
    // Sort calls descending by date
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    }
    return map;
  }, [calls]);

  // Map followups to prospects by company_name
  const followupsByProspect = useMemo(() => {
    const map = new Map<string, FollowUpItem[]>();
    for (const fup of followups) {
      const compKey = (fup.company_name || "").trim().toLowerCase();
      if (!map.has(compKey)) {
        map.set(compKey, []);
      }
      map.get(compKey)!.push(fup);
    }
    return map;
  }, [followups]);

  // Filtered directory list
  const filteredProspects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return prospects.filter((p) => {
      const compKey = p.company_name.trim().toLowerCase();
      const pCalls = callsByProspect.get(compKey) || [];
      const pFollowups = (followupsByProspect.get(compKey) || []).filter(
        (f) => f.status === "pending" || f.status === "confirmed"
      );

      // Search match
      const matchesSearch =
        !query ||
        p.company_name.toLowerCase().includes(query) ||
        (p.contact_name && p.contact_name.toLowerCase().includes(query)) ||
        (p.context && p.context.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      if (filterType === "has_calls") {
        return pCalls.length > 0;
      }
      if (filterType === "has_followups") {
        return pFollowups.length > 0;
      }
      return true;
    });
  }, [prospects, search, filterType, callsByProspect, followupsByProspect]);

  // Selected prospect details
  const activeProspect = useMemo(() => {
    if (!selectedProspectId) {
      // Default to first if available
      return filteredProspects[0] || prospects[0] || null;
    }
    return prospects.find((p) => p.id === selectedProspectId) || prospects[0] || null;
  }, [selectedProspectId, prospects, filteredProspects]);

  const activeProspectCalls = useMemo(() => {
    if (!activeProspect) return [];
    const compKey = activeProspect.company_name.trim().toLowerCase();
    return callsByProspect.get(compKey) || [];
  }, [activeProspect, callsByProspect]);

  const activeProspectFollowups = useMemo(() => {
    if (!activeProspect) return [];
    const compKey = activeProspect.company_name.trim().toLowerCase();
    return (followupsByProspect.get(compKey) || []).filter(
      (f) => f.status === "pending" || f.status === "confirmed"
    );
  }, [activeProspect, followupsByProspect]);

  const latestCall = activeProspectCalls[0] || null;

  // Build a compact previous-conversation briefing string
  const briefingText = useMemo(() => {
    if (!latestCall) return undefined;
    const parts: string[] = [];
    if (latestCall.final_outcome) {
      parts.push(`Last outcome: ${latestCall.final_outcome}`);
    }
    if (latestCall.next_action) {
      parts.push(`Agreed next step: ${latestCall.next_action}`);
    }
    if (latestCall.ai_summary?.summary) {
      parts.push(`Key takeaway: ${latestCall.ai_summary.summary}`);
    } else if (latestCall.prospect_statement) {
      parts.push(`Prospect quote: "${latestCall.prospect_statement}"`);
    }
    return parts.join(" • ");
  }, [latestCall]);

  const handleStartCall = () => {
    if (!activeProspect) return;
    onStartCallWithProspect(activeProspect, briefingText);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompany.trim()) {
      setCreateError("Company name is required.");
      return;
    }
    setCreateError(null);
    setIsSubmittingNew(true);
    try {
      const created = await onCreateProspect({
        company_name: newCompany.trim(),
        contact_name: newContact.trim() || undefined,
        phone_number: newPhone.trim() || undefined,
        context: newContext.trim() || undefined,
      });
      setIsCreatingProspect(false);
      setNewCompany("");
      setNewContact("");
      setNewPhone("");
      setNewContext("");
      onSelectProspect(created.id);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create prospect.");
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const formatDateTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
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
    <div className="space-y-4">
      {/* ── Top Header / Actions ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#233554] pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Prospect Workspaces</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Searchable directory and persistent individual lead workspaces with historical briefings.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsCreatingProspect(true);
            setCreateError(null);
          }}
          className="flex items-center space-x-1.5 rounded-lg bg-[#0062ff] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#0052d9] transition-all self-start sm:self-auto shadow-sm shadow-[#0062ff]/20"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add New Prospect</span>
        </button>
      </div>

      {/* ── Add Prospect Modal / Drawer ── */}
      {isCreatingProspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-lg border border-[#233554] bg-[#0b132b] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#233554] pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Add Prospect to Directory
              </h2>
              <button
                type="button"
                onClick={() => setIsCreatingProspect(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {createError && (
              <div className="rounded border border-rose-500/40 bg-rose-950/40 p-2.5 text-xs text-rose-300">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-200 mb-1">
                  Company / Organization Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="e.g. Acme Industrial Robotics"
                  className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-white focus:border-[#0062ff] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-200 mb-1">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    value={newContact}
                    onChange={(e) => setNewContact(e.target.value)}
                    placeholder="e.g. John Doe (VP Ops)"
                    className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-white focus:border-[#0062ff] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-200 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="e.g. +1 555-0192"
                    className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-white focus:border-[#0062ff] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-200 mb-1">
                  Lead Context / Notes
                </label>
                <textarea
                  rows={2}
                  value={newContext}
                  onChange={(e) => setNewContext(e.target.value)}
                  placeholder="e.g. Visited pricing page twice; requested demo brief"
                  className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-2 text-white focus:border-[#0062ff] focus:outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#233554]">
                <button
                  type="button"
                  onClick={() => setIsCreatingProspect(false)}
                  className="rounded border border-[#233554] px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingNew}
                  className="rounded bg-[#0062ff] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#0052d9] disabled:opacity-60"
                >
                  {isSubmittingNew ? "Saving..." : "Save Prospect"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Master-Detail Layout ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        {/* Left Column: Searchable Directory (5 cols) */}
        <div className="md:col-span-4 lg:col-span-4 rounded-lg border border-[#233554] bg-[#0b132b] overflow-hidden">
          <div className="p-3 border-b border-[#233554] space-y-2.5 bg-[#101c3d]/40">
            {/* Search input */}
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search directory..."
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

            {/* Filter pills */}
            <div className="flex items-center space-x-1 text-[11px]">
              <button
                type="button"
                onClick={() => setFilterType("all")}
                className={`rounded px-2 py-0.5 transition-colors ${
                  filterType === "all"
                    ? "bg-[#0062ff] text-white font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                All ({prospects.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterType("has_calls")}
                className={`rounded px-2 py-0.5 transition-colors ${
                  filterType === "has_calls"
                    ? "bg-[#0062ff] text-white font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Called
              </button>
              <button
                type="button"
                onClick={() => setFilterType("has_followups")}
                className={`rounded px-2 py-0.5 transition-colors ${
                  filterType === "has_followups"
                    ? "bg-[#0062ff] text-white font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Follow-ups
              </button>
            </div>
          </div>

          {/* Directory List */}
          <div className="max-h-[620px] overflow-y-auto divide-y divide-[#1c2a47]">
            {filteredProspects.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No prospects matching &ldquo;{search}&rdquo;.
              </div>
            ) : (
              filteredProspects.map((p) => {
                const isSelected = activeProspect?.id === p.id;
                const pCalls = callsByProspect.get(p.company_name.trim().toLowerCase()) || [];
                const pFollowups = (
                  followupsByProspect.get(p.company_name.trim().toLowerCase()) || []
                ).filter((f) => f.status === "pending" || f.status === "confirmed");

                return (
                  <div
                    key={p.id}
                    onClick={() => onSelectProspect(p.id)}
                    className={`p-3 cursor-pointer transition-colors text-xs ${
                      isSelected
                        ? "bg-[#101c3d] border-l-2 border-[#0062ff]"
                        : "hover:bg-[#101c3d]/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-bold truncate ${isSelected ? "text-white" : "text-slate-200"}`}>
                        {p.company_name}
                      </span>
                      <div className="flex items-center space-x-1 shrink-0 ml-1">
                        {p.is_custom && (
                          <span className="rounded bg-indigo-950 border border-indigo-500/40 px-1 py-0.2 text-[9px] font-mono text-indigo-300">
                            Custom
                          </span>
                        )}
                        {onDeleteProspect && (
                          <button
                            type="button"
                            title="Delete prospect"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Are you sure you want to delete prospect "${p.company_name}"?`)) {
                                onDeleteProspect(p.id);
                              }
                            }}
                            className="opacity-50 hover:opacity-100 p-0.5 rounded text-rose-400 hover:text-white hover:bg-rose-900/40 transition-opacity"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {p.contact_name && (
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {p.contact_name}
                      </p>
                    )}

                    <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                      {pCalls.length > 0 ? (
                        <span className="rounded bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.2 text-emerald-300 font-mono">
                          {pCalls.length} {pCalls.length === 1 ? "call" : "calls"}
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">No calls yet</span>
                      )}

                      {pFollowups.length > 0 && (
                        <span className="rounded bg-amber-950/60 border border-amber-500/30 px-1.5 py-0.2 text-amber-300 font-mono">
                          {pFollowups.length} follow-up
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Persistent Prospect Workspace (7-8 cols) */}
        <div className="md:col-span-8 lg:col-span-8 space-y-5">
          {activeProspect ? (
            <>
              {/* ── Prospect Profile Card ── */}
              <div className="rounded-lg border border-[#233554] bg-[#0b132b] p-5 shadow-lg space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-[#233554] pb-4">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#0062ff]">
                        Prospect Workspace
                      </span>
                      {activeProspect.is_custom && (
                        <span className="rounded bg-indigo-950 border border-indigo-500/40 px-1.5 py-0.2 text-[10px] font-mono text-indigo-300">
                          User Added
                        </span>
                      )}
                    </div>
                    <h2 className="text-xl font-bold text-white mt-1">
                      {activeProspect.company_name}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-slate-300">
                      {activeProspect.contact_name && (
                        <span>
                          <strong className="text-slate-400">Contact:</strong>{" "}
                          {activeProspect.contact_name}
                        </span>
                      )}
                      {activeProspect.phone_number && (
                        <span>
                          <strong className="text-slate-400">Phone:</strong>{" "}
                          <span className="font-mono text-slate-200">{activeProspect.phone_number}</span>
                        </span>
                      )}
                      <span>
                        <strong className="text-slate-400">Calls Logged:</strong>{" "}
                        <span className="font-mono">{activeProspectCalls.length}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    {onDeleteProspect && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Are you sure you want to delete prospect "${activeProspect.company_name}"? This cannot be undone.`)) {
                            onDeleteProspect(activeProspect.id);
                          }
                        }}
                        className="flex items-center space-x-1.5 rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-900/50 hover:text-white transition-colors"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Delete</span>
                      </button>
                    )}

                    {/* Prominent Start Call CTA */}
                    <button
                      type="button"
                      onClick={handleStartCall}
                      className="flex items-center space-x-2 rounded-lg bg-[#0062ff] px-4 py-2 text-xs font-bold text-white hover:bg-[#0052d9] transition-all shadow-md shadow-[#0062ff]/30 shrink-0"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span>Start Call with {activeProspect.company_name}</span>
                    </button>
                  </div>
                </div>

                {activeProspect.context && (
                  <div className="rounded border border-[#233554]/60 bg-[#101c3d]/40 p-3 text-xs">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Lead Context / Background:
                    </span>
                    <p className="text-slate-200 italic leading-relaxed">
                      &ldquo;{activeProspect.context}&rdquo;
                    </p>
                  </div>
                )}
              </div>

              {/* ── Compact Pre-Call Briefing (if previous call exists) ── */}
              {latestCall && (
                <div className="rounded-lg border border-[#0062ff]/30 bg-[#0062ff]/10 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-[#0062ff] text-white text-[10px] font-bold">
                        ✦
                      </span>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                        Previous Conversation Briefing
                      </h3>
                    </div>
                    <span className="font-mono text-[11px] text-[#60a5fa]">
                      Last called {formatDateTime(latestCall.started_at)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">
                        Last Outcome:
                      </span>
                      <span className="text-white font-medium">
                        {latestCall.final_outcome || "In progress"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">
                        Agreed Next Step:
                      </span>
                      <span className="text-white font-medium">
                        {latestCall.next_action || "None specified"}
                        {latestCall.follow_up_time && ` (${latestCall.follow_up_time})`}
                      </span>
                    </div>
                  </div>

                  {latestCall.ai_summary?.summary && (
                    <div className="pt-2 border-t border-[#0062ff]/20 text-xs">
                      <span className="text-[11px] font-semibold text-slate-400 block">
                        AI Executive Summary:
                      </span>
                      <p className="text-slate-200 mt-0.5 leading-relaxed">
                        {latestCall.ai_summary.summary}
                      </p>
                    </div>
                  )}

                  {latestCall.ai_summary?.suggested_next_action && (
                    <div className="text-xs text-[#3884ff]">
                      <strong>Suggested pitch angle:</strong> {latestCall.ai_summary.suggested_next_action}
                    </div>
                  )}
                </div>
              )}

              {/* ── Outstanding Follow-ups for this Prospect ── */}
              <div className="rounded-lg border border-[#233554] bg-[#0b132b] overflow-hidden">
                <div className="flex items-center justify-between border-b border-[#233554] px-4 py-3 bg-[#101c3d]/50">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Outstanding Follow-ups ({activeProspectFollowups.length})
                  </h3>
                </div>

                {activeProspectFollowups.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    No active follow-ups for this prospect.
                  </div>
                ) : (
                  <div className="divide-y divide-[#1c2a47]">
                    {activeProspectFollowups.map((fup) => (
                      <div key={fup.id} className="p-3 sm:px-4 flex items-center justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <p className="font-semibold text-white">{fup.action}</p>
                          <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                            {fup.relative_due && (
                              <span className="text-[#60a5fa] font-mono">⏰ {fup.relative_due}</span>
                            )}
                            {fup.channel && <span>via {fup.channel}</span>}
                          </div>
                        </div>

                        <div className="flex items-center space-x-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onCompleteFollowup(fup.id)}
                            className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/60 text-[11px]"
                          >
                            ✓ Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => onRescheduleFollowup(fup)}
                            className="rounded border border-[#233554] bg-[#070d1e] px-2 py-0.5 text-slate-300 hover:text-white text-[11px]"
                          >
                            📅 Reschedule
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Previous Calls History for this Prospect ── */}
              <div className="rounded-lg border border-[#233554] bg-[#0b132b] overflow-hidden">
                <div className="flex items-center justify-between border-b border-[#233554] px-4 py-3 bg-[#101c3d]/50">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Previous Call Sessions ({activeProspectCalls.length})
                  </h3>
                </div>

                {activeProspectCalls.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <p className="text-xs text-slate-400">
                      No cold calls have been recorded with {activeProspect.company_name} yet.
                    </p>
                    <button
                      type="button"
                      onClick={handleStartCall}
                      className="rounded bg-[#0062ff] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0052d9]"
                    >
                      Start First Call Session
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-[#1c2a47]">
                    {activeProspectCalls.map((call) => (
                      <div
                        key={call.id}
                        className="p-3 sm:px-4 hover:bg-[#101c3d]/40 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-[11px] font-semibold text-slate-300">
                              {formatDateTime(call.started_at)}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">
                              (Stage {call.highest_stage} of 8)
                            </span>
                          </div>

                          <div>{getOutcomeBadge(call.final_outcome)}</div>

                          {call.next_action && (
                            <p className="text-[11px] text-slate-300 italic line-clamp-1">
                              Next: {call.next_action}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => onInspectCall(call.id)}
                          className="self-start sm:self-auto rounded border border-[#233554] bg-[#070d1e] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                        >
                          Inspect Record →
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-12 text-center rounded-lg border border-[#233554] bg-[#0b132b]">
              <p className="text-sm font-semibold text-white">Select a prospect to open their workspace</p>
              <p className="text-xs text-slate-400 mt-1">
                Choose an organization from the directory on the left or add a new prospect.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
