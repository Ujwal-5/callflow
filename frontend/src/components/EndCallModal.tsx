"use client";

import React, { useState } from "react";
import { CloseCallPayload, Call } from "@/types";

interface EndCallModalProps {
  isOpen: boolean;
  call: Call;
  currentStageNumber: number;
  currentStageName: string;
  onClose: () => void;
  onConfirmEnd: (payload: CloseCallPayload) => void;
  isSubmitting?: boolean;
}

const FINAL_OUTCOMES = [
  "Interested; follow-up agreed",
  "Information requested",
  "Callback requested",
  "Referred to another person",
  "Not interested",
  "Wrong contact or number",
  "Call ended unexpectedly",
  "Other",
];

const CHANNELS = ["WhatsApp", "Email", "Phone Call", "Google Meet / Zoom", "In Person"];

export const EndCallModal: React.FC<EndCallModalProps> = ({
  isOpen,
  call,
  currentStageNumber,
  currentStageName,
  onClose,
  onConfirmEnd,
  isSubmitting = false,
}) => {
  const [outcome, setOutcome] = useState<string>("Interested; follow-up agreed");
  const [nextAction, setNextAction] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [followUpChannel, setFollowUpChannel] = useState("WhatsApp");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) {
      setValidationError("Please select a final call outcome.");
      return;
    }
    setValidationError(null);
    onConfirmEnd({
      final_outcome: outcome,
      next_action: nextAction.trim() || undefined,
      follow_up_time: followUpTime.trim() || undefined,
      follow_up_channel: followUpChannel || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-lg border border-[#233554] bg-[#0b132b] shadow-2xl">
        {/* Header */}
        <div className="border-b border-[#233554] bg-[#101c3d] px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-rose-400">
              Wrap Up Call
            </span>
            <span className="rounded bg-[#233554] px-2 py-0.5 text-[10px] font-mono text-slate-300">
              Ending at Stage {currentStageNumber}: {currentStageName}
            </span>
          </div>
          <h3 className="mt-1 text-lg font-bold text-white">
            Complete Call with {call.company_name}
          </h3>
          {call.contact_name && (
            <p className="text-xs text-slate-300">
              Spoke with: {call.contact_name}
            </p>
          )}
        </div>

        {validationError && (
          <div className="mx-5 mt-4 rounded border border-rose-500/50 bg-rose-950/40 p-2 text-xs text-rose-300">
            {validationError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Final outcome options */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300">
              Final Call Outcome <span className="text-rose-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {FINAL_OUTCOMES.map((opt) => {
                const isSelected = outcome === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setOutcome(opt)}
                    className={`rounded border px-2.5 py-2 text-left text-xs font-medium transition-all ${
                      isSelected
                        ? "border-[#0062ff] bg-[#0062ff]/20 text-white ring-1 ring-[#0062ff]"
                        : "border-[#233554] bg-[#070d1e] text-slate-300 hover:border-slate-500 hover:text-white"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Next action */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-200">
              Next Action / Commitment <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="e.g., Send teardown report, schedule discovery with founder"
              className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none"
            />
          </div>

          {/* Follow-up timing & channel */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-200">
                Follow-up Timing <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={followUpTime}
                onChange={(e) => setFollowUpTime(e.target.value)}
                placeholder="e.g., Next Tuesday 2:30 PM"
                className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-200">
                Channel
              </label>
              <select
                value={followUpChannel}
                onChange={(e) => setFollowUpChannel(e.target.value)}
                className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-xs text-white focus:border-[#0062ff] focus:outline-none"
              >
                {CHANNELS.map((ch) => (
                  <option key={ch} value={ch} className="bg-[#0b132b] text-white">
                    {ch}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#233554]">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="rounded border border-[#233554] px-4 py-2 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-white"
            >
              Cancel & Continue Call
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow transition-all disabled:opacity-60"
            >
              {isSubmitting ? "Saving Outcome..." : "Confirm & Close Call"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
