"use client";

import React, { useState } from "react";
import { CreateCallPayload } from "@/types";

interface StartCallPanelProps {
  onStartCall: (payload: CreateCallPayload) => void;
  isLoading?: boolean;
}

export const StartCallPanel: React.FC<StartCallPanelProps> = ({
  onStartCall,
  isLoading = false,
}) => {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [context, setContext] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("Please provide a company or prospect organization name.");
      return;
    }
    setError(null);
    onStartCall({
      company_name: companyName.trim(),
      contact_name: contactName.trim() || undefined,
      phone_number: phoneNumber.trim() || undefined,
      context: context.trim() || undefined,
    });
  };

  const handleQuickFill = (
    sampleCompany: string,
    sampleContact: string,
    samplePhone: string,
    sampleCtx: string
  ) => {
    setCompanyName(sampleCompany);
    setContactName(sampleContact);
    setPhoneNumber(samplePhone);
    setContext(sampleCtx);
    setError(null);
  };

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-[#233554] bg-[#0b132b] p-6 shadow-xl">
      <div className="mb-5 border-b border-[#233554] pb-4">
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#0062ff]">
          New Cold Call
        </span>
        <h2 className="mt-1 text-xl font-bold text-white">
          Enter Prospect Information
        </h2>
        <p className="mt-1 text-xs text-slate-300">
          Enter the prospect organization to begin the guided 8-stage cold call workflow.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded border border-rose-500/50 bg-rose-950/40 p-2.5 text-xs text-rose-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-200">
            Prospect / Company Name <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g., Kalpana Chem Supplies, Orbit Automation"
            className="w-full rounded border border-[#233554] bg-[#070d1e] px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-200">
              Contact Name <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g., Dev Sharma (Director)"
              className="w-full rounded border border-[#233554] bg-[#070d1e] px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-200">
              Phone Number <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="e.g., +91 98765 43210"
              className="w-full rounded border border-[#233554] bg-[#070d1e] px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-200">
            Lead Context / Background <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
          </label>
          <input
            type="text"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g., Downloaded growth benchmark report yesterday"
            className="w-full rounded border border-[#233554] bg-[#070d1e] px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
          />
        </div>

        {/* Quick sample chips */}
        <div className="pt-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Quick Fill Demo Prospect:
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() =>
                handleQuickFill(
                  "Kalpana Chem Supplies",
                  "Dev Sharma (Director)",
                  "+91 98450 12345",
                  "Shared growth analysis report 3 days ago"
                )
              }
              className="rounded border border-[#233554] bg-[#101c3d] px-2 py-1 text-[11px] text-slate-300 hover:border-slate-400 hover:text-white"
            >
              + Kalpana Chem
            </button>
            <button
              type="button"
              onClick={() =>
                handleQuickFill(
                  "Alloy Research Labs",
                  "Mr. Narayan (Founder)",
                  "+91 98200 98765",
                  "Chemical manufacturer looking for new products"
                )
              }
              className="rounded border border-[#233554] bg-[#101c3d] px-2 py-1 text-[11px] text-slate-300 hover:border-slate-400 hover:text-white"
            >
              + Alloy Research Labs
            </button>
            <button
              type="button"
              onClick={() =>
                handleQuickFill(
                  "Stellar Systems",
                  "Anita Roy (VP Sales)",
                  "+91 99112 33445",
                  "Outbound lead list #4"
                )
              }
              className="rounded border border-[#233554] bg-[#101c3d] px-2 py-1 text-[11px] text-slate-300 hover:border-slate-400 hover:text-white"
            >
              + Stellar Systems
            </button>
          </div>
        </div>

        <div className="pt-3">
          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center space-x-2 rounded bg-[#0062ff] px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-[#0062ff]/30 transition-all hover:bg-[#0052d9] disabled:opacity-60"
          >
            {isLoading ? (
              <span>Starting Call...</span>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a11.042 11.042 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                <span>Start Call</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
