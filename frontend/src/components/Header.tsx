"use client";

import React from "react";
import { Call } from "@/types";

interface HeaderProps {
  activeView: "active" | "history";
  onViewChange: (view: "active" | "history") => void;
  activeCall: Call | null;
  historyCount?: number;
  apiConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onViewChange,
  activeCall,
  historyCount = 0,
  apiConnected,
}) => {
  return (
    <header className="border-b border-[#233554] bg-[#0b132b] px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        {/* Brand identity */}
        <div className="flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-[#0062ff] font-bold text-white shadow-sm shadow-[#0062ff]/30">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-baseline space-x-2">
              <span className="text-xl font-bold tracking-tight text-white">
                CallFlow
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0062ff]">
                Sales Call Assistant
              </span>
            </div>
            <p className="hidden text-xs text-slate-400 sm:block">
              Stay on track. Make every call count.
            </p>
          </div>
        </div>

        {/* Center / Status indicator */}
        <div className="flex items-center space-x-3">
          {activeCall && activeCall.status === "in_progress" ? (
            <div className="flex items-center space-x-2 rounded border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              <span className="font-semibold text-emerald-400 uppercase tracking-wide">
                Live Call:
              </span>
              <span className="max-w-[140px] truncate font-medium text-emerald-200 sm:max-w-[200px]">
                {activeCall.company_name}
              </span>
            </div>
          ) : (
            <div className="hidden items-center space-x-2 rounded border border-[#233554] bg-[#101c3d] px-2.5 py-1 text-xs text-slate-400 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-500"></span>
              <span className="uppercase tracking-wider">Standby</span>
            </div>
          )}

          {/* Backend Connection Dot */}
          <div
            title={apiConnected ? "Backend API connected" : "Backend unreachable"}
            className="flex items-center space-x-1.5 text-[11px] text-slate-400"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                apiConnected ? "bg-emerald-500" : "bg-red-500 animate-pulse"
              }`}
            />
            <span className="hidden md:inline">
              {apiConnected ? "API OK" : "Offline"}
            </span>
          </div>
        </div>

        {/* View switcher */}
        <nav className="flex items-center rounded border border-[#233554] bg-[#101c3d] p-0.5 text-xs font-medium">
          <button
            onClick={() => onViewChange("active")}
            className={`flex items-center space-x-1.5 rounded px-3 py-1.5 transition-colors ${
              activeView === "active"
                ? "bg-[#0062ff] text-white shadow-sm font-semibold"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <span>Active Call</span>
            {activeCall && activeCall.status === "in_progress" && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => onViewChange("history")}
            className={`flex items-center space-x-1.5 rounded px-3 py-1.5 transition-colors ${
              activeView === "history"
                ? "bg-[#0062ff] text-white shadow-sm font-semibold"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <span>Past Calls</span>
            {historyCount > 0 && (
              <span className="rounded bg-[#233554] px-1.5 py-0.2 text-[10px] text-slate-200">
                {historyCount}
              </span>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
};
