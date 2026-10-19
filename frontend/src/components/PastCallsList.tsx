"use client";

import React, { useState, useMemo } from "react";
import { Call } from "@/types";

interface PastCallsListProps {
  calls: Call[];
  onSelectCall: (callId: string) => void;
  onDeleteCall?: (callId: string) => void | Promise<void>;
  isLoading?: boolean;
}

const OUTCOME_OPTIONS = [
  "All Outcomes",
  "Interested; follow-up agreed",
  "Information requested",
  "Callback requested",
  "Referred to another person",
  "Not interested",
  "Wrong contact or number",
  "Call ended unexpectedly",
  "Other",
];

const STAGE_OPTIONS = [
  { label: "All Stages", value: 0 },
  { label: "Stage 1: Opening", value: 1 },
  { label: "Stage 2: Purpose", value: 2 },
  { label: "Stage 3: Permission", value: 3 },
  { label: "Stage 4: Their business", value: 4 },
  { label: "Stage 5: Need", value: 5 },
  { label: "Stage 6: Objection", value: 6 },
  { label: "Stage 7: Next step", value: 7 },
  { label: "Stage 8: Close", value: 8 },
];

export const PastCallsList: React.FC<PastCallsListProps> = ({
  calls,
  onSelectCall,
  onDeleteCall,
  isLoading = false,
}) => {
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("All Outcomes");
  const [stageFilter, setStageFilter] = useState(0);

  // Format UTC string to human-readable local time
  const formatDateTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  const filteredCalls = useMemo(() => {
    return calls.filter((c) => {
      // Search filter
      const matchesSearch =
        !search.trim() ||
        c.company_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.contact_name && c.contact_name.toLowerCase().includes(search.toLowerCase()));

      // Outcome filter
      const matchesOutcome =
        outcomeFilter === "All Outcomes" || c.final_outcome === outcomeFilter;

      // Stage filter
      const matchesStage = stageFilter === 0 || c.highest_stage === stageFilter;

      return matchesSearch && matchesOutcome && matchesStage;
    });
  }, [calls, search, outcomeFilter, stageFilter]);

  const getOutcomeBadge = (outcome: string | null) => {
    if (!outcome) {
      return (
        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
          In progress / Unlogged
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
    if (outcome.includes("Not interested") || outcome.includes("Wrong")) {
      return (
        <span className="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-300">
          {outcome}
        </span>
      );
    }
    return (
      <span className="rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium text-amber-300">
        {outcome}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-2 rounded-lg border border-[#233554] bg-[#0b132b] p-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by prospect or company name..."
            className="w-full rounded border border-[#233554] bg-[#070d1e] py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none"
          />
          <svg
            className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Outcome Filter */}
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="rounded border border-[#233554] bg-[#070d1e] px-2.5 py-1.5 text-xs text-slate-300 focus:border-[#0062ff] focus:outline-none"
          >
            {OUTCOME_OPTIONS.map((opt) => (
              <option key={opt} value={opt} className="bg-[#0b132b] text-white">
                {opt}
              </option>
            ))}
          </select>

          {/* Stage Filter */}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(Number(e.target.value))}
            className="rounded border border-[#233554] bg-[#070d1e] px-2.5 py-1.5 text-xs text-slate-300 focus:border-[#0062ff] focus:outline-none"
          >
            {STAGE_OPTIONS.map((st) => (
              <option key={st.value} value={st.value} className="bg-[#0b132b] text-white">
                {st.label}
              </option>
            ))}
          </select>

          {(search || outcomeFilter !== "All Outcomes" || stageFilter !== 0) && (
            <button
              onClick={() => {
                setSearch("");
                setOutcomeFilter("All Outcomes");
                setStageFilter(0);
              }}
              className="text-[11px] font-medium text-slate-400 hover:text-white underline px-1"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Calls Table / List */}
      <div className="overflow-hidden rounded-lg border border-[#233554] bg-[#0b132b] shadow-xl">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-slate-400">
            <span className="inline-block animate-spin mr-2">⟳</span>
            Loading call history...
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[#233554] bg-[#101c3d] text-slate-400">
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-white">No calls found</h4>
            <p className="mt-1 text-xs text-slate-400">
              {calls.length === 0
                ? "You haven't recorded any cold calls yet. Click 'Active Call' to start your first session."
                : "No calls matched your current search or filter criteria."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#233554] bg-[#101c3d] text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Prospect & Contact</th>
                  <th className="px-4 py-3">Date / Time</th>
                  <th className="px-4 py-3">Stage Reached</th>
                  <th className="px-4 py-3">Call Outcome</th>
                  <th className="px-4 py-3">Next Action</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c2a47]">
                {filteredCalls.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => onSelectCall(c.id)}
                    className="group cursor-pointer hover:bg-[#101c3d]/60 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-bold text-white group-hover:text-[#3b82f6]">
                        {c.company_name}
                      </div>
                      {c.contact_name && (
                        <div className="text-[11px] text-slate-400">
                          {c.contact_name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-300">
                      {formatDateTime(c.started_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[11px] font-semibold text-slate-200">
                        Stage {c.highest_stage} of 8
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        {getOutcomeBadge(c.final_outcome)}
                      </div>
                      {c.referral_name && (
                        <div className="mt-1 text-[10px] text-blue-300 truncate max-w-[180px]" title={`Referral: ${c.referral_name}${c.referral_contact ? ` (${c.referral_contact})` : ""}`}>
                          ↪ Ref: <span className="text-white">{c.referral_name}</span>
                        </div>
                      )}
                      {c.objection && (
                        <div className="mt-0.5 text-[10px] text-amber-300 truncate max-w-[180px]" title={`Objection: ${c.objection}`}>
                          ⚠ {c.objection}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {c.next_action ? (
                        <div>
                          <span className="line-clamp-1 max-w-[200px]" title={c.next_action}>
                            {c.next_action}
                          </span>
                          {c.follow_up_time && (
                            <span className="mt-0.5 block font-mono text-[10px] text-slate-400">
                              ⏰ {c.follow_up_time} {c.follow_up_channel ? `(${c.follow_up_channel})` : ""}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCall(c.id);
                          }}
                          className="rounded border border-[#233554] bg-[#070d1e] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-400 hover:text-white"
                        >
                          Inspect Record
                        </button>
                        {onDeleteCall && (
                          <button
                            type="button"
                            title="Delete call record"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Are you sure you want to delete the call record for "${c.company_name}"? This cannot be undone.`)) {
                                onDeleteCall(c.id);
                              }
                            }}
                            className="rounded border border-rose-500/30 bg-rose-950/20 p-1 text-rose-400 hover:border-rose-400 hover:bg-rose-900/40 hover:text-white transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
