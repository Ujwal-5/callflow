"use client";

import React, { useEffect, useRef, useState } from "react";

export type ServiceStatus = "online" | "sleeping" | "waking";

interface ServiceStatusBannerProps {
  status: ServiceStatus;
  keepAliveEnabled: boolean;
  /** Seconds elapsed since the wake request was sent */
  wakingElapsed: number;
}

/**
 * ServiceStatusBanner
 *
 * A professional, user-friendly banner that communicates the Render
 * backend's current availability without exposing internal technical details.
 *
 * States:
 *  - sleeping  → service is unreachable; show a gentle notice
 *  - waking    → wake request sent; show animated progress + elapsed time
 *  - online    → service responded; status messaging remains visible
 */
export const ServiceStatusBanner: React.FC<ServiceStatusBannerProps> = ({
  status,
  keepAliveEnabled,
  wakingElapsed,
}) => {
  // Brief "just came online" confirmation state
  const [showOnlineConfirm, setShowOnlineConfirm] = useState(false);
  const prevStatus = useRef<ServiceStatus>(status);
  const confirmTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (prevStatus.current !== "online" && status === "online") {
      setShowOnlineConfirm(true);
      confirmTimerRef.current = setTimeout(() => {
        setShowOnlineConfirm(false);
      }, 4000);
    }
    prevStatus.current = status;
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, [status]);

  // ── Online confirmation (briefly shown after waking up) ──────────────────
  if (status === "online" && showOnlineConfirm) {
    return (
      <div className="border-b border-emerald-500/20 bg-emerald-950/30 px-4 py-2.5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
            <svg
              className="h-3 w-3 text-emerald-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <p className="text-xs font-medium text-emerald-300">
            Service is ready. You&apos;re good to go.
          </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Service is waking up ─────────────────────────────────────────────────
  if (status === "waking") {
    const minutes = Math.floor(wakingElapsed / 60);
    const seconds = wakingElapsed % 60;
    const elapsed =
      minutes > 0
        ? `${minutes}m ${seconds}s`
        : `${seconds}s`;

    // Progress fills over ~45 seconds (typical Render cold-start)
    const progressPct = Math.min(100, (wakingElapsed / 45) * 100);

    return (
      <div className="border-b border-amber-500/20 bg-amber-950/20 px-4 py-3">
        <div className="mx-auto max-w-6xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {/* Animated spinner */}
              <div className="relative h-5 w-5 shrink-0">
                <div className="absolute inset-0 rounded-full border-2 border-amber-500/20" />
                <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-amber-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-amber-200">
                  Starting up the service…
                </p>
                <p className="text-[11px] text-amber-400/70">
                  This usually takes 20–60 seconds on first use.
                </p>
              </div>
            </div>
            <span className="font-mono text-[11px] text-amber-400/60 tabular-nums">
              {elapsed}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-amber-950/60">
            <div
              className="h-full rounded-full bg-amber-400/50 transition-all duration-1000 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Service is online ───────────────────────────────────────────────────
  if (status === "online") {
    return (
      <div className="border-b border-slate-700/60 bg-[#0b1327] px-4 py-2">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <p className="text-[11px] text-slate-400">
            {keepAliveEnabled
              ? "Render is running and will be kept awake while this page is open."
              : "Render is running. Stop it when you are done; it will sleep after inactivity."}
          </p>
        </div>
      </div>
    );
  }

  // ── Service is sleeping ──────────────────────────────────────────────────
  return (
    <div className="border-b border-slate-700/60 bg-[#0b1327] px-4 py-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          {/* Moon / sleep icon */}
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-[#101c3d]">
            <svg
              className="h-3.5 w-3.5 text-slate-400"
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
            <p className="text-xs font-semibold text-slate-200">
              Service is currently inactive
            </p>
            <p className="text-[11px] text-slate-400">
              The assistant goes to sleep after periods of inactivity to save resources.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
