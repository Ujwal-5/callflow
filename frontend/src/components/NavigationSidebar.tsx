"use client";

import React, { useState } from "react";
import { Call, MainNavigationArea } from "@/types";
import { ServiceStatus } from "./ServiceStatusBanner";

interface NavigationSidebarProps {
  activeView: MainNavigationArea;
  onViewChange: (view: MainNavigationArea) => void;
  activeCall: Call | null;
  historyCount?: number;
  prospectsCount?: number;
  followupsCount?: number;
  overdueCount?: number;
  serviceStatus: ServiceStatus;
  onStartNewCall?: () => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  activeView,
  onViewChange,
  activeCall,
  historyCount = 0,
  prospectsCount = 0,
  followupsCount = 0,
  overdueCount = 0,
  serviceStatus,
  onStartNewCall,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const hasLiveCall = Boolean(activeCall && activeCall.status === "in_progress");

  const navItems: {
    id: MainNavigationArea;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
    badgeColor?: string;
  }[] = [
    {
      id: "overview",
      label: "Overview",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      id: "prospects",
      label: "Prospects",
      badge: prospectsCount > 0 ? prospectsCount : undefined,
      badgeColor: "bg-[#1c2a47] text-slate-300",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      id: "followups",
      label: "Follow-ups",
      badge: overdueCount > 0 ? `${overdueCount} due` : followupsCount > 0 ? followupsCount : undefined,
      badgeColor: overdueCount > 0 ? "bg-rose-950/80 border border-rose-500/40 text-rose-300" : "bg-[#1c2a47] text-slate-300",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: "history",
      label: "Call History",
      badge: historyCount > 0 ? historyCount : undefined,
      badgeColor: "bg-[#1c2a47] text-slate-300",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    ...(hasLiveCall
      ? [
          {
            id: "active" as MainNavigationArea,
            label: "Live Call",
            badge: `Stage ${activeCall?.current_stage || 1}`,
            badgeColor: "bg-emerald-950 border border-emerald-500/40 text-emerald-300 animate-pulse",
            icon: (
              <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
            ),
          },
        ]
      : [
          {
            id: "active" as MainNavigationArea,
            label: "Start New Call",
            icon: (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            ),
          },
        ]),
  ];

  const handleNavClick = (id: MainNavigationArea) => {
    onViewChange(id);
    setMobileMenuOpen(false);
  };

  return (
    <>
      {/* ── Mobile Top Bar ── */}
      <div className="lg:hidden sticky top-0 z-40 border-b border-[#233554] bg-[#0b132b] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <img
            src="/logo.svg"
            alt="CallFlow Brand Logo"
            className="h-8 w-8 rounded-lg shadow-sm shadow-[#0062ff]/30"
          />
          <div>
            <div className="flex items-baseline space-x-1.5">
              <span className="text-base font-bold text-white">CallFlow</span>
            </div>
          </div>
        </div>


        <div className="flex items-center space-x-2">
          {hasLiveCall && (
            <button
              onClick={() => handleNavClick("active")}
              className="flex items-center space-x-1.5 rounded border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1 text-xs text-emerald-300 font-semibold animate-pulse"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Live Call</span>
            </button>
          )}

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="rounded p-1.5 text-slate-300 hover:bg-[#101c3d] hover:text-white"
            aria-label="Toggle navigation menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* ── Mobile Menu Dropdown ── */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-b border-[#233554] bg-[#0e1738] p-3 space-y-1 z-30">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-[#0062ff] text-white font-semibold"
                    : "text-slate-300 hover:bg-[#101c3d] hover:text-white"
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${isActive ? "bg-white/20 text-white" : item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

        </div>
      )}

      {/* ── Desktop Persistent Sidebar ── */}
      <aside className={`hidden lg:flex ${collapsed ? "w-16" : "w-64"} flex-col shrink-0 border-r border-[#233554] bg-[#0b132b] select-none min-h-screen transition-[width] duration-200`}>
        {/* Brand identity */}
        <div className={`relative p-3 border-b border-[#233554]/70 ${collapsed ? "flex justify-center" : "p-5"}`}>
          <div className={`flex items-center ${collapsed ? "justify-center" : "space-x-3"}`}>
            <img
              src="/logo.svg"
              alt="CallFlow Brand Logo"
              className="h-9 w-9 rounded-lg shadow-md shadow-[#0062ff]/30"
            />
            {!collapsed && <div>
              <div className="flex items-baseline space-x-1.5">
                <span className="text-lg font-bold tracking-tight text-white">CallFlow</span>
              </div>
              <p className="text-[11px] text-slate-400">Sales Workflow Assistant</p>
            </div>}
          </div>
          <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} className={`mt-3 rounded p-1.5 text-slate-400 hover:bg-[#101c3d] hover:text-white ${collapsed ? "mt-2" : "absolute right-3 top-3"}`}>
            <svg className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
        </div>

        {/* Primary navigation areas */}
        <nav className={`flex-1 ${collapsed ? "px-2" : "px-3"} py-4 space-y-1`}>
          {!collapsed && <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Workspace
          </div>}

          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                title={collapsed ? item.label : undefined}
                className={`flex w-full items-center ${collapsed ? "justify-center px-2" : "justify-between px-3"} rounded-lg py-2 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-[#0062ff] text-white font-semibold shadow-sm shadow-[#0062ff]/20"
                    : "text-slate-300 hover:bg-[#101c3d] hover:text-white"
                }`}
              >
                <div className={`flex items-center ${collapsed ? "justify-center" : "space-x-2.5"}`}>
                  <span className={isActive ? "text-white" : "text-slate-400"}>
                    {item.icon}
                  </span>
                  {!collapsed && <span>{item.label}</span>}
                </div>
                {!collapsed && item.badge !== undefined && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                      isActive ? "bg-white/20 text-white" : item.badgeColor
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
};

