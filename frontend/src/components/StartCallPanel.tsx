"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { CreateCallPayload, Prospect } from "@/types";
import { api } from "@/lib/api";

interface StartCallPanelProps {
  onStartCall: (payload: CreateCallPayload) => void;
  isLoading?: boolean;
}

export const StartCallPanel: React.FC<StartCallPanelProps> = ({
  onStartCall,
  isLoading = false,
}) => {
  // Form fields
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [context, setContext] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Prospects list & dropdown state
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [isLoadingProspects, setIsLoadingProspects] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null);

  // Add new prospect modal/form state
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newContext, setNewContext] = useState("");
  const [isSavingNew, setIsSavingNew] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load prospects on mount
  useEffect(() => {
    let isMounted = true;
    setIsLoadingProspects(true);
    api.listProspects()
      .then((data) => {
        if (isMounted) {
          setProspects(data);
        }
      })
      .catch((err) => {
        console.error("Failed to load prospects:", err);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingProspects(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

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
    setError(null);
  };

  // Handle saving new prospect
  const handleCreateProspect = async (e: React.FormEvent) => {
    e.preventDefault();
    const comp = newCompany.trim();
    if (!comp) {
      setAddError("Please provide a company or organization name.");
      return;
    }

    // Client-side duplicate check
    const isDuplicate = prospects.some(
      (p) => p.company_name.trim().toLowerCase() === comp.toLowerCase()
    );
    if (isDuplicate) {
      setAddError(`A prospect with the company name "${comp}" already exists.`);
      return;
    }

    setAddError(null);
    setIsSavingNew(true);

    try {
      const created = await api.createProspect({
        company_name: comp,
        contact_name: newContact.trim() || undefined,
        phone_number: newPhone.trim() || undefined,
        context: newContext.trim() || undefined,
      });

      // Update state and list
      setProspects((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      handleSelectProspect(created);

      // Reset modal fields
      setNewCompany("");
      setNewContact("");
      setNewPhone("");
      setNewContext("");
      setIsAddingNew(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create prospect.";
      setAddError(msg);
    } finally {
      setIsSavingNew(false);
    }
  };

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
          Search from 100 existing prospects or add a new prospect to begin the guided 8-stage cold call workflow.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded border border-rose-500/50 bg-rose-950/40 p-2.5 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Searchable Prospect Dropdown */}
      <div className="mb-5" ref={dropdownRef}>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-200">
            Prospect Directory ({prospects.length} Available)
          </label>
          <button
            type="button"
            onClick={() => {
              setAddError(null);
              setIsAddingNew(!isAddingNew);
            }}
            className="flex items-center space-x-1 text-xs font-medium text-[#0062ff] hover:text-[#3884ff] transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>{isAddingNew ? "Close Add Form" : "Add New Prospect"}</span>
          </button>
        </div>

        <div className="relative">
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-3 text-slate-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
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
              placeholder={isLoadingProspects ? "Loading 100 prospects..." : "Search prospects by company, contact, or industry..."}
              className="w-full rounded border border-[#233554] bg-[#070d1e] pl-9 pr-8 py-2 text-sm text-white placeholder-slate-400 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedProspectId(null);
                }}
                className="absolute right-2.5 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* Dropdown menu */}
          {isDropdownOpen && (
            <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[#233554] bg-[#0e1738] py-1 shadow-2xl">
              {isLoadingProspects ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  Loading prospects...
                </div>
              ) : filteredProspects.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  <p>No matching prospects found for &ldquo;{searchQuery}&rdquo;.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCompany(searchQuery);
                      setIsAddingNew(true);
                      setIsDropdownOpen(false);
                    }}
                    className="mt-2 inline-block rounded bg-[#0062ff]/20 px-2.5 py-1 text-xs font-semibold text-[#0062ff] hover:bg-[#0062ff]/30"
                  >
                    + Add as New Prospect
                  </button>
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
                          {p.phone_number && <span className="text-slate-400 font-mono">({p.phone_number})</span>}
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

      {/* Add New Prospect Accordion/Form */}
      {isAddingNew && (
        <div className="mb-5 rounded border border-[#233554] bg-[#070d1e] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Add New Prospect to Directory
            </h3>
            <button
              type="button"
              onClick={() => setIsAddingNew(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              ✕ Cancel
            </button>
          </div>

          {addError && (
            <div className="mb-3 rounded border border-rose-500/50 bg-rose-950/40 p-2 text-xs text-rose-300">
              {addError}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-200">
                Company Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                placeholder="e.g., Zenith BioTech Ltd"
                className="w-full rounded border border-[#233554] bg-[#0b132b] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-200">
                  Contact Name & Role
                </label>
                <input
                  type="text"
                  value={newContact}
                  onChange={(e) => setNewContact(e.target.value)}
                  placeholder="e.g., Vikram Roy (Founder)"
                  className="w-full rounded border border-[#233554] bg-[#0b132b] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-200">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="e.g., +91 98111 22334"
                  className="w-full rounded border border-[#233554] bg-[#0b132b] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-200">
                Background / Lead Context
              </label>
              <input
                type="text"
                value={newContext}
                onChange={(e) => setNewContext(e.target.value)}
                placeholder="e.g., Inbound inquiry via webinar on enterprise growth"
                className="w-full rounded border border-[#233554] bg-[#0b132b] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#0062ff] focus:outline-none focus:ring-1 focus:ring-[#0062ff]"
              />
            </div>

            <div className="pt-1 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setIsAddingNew(false)}
                className="rounded border border-[#233554] px-3 py-1.5 text-xs text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateProspect}
                disabled={isSavingNew}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500 disabled:opacity-50"
              >
                {isSavingNew ? "Saving..." : "Save Prospect & Auto-Fill"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cold Call Initiation Form */}
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
