"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { CreateCallPayload, Prospect } from "@/types";
import { api } from "@/lib/api";

interface StartCallPanelProps {
  onStartCall: (payload: CreateCallPayload) => void;
  isLoading?: boolean;
  initialProspect?: Prospect | null;
  initialBriefing?: string | null;
}

export const StartCallPanel: React.FC<StartCallPanelProps> = ({
  onStartCall,
  isLoading = false,
  initialProspect = null,
  initialBriefing = null,
}) => {
  // Single form fields used for selecting, modifying, and creating prospects
  const [companyName, setCompanyName] = useState(initialProspect?.company_name || "");
  const [contactName, setContactName] = useState(initialProspect?.contact_name || "");
  const [phoneNumber, setPhoneNumber] = useState(initialProspect?.phone_number || "");
  const [context, setContext] = useState(initialProspect?.context || "");

  // Directory and selection state
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [isLoadingProspects, setIsLoadingProspects] = useState(false);
  const [prospectsError, setProspectsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialProspect?.company_name || "");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(initialProspect?.id || null);

  useEffect(() => {
    if (initialProspect) {
      setSelectedProspectId(initialProspect.id);
      setCompanyName(initialProspect.company_name);
      setContactName(initialProspect.contact_name || "");
      setPhoneNumber(initialProspect.phone_number || "");
      setContext(initialProspect.context || "");
      setSearchQuery(initialProspect.company_name);
    }
  }, [initialProspect]);

  // Saving as new prospect state & feedback
  const [isSavingProspect, setIsSavingProspect] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load prospects from API
  const loadProspects = useCallback(async () => {
    setIsLoadingProspects(true);
    setProspectsError(null);
    try {
      const data = await api.listProspects();
      setProspects(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load prospects.";
      console.error("Failed to load prospects:", err);
      setProspectsError(msg);
    } finally {
      setIsLoadingProspects(false);
    }
  }, []);

  // Fetch prospects on initial mount
  useEffect(() => {
    loadProspects();
  }, [loadProspects]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter prospects based on search query
  const filteredProspects = useMemo(() => {
    if (!searchQuery.trim()) {
      return prospects;
    }
    const q = searchQuery.toLowerCase().trim();
    return prospects.filter((p) => {
      const matchComp = p.company_name.toLowerCase().includes(q);
      const matchContact = p.contact_name ? p.contact_name.toLowerCase().includes(q) : false;
      const matchPhone = p.phone_number ? p.phone_number.toLowerCase().includes(q) : false;
      const matchCtx = p.context ? p.context.toLowerCase().includes(q) : false;
      return matchComp || matchContact || matchPhone || matchCtx;
    });
  }, [prospects, searchQuery]);

  // Handle selecting a prospect from the dropdown
  const handleSelectProspect = (p: Prospect) => {
    setSelectedProspectId(p.id);
    setCompanyName(p.company_name);
    setContactName(p.contact_name || "");
    setPhoneNumber(p.phone_number || "");
    setContext(p.context || "");
    setSearchQuery(p.company_name);
    setIsDropdownOpen(false);
    setFormError(null);
    setSaveSuccessMessage(null);
  };

  // Handle resetting the form to enter a completely new prospect
  const handleClearForm = () => {
    setSelectedProspectId(null);
    setCompanyName("");
    setContactName("");
    setPhoneNumber("");
    setContext("");
    setSearchQuery("");
    setFormError(null);
    setSaveSuccessMessage(null);
  };

  // Handle saving the current form values as a new prospect
  const handleSaveAsNewProspect = async () => {
    setFormError(null);
    setSaveSuccessMessage(null);

    const comp = companyName.trim();
    if (!comp) {
      setFormError("Please enter a prospect / company name to save.");
      return;
    }

    // Check duplicate against currently loaded directory
    const existing = prospects.find(
      (p) => p.company_name.trim().toLowerCase() === comp.toLowerCase()
    );
    if (existing) {
      setFormError(`A prospect with the company name "${comp}" already exists in the directory.`);
      return;
    }

    setIsSavingProspect(true);
    try {
      const created = await api.createProspect({
        company_name: comp,
        contact_name: contactName.trim() || undefined,
        phone_number: phoneNumber.trim() || undefined,
        context: context.trim() || undefined,
      });

      // Refresh directory from backend and Supabase
      const updatedList = await api.listProspects();
      setProspects(Array.isArray(updatedList) ? updatedList : [created, ...prospects]);

      // Select newly saved prospect
      setSelectedProspectId(created.id);
      setSearchQuery(created.company_name);
      setSaveSuccessMessage(`"${created.company_name}" has been saved to the directory! You can start the call now.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save new prospect.";
      setFormError(msg);
    } finally {
      setIsSavingProspect(false);
    }
  };

  // Handle starting the call
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setFormError("Please provide a company or prospect organization name.");
      return;
    }
    setFormError(null);
    onStartCall({
      company_name: companyName.trim(),
      contact_name: contactName.trim() || undefined,
      phone_number: phoneNumber.trim() || undefined,
      context: context.trim() || undefined,
    });
  };

  const isSelectedFromDirectory = Boolean(selectedProspectId);

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-[#233554] bg-[#0b132b] p-6 shadow-xl">
      <div className="mb-5 border-b border-[#233554] pb-4">
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#0062ff]">
          New Cold Call
        </span>
        <h2 className="mt-1 text-xl font-bold text-white">
          Select or Enter Prospect
        </h2>
        <p className="mt-1 text-xs text-slate-300">
          Search from existing prospects or enter prospect details below to begin the guided 8-stage cold call workflow.
        </p>
      </div>

      {/* Compact Previous Conversation Briefing */}
      {initialBriefing && (
        <div className="mb-4 rounded-lg border border-[#0062ff]/40 bg-[#0062ff]/10 p-3 text-xs text-slate-200 space-y-1">
          <div className="flex items-center space-x-1.5 font-bold uppercase tracking-wider text-[#60a5fa] text-[10px]">
            <span>✦</span>
            <span>Previous Conversation Briefing</span>
          </div>
          <p className="leading-relaxed">{initialBriefing}</p>
        </div>
      )}

      {/* Error alert banner */}
      {formError && (
        <div className="mb-4 rounded border border-rose-500/50 bg-rose-950/40 p-3 text-xs text-rose-300 flex items-start justify-between">
          <span>{formError}</span>
          <button
            type="button"
            onClick={() => setFormError(null)}
            className="ml-2 text-rose-400 hover:text-rose-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Success notification banner */}
      {saveSuccessMessage && (
        <div className="mb-4 rounded border border-emerald-500/50 bg-emerald-950/40 p-3 text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{saveSuccessMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessMessage(null)}
            className="ml-2 text-emerald-400 hover:text-emerald-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Searchable Prospect Directory Dropdown */}
      <div className="mb-5" ref={dropdownRef}>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-200 flex items-center space-x-2">
            <span>Prospect Directory</span>
            {isLoadingProspects ? (
              <span className="text-[11px] font-normal text-slate-400 animate-pulse">
                (Loading...)
              </span>
            ) : prospectsError ? (
              <span className="text-[11px] font-normal text-rose-400">
                (Error loading)
              </span>
            ) : (
              <span className="text-[11px] font-normal text-[#3884ff]">
                ({prospects.length} Available)
              </span>
            )}
          </label>

          {(companyName || selectedProspectId) && (
            <button
              type="button"
              onClick={handleClearForm}
              className="text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              Clear Form
            </button>
          )}
        </div>

        {/* Directory error banner with retry button */}
        {prospectsError && (
          <div className="mb-2 rounded border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-300 flex items-center justify-between">
            <span>Unable to load directory: {prospectsError}</span>
            <button
              type="button"
              onClick={loadProspects}
              className="rounded bg-rose-800/80 px-2 py-0.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        <div className="relative">
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-3 text-slate-400">
              {isLoadingProspects ? (
                <svg className="h-4 w-4 animate-spin text-[#0062ff]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </span>
            <input
              type="text"
              role="combobox"
              aria-expanded={isDropdownOpen}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              placeholder={
                isLoadingProspects
                  ? "Loading prospects from directory..."
                  : prospects.length > 0
                  ? `Search ${prospects.length} prospects by company, contact, or context...`
                  : "Search prospects by company, contact, or context..."
              }
              className="w-full rounded border border-[#233554] bg-[#070d1e] pl-9 pr-8 py-2 text-sm text-white placeholder-slate-400 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                }}
                className="absolute right-2.5 text-xs text-slate-400 hover:text-white"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Search Dropdown list */}
          {isDropdownOpen && (
            <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[#233554] bg-[#0e1738] py-1 shadow-2xl">
              {isLoadingProspects ? (
                <div className="flex items-center justify-center space-x-2 p-4 text-xs text-slate-300">
                  <svg className="h-4 w-4 animate-spin text-[#0062ff]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Loading prospects directory...</span>
                </div>
              ) : prospectsError ? (
                <div className="p-4 text-center text-xs text-rose-300">
                  <p>Failed to load prospects from server.</p>
                  <button
                    type="button"
                    onClick={loadProspects}
                    className="mt-2 rounded bg-rose-800/80 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    Retry loading
                  </button>
                </div>
              ) : filteredProspects.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-300">
                  {searchQuery.trim() ? (
                    <>
                      <p>No matching prospects found for &ldquo;{searchQuery}&rdquo;.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setCompanyName(searchQuery);
                          setSelectedProspectId(null);
                          setIsDropdownOpen(false);
                          setSaveSuccessMessage(null);
                        }}
                        className="mt-2 inline-flex items-center space-x-1 rounded bg-[#0062ff]/20 px-3 py-1.5 text-xs font-semibold text-[#3884ff] hover:bg-[#0062ff]/30 border border-[#0062ff]/40 transition-colors"
                      >
                        <span>Use &ldquo;{searchQuery}&rdquo; in form below</span>
                      </button>
                    </>
                  ) : (
                    <p className="text-slate-400">Directory is empty. Enter details below to add prospects.</p>
                  )}
                </div>
              ) : (
                filteredProspects.map((p) => {
                  const isSelected = p.id === selectedProspectId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProspect(p)}
                      className={`w-full px-3 py-2 text-left transition-colors border-b border-[#1c294d]/50 last:border-b-0 hover:bg-[#1a2850] ${
                        isSelected ? "bg-[#0062ff]/20 text-white" : "text-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-white">
                          {p.company_name}
                        </span>
                        {p.is_custom && (
                          <span className="rounded bg-indigo-900/60 border border-indigo-500/40 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-300 uppercase">
                            Custom
                          </span>
                        )}
                      </div>
                      {(p.contact_name || p.phone_number) && (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-300">
                          {p.contact_name && <span>{p.contact_name}</span>}
                          {p.phone_number && (
                            <span className="text-slate-400 font-mono">({p.phone_number})</span>
                          )}
                        </div>
                      )}
                      {p.context && (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400 italic">
                          {p.context}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Single Prospect Form (Used for both selecting and adding prospects) */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-200">
              Prospect / Company Name <span className="text-rose-400">*</span>
            </label>
            {isSelectedFromDirectory && (
              <span className="rounded bg-[#0062ff]/20 border border-[#0062ff]/40 px-2 py-0.5 text-[10px] font-medium text-[#3884ff]">
                Selected from Directory
              </span>
            )}
          </div>
          <input
            type="text"
            required
            value={companyName}
            onChange={(e) => {
              setCompanyName(e.target.value);
              // If user manually changes name from selected, unbind prospect id
              if (selectedProspectId) {
                const cur = prospects.find((p) => p.id === selectedProspectId);
                if (cur && cur.company_name.trim().toLowerCase() !== e.target.value.trim().toLowerCase()) {
                  setSelectedProspectId(null);
                }
              }
            }}
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

        {/* Action Buttons: Save as New Prospect & Start Call */}
        <div className="pt-3 flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3">
          <button
            type="button"
            onClick={handleSaveAsNewProspect}
            disabled={isSavingProspect || isLoading}
            className="flex items-center justify-center space-x-2 rounded border border-emerald-500/50 bg-emerald-950/30 px-4 py-2.5 text-xs sm:text-sm font-semibold text-emerald-300 shadow hover:bg-emerald-900/50 hover:border-emerald-500 transition-all disabled:opacity-50"
            title="Save these details as a new prospect in the directory and Supabase"
          >
            {isSavingProspect ? (
              <>
                <svg className="h-4 w-4 animate-spin text-emerald-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Saving Prospect...</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                  />
                </svg>
                <span>Save as New Prospect</span>
              </>
            )}
          </button>

          <button
            type="submit"
            disabled={isLoading || isSavingProspect}
            className="flex flex-1 items-center justify-center space-x-2 rounded bg-[#0062ff] px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md shadow-[#0062ff]/30 transition-all hover:bg-[#0052d9] disabled:opacity-60"
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
