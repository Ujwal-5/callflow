"use client";

import React, { useState, useEffect } from "react";
import { CloseCallPayload, Call, Commitment, MissedOpportunity } from "@/types";
import { api } from "@/lib/api";

interface EndCallModalProps {
  isOpen: boolean;
  call: Call;
  currentStageNumber: number;
  currentStageName: string;
  initialOutcome?: string;
  onClose: () => void;
  onConfirmEnd: (payload: CloseCallPayload) => void;
  isSubmitting?: boolean;
}

const FINAL_OUTCOMES = [
  "Interested; follow-up agreed",
  "Callback requested",
  "Referred to another person",
  "Information requested",
  "Not interested",
  "Wrong contact or number",
  "Call ended unexpectedly",
  "Other",
];

const CHANNELS = ["WhatsApp", "Phone Call", "Email", "Google Meet / Zoom", "In Person"];

export const EndCallModal: React.FC<EndCallModalProps> = ({
  isOpen,
  call,
  currentStageNumber,
  currentStageName,
  initialOutcome,
  onClose,
  onConfirmEnd,
  isSubmitting = false,
}) => {
  const [outcome, setOutcome] = useState<string>(
    initialOutcome || "Interested; follow-up agreed"
  );
  const [nextAction, setNextAction] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [followUpChannel, setFollowUpChannel] = useState("WhatsApp");
  const [referralName, setReferralName] = useState(call.referral_name || "");
  const [referralContact, setReferralContact] = useState(call.referral_contact || "");
  const [objection, setObjection] = useState(call.objection || "");
  const [prospectStatement, setProspectStatement] = useState(call.prospect_statement || "");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Radar review state
  const [radarCommitments, setRadarCommitments] = useState<Commitment[]>([]);
  const [radarOpps, setRadarOpps] = useState<MissedOpportunity[]>([]);
  const [_isLoadingRadar, setIsLoadingRadar] = useState(false);

  // When initialOutcome prop changes, update outcome state
  useEffect(() => {
    if (initialOutcome) {
      setOutcome(initialOutcome);
    }
  }, [initialOutcome]);

  // Pre-fill prospect statements from stage results if not already set
  useEffect(() => {
    if (isOpen && call?.stage_results) {
      const s5 = call.stage_results.find((s) => s.stage_number === 5);
      const anyVerbatim = call.stage_results.find((s) => s.prospect_exact_words && s.prospect_exact_words.trim());
      const verbatim = s5?.prospect_exact_words || anyVerbatim?.prospect_exact_words;
      if (verbatim && !prospectStatement) {
        setProspectStatement(verbatim);
      }
    }
  }, [isOpen, call, prospectStatement]);

  useEffect(() => {
    if (isOpen && call?.id) {
      setIsLoadingRadar(true);
      api.getRadar(call.id)
        .then((res) => {
          setRadarCommitments(res.commitments || []);
          setRadarOpps(res.missed_opportunities || []);

          // If there is an explicitly agreed or requested commitment, pre-fill if nextAction is empty
          const topComm = (res.commitments || []).find(
            (c) => c.status === "confirmed" || c.commitment_status === "explicitly_agreed" || c.commitment_status === "requested"
          );
          if (topComm) {
            setNextAction((prev) => prev || topComm.action);
            if (topComm.relative_due) {
              setFollowUpTime((prev) => prev || topComm.relative_due || "");
            }
            if (topComm.channel && topComm.channel !== "unknown") {
              const matchedChannel = CHANNELS.find((ch) =>
                ch.toLowerCase().includes(topComm.channel.toLowerCase())
              );
              if (matchedChannel) {
                setFollowUpChannel(matchedChannel);
              }
            }
            if (topComm.commitment_status === "requested") {
              setOutcome((prev) => initialOutcome || prev || "Callback requested");
            } else if (topComm.action.toLowerCase().includes("referral") || topComm.action.toLowerCase().includes("naik")) {
              setOutcome((prev) => initialOutcome || prev || "Referred to another person");
            }
          }
        })
        .catch(() => {})
        .finally(() => setIsLoadingRadar(false));
    }
  }, [isOpen, call?.id, initialOutcome]);

  if (!isOpen) return null;

  const handleApplyCommitment = (comm: Commitment) => {
    setNextAction(comm.action);
    if (comm.relative_due) {
      setFollowUpTime(comm.relative_due);
    }
    if (comm.channel && comm.channel !== "unknown") {
      const match = CHANNELS.find((ch) =>
        ch.toLowerCase().includes(comm.channel.toLowerCase())
      );
      if (match) setFollowUpChannel(match);
    }
    if (comm.commitment_status === "requested" || comm.action.toLowerCase().includes("call")) {
      setOutcome("Callback requested");
    } else if (comm.action.toLowerCase().includes("meet")) {
      setOutcome("Interested; follow-up agreed");
    } else if (comm.action.toLowerCase().includes("whatsapp") || comm.action.toLowerCase().includes("email")) {
      setOutcome("Information requested");
    }
  };

  const handleConfirmCommitment = async (commId: string) => {
    try {
      const updated = await api.updateCommitment(call.id, commId, { status: "confirmed" });
      setRadarCommitments((prev) => prev.map((c) => (c.id === commId ? updated : c)));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDismissCommitment = async (commId: string) => {
    try {
      const updated = await api.updateCommitment(call.id, commId, { status: "dismissed" });
      setRadarCommitments((prev) => prev.map((c) => (c.id === commId ? updated : c)));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDismissOpp = async (oppId: string) => {
    try {
      const updated = await api.updateMissedOpportunity(call.id, oppId, { status: "dismissed" });
      setRadarOpps((prev) => prev.map((o) => (o.id === oppId ? updated : o)));
    } catch (err) {
      console.error(err);
    }
  };

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
      referral_name: referralName.trim() || undefined,
      referral_contact: referralContact.trim() || undefined,
      objection: objection.trim() || undefined,
      prospect_statement: prospectStatement.trim() || undefined,
    });
  };

  const activeRadarCommitments = radarCommitments.filter((c) => c.status !== "dismissed");
  const activeRadarOpps = radarOpps.filter((o) => o.status !== "dismissed");

  const isCallback = outcome === "Callback requested";
  const isReferral = outcome === "Referred to another person";
  const isNotInterested = outcome === "Not interested";
  const isMeeting = outcome === "Interested; follow-up agreed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-lg border border-[#233554] bg-[#0b132b] shadow-2xl">
        {/* Header */}
        <div className="border-b border-[#233554] bg-[#101c3d] px-5 py-3.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-rose-400">
              Wrap Up Call Record
            </span>
            <span className="rounded bg-[#233554] px-2 py-0.5 text-[10px] font-mono text-slate-300">
              Stage {currentStageNumber}: {currentStageName}
            </span>
          </div>
          <h3 className="mt-1 text-base font-bold text-white">
            Complete Session: {call.company_name}
          </h3>
          {call.contact_name && (
            <p className="text-xs text-slate-300">
              Spoke with: {call.contact_name}
            </p>
          )}
        </div>

        {/* Quick Resolution Shortcuts */}
        <div className="border-b border-[#233554] bg-[#070d1e] px-5 py-2.5">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Quick Outcome Presets:
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setOutcome("Callback requested");
                if (!followUpChannel) setFollowUpChannel("Phone Call");
              }}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                isCallback
                  ? "bg-blue-600 text-white ring-1 ring-blue-400"
                  : "bg-blue-950/40 text-blue-300 border border-blue-500/30 hover:bg-blue-900/40"
              }`}
            >
              📞 Busy / Callback
            </button>
            <button
              type="button"
              onClick={() => setOutcome("Not interested")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                isNotInterested
                  ? "bg-rose-700 text-white ring-1 ring-rose-400"
                  : "bg-slate-800/60 text-slate-300 border border-slate-700 hover:bg-slate-700"
              }`}
            >
              🚫 Not Interested
            </button>
            <button
              type="button"
              onClick={() => setOutcome("Interested; follow-up agreed")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                isMeeting
                  ? "bg-emerald-600 text-white ring-1 ring-emerald-400"
                  : "bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-900/40"
              }`}
            >
              📅 Schedule Meeting
            </button>
            <button
              type="button"
              onClick={() => setOutcome("Referred to another person")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                isReferral
                  ? "bg-purple-600 text-white ring-1 ring-purple-400"
                  : "bg-purple-950/40 text-purple-300 border border-purple-500/30 hover:bg-purple-900/40"
              }`}
            >
              👥 Referral
            </button>
            <button
              type="button"
              onClick={() => setOutcome("Information requested")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                outcome === "Information requested"
                  ? "bg-cyan-600 text-white ring-1 ring-cyan-400"
                  : "bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-900/40"
              }`}
            >
              📄 Send Info
            </button>
          </div>
        </div>

        {validationError && (
          <div className="mx-5 mt-3 rounded border border-rose-500/50 bg-rose-950/40 p-2 text-xs text-rose-300">
            {validationError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Commitment Radar Review Step */}
          {(activeRadarCommitments.length > 0 || activeRadarOpps.length > 0) && (
            <div className="rounded-lg border border-indigo-500/30 bg-[#070d1e] p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-[#233554] pb-2">
                <div className="flex items-center space-x-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-950 text-indigo-400 border border-indigo-500/30 text-xs">
                    🎯
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-white">
                    Post-Call Radar Review
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  Review & sync extracted commitments
                </span>
              </div>

              {activeRadarCommitments.length > 0 && (
                <div className="space-y-2">
                  <span className="block text-[11px] font-semibold text-slate-300">
                    Detected Candidate Commitments:
                  </span>
                  {activeRadarCommitments.map((comm) => (
                    <div
                      key={comm.id}
                      className="rounded border border-[#233554] bg-[#0b132b] p-2 text-xs space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-semibold text-white">{comm.action}</span>
                          {comm.relative_due && (
                            <span className="ml-2 font-mono text-[11px] text-[#3b82f6]">
                              ⏰ {comm.relative_due}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-1 shrink-0">
                          {comm.status === "pending" && (
                            <button
                              type="button"
                              onClick={() => handleConfirmCommitment(comm.id)}
                              className="rounded border border-emerald-500/40 bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-900"
                            >
                              ✓ Confirm
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleApplyCommitment(comm)}
                            className="rounded bg-[#0062ff] px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-[#0052d9]"
                            title="Auto-fill final outcome fields"
                          >
                            Apply ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDismissCommitment(comm.id)}
                            className="rounded border border-[#233554] px-1 py-0.5 text-[10px] text-slate-400 hover:text-rose-400"
                            title="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-300 italic">
                        &ldquo;{comm.evidence_quote}&rdquo;
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {activeRadarOpps.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-950/30 p-2 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300 text-[11px] uppercase flex items-center space-x-1">
                      <span>⚠</span>
                      <span>Radar Alert: Possible Missed Opportunity</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDismissOpp(activeRadarOpps[0].id)}
                      className="text-[10px] text-slate-400 hover:text-rose-400"
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="text-slate-200 text-[11px]">
                    {activeRadarOpps[0].description}
                  </p>
                </div>
              )}
            </div>
          )}

          <form id="end-call-form" onSubmit={handleSubmit} className="space-y-3.5">
            {/* Final outcome options grid */}
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300">
                Final Call Outcome <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {FINAL_OUTCOMES.map((opt) => {
                  const isSelected = outcome === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setOutcome(opt)}
                      className={`rounded border px-2 py-1.5 text-left text-xs font-medium transition-all ${
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

            {/* Agreed Next Action */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-200">
                Agreed Next Step / Action
              </label>
              <input
                type="text"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="e.g., Call back after 30 mins, send teardown report on WhatsApp, Google Meet walkthrough"
                className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none"
              />
            </div>

            {/* Follow-up Timing & Channel (Prioritized for Callbacks and Meetings) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-200">
                  {isCallback ? "Callback Time" : "Follow-up Timing"}
                </label>
                <input
                  type="text"
                  value={followUpTime}
                  onChange={(e) => setFollowUpTime(e.target.value)}
                  placeholder={isCallback ? "e.g., In 30 minutes, 4:00 PM today" : "e.g., Next Tuesday 2:30 PM"}
                  className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-200">
                  Communication Channel
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

            {/* Referral Details (Surfaced when referred or filled) */}
            {(isReferral || referralName || referralContact) && (
              <div className="rounded border border-purple-500/30 bg-purple-950/20 p-3 space-y-2">
                <span className="block text-xs font-bold uppercase tracking-wider text-purple-300">
                  👥 Referred Contact Information
                </span>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-300">
                      Referred Person Name
                    </label>
                    <input
                      type="text"
                      value={referralName}
                      onChange={(e) => setReferralName(e.target.value)}
                      placeholder="e.g., Mr. Sunil Naik (VP Engineering)"
                      className="w-full rounded border border-[#233554] bg-[#070d1e] px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-300">
                      Phone / Email / Ext
                    </label>
                    <input
                      type="text"
                      value={referralContact}
                      onChange={(e) => setReferralContact(e.target.value)}
                      placeholder="e.g., +91 98765 43210 or snaik@corp.com"
                      className="w-full rounded border border-[#233554] bg-[#070d1e] px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Objection details (Surfaced when not interested or filled) */}
            {(isNotInterested || objection) && (
              <div className="rounded border border-amber-500/30 bg-amber-950/20 p-3 space-y-2">
                <span className="block text-xs font-bold uppercase tracking-wider text-amber-300">
                  🚫 Objection / Reason for Declining
                </span>
                <input
                  type="text"
                  value={objection}
                  onChange={(e) => setObjection(e.target.value)}
                  placeholder="e.g., Existing agency contract through Q4, no budget, handling internally"
                  className="w-full rounded border border-[#233554] bg-[#070d1e] px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
              </div>
            )}

            {/* Verbatim Prospect Statement */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-200">
                  Prospect&apos;s Statement / Verbatim Quote
                </label>
                <span className="text-[10px] text-slate-400">
                  Preserves authentic prospect words
                </span>
              </div>
              <textarea
                rows={2}
                value={prospectStatement}
                onChange={(e) => setProspectStatement(e.target.value)}
                placeholder='e.g., "Technically there is hardly any margin." or "Call me back after 30 minutes."'
                className="w-full rounded border border-[#233554] bg-[#070d1e] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none leading-relaxed"
              />
            </div>
          </form>
        </div>

        {/* Modal Actions Footer */}
        <div className="flex items-center justify-end space-x-3 p-3.5 border-t border-[#233554] bg-[#101c3d]/60">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded border border-[#233554] px-4 py-2 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-white"
          >
            Cancel & Continue
          </button>
          <button
            type="submit"
            form="end-call-form"
            disabled={isSubmitting}
            className="rounded bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow transition-all disabled:opacity-60"
          >
            {isSubmitting ? "Saving Outcome..." : "Confirm & Close Call"}
          </button>
        </div>
      </div>
    </div>
  );
};
