import {
  StageDefinition,
  Call,
  CreateCallPayload,
  CloseCallPayload,
  StageResult,
  SummaryResponse,
  Transcript,
  Commitment,
  MissedOpportunity,
  HistoricalMatch,
  RadarAnalysisResponse,
  ConversationGap,
  ConversationGapsResponse,
  Prospect,
  CreateProspectPayload,
  StageSuggestion,
  StageAssistRecommendation,
  FollowUpItem,
  UpdateFollowUpPayload,
} from "@/types";


const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export function isBackendSleepingError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    msg.includes("timed out") ||
    msg.includes("aborterror") ||
    msg.includes("service unavailable") ||
    msg.includes("bad gateway") ||
    msg.includes("gateway timeout") ||
    msg.includes("http error 502") ||
    msg.includes("http error 503") ||
    msg.includes("http error 504") ||
    msg.includes("connection refused")
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ApiClient {
  private baseUrl: string;
  private unavailableListeners: Set<() => void> = new Set();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  public onServiceUnavailable(listener: () => void): () => void {
    this.unavailableListeners.add(listener);
    return () => {
      this.unavailableListeners.delete(listener);
    };
  }

  private notifyServiceUnavailable() {
    this.unavailableListeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error("Error notifying unavailable listener:", e);
      }
    });
  }

  /**
   * Verify whether the Render backend is genuinely inactive (sleeping/unreachable).
   * Returns true ONLY if /health cannot be reached or returns gateway sleep status (502/503/504).
   * Returns false if /health is reachable and healthy (service is alive).
   */
  public async isRenderReallyInactive(): Promise<boolean> {
    const url = `${this.baseUrl}/health`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);

      // If /health responded with 200 OK, the service is alive!
      if (res.ok) {
        return false;
      }

      // 502 Bad Gateway / 503 / 504 are Render proxy responses when backend is spinning down/asleep
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        return true;
      }

      // Other status codes (like 500) mean the service is running HTTP
      return false;
    } catch {
      // Network failure, Failed to fetch, Connection Refused, or timeout reaching /health
      return true;
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retries: number = 3,
    delayMs: number = 1500
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      try {
        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Client errors (4xx except 408) are intentional business/validation responses - do NOT retry
          if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            let errorMessage = `HTTP error ${response.status}`;
            try {
              const errData = await response.json();
              if (errData && errData.detail) {
                errorMessage = typeof errData.detail === "string" 
                  ? errData.detail 
                  : JSON.stringify(errData.detail);
              }
            } catch {
              // Non-JSON
            }
            throw new Error(errorMessage);
          }

          // Server errors (500, 502, 503, 504)
          let errorMessage = `HTTP error ${response.status}`;
          try {
            const errData = await response.json();
            if (errData && errData.detail) {
              errorMessage = typeof errData.detail === "string" 
                ? errData.detail 
                : JSON.stringify(errData.detail);
            }
          } catch {
            // Non-JSON
          }

          lastError = new Error(errorMessage);

          // Retry with delay if attempts remain
          if (attempt < retries) {
            await sleep(delayMs);
            continue;
          }

          throw lastError;
        }

        return await response.json();
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        // Do not retry 4xx errors
        if (
          err instanceof Error &&
          err.message.startsWith("HTTP error 4") &&
          !err.message.startsWith("HTTP error 408")
        ) {
          throw err;
        }

        let formattedError: Error;
        if (err instanceof Error) {
          if (err.name === "AbortError") {
            formattedError = new Error("Request timed out. Please check if the backend server is reachable.");
          } else {
            formattedError = err;
          }
        } else {
          formattedError = new Error("An unexpected network error occurred.");
        }

        lastError = formattedError;

        // Retry with delay if attempts remain
        if (attempt < retries) {
          await sleep(delayMs);
          continue;
        }

        throw lastError;
      }
    }

    // All retries failed. Verify if Render is really inactive before triggering sleeping status
    if (endpoint !== "/health") {
      try {
        const reallyInactive = await this.isRenderReallyInactive();
        if (reallyInactive) {
          this.notifyServiceUnavailable();
        }
      } catch {
        // ignore
      }
    }

    throw lastError || new Error("Request failed after retries.");
  }


  async getHealth(options: { retries?: number; delayMs?: number } = {}): Promise<{ status: string; service: string; database_mode: string; gemini_configured: boolean }> {
    const retries = options.retries !== undefined ? options.retries : 3;
    const delayMs = options.delayMs !== undefined ? options.delayMs : 1500;
    return this.request("/health", {}, retries, delayMs);
  }


  async getStages(): Promise<StageDefinition[]> {
    return this.request("/stages");
  }

  async createCall(payload: CreateCallPayload): Promise<Call> {
    return this.request("/calls", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async listCalls(params?: {
    search?: string;
    outcome?: string;
    stage?: number;
    status?: string;
  }): Promise<Call[]> {
    const query = new URLSearchParams();
    if (params?.search) query.set("search", params.search);
    if (params?.outcome) query.set("outcome", params.outcome);
    if (params?.stage) query.set("stage", params.stage.toString());
    if (params?.status) query.set("status", params.status);

    const qs = query.toString();
    return this.request(`/calls${qs ? `?${qs}` : ""}`);
  }

  async getCall(callId: string): Promise<Call> {
    return this.request(`/calls/${callId}`);
  }

  async updateStageResult(
    callId: string,
    stageNumber: number,
    payload: {
      selected_outcome?: string | null;
      prospect_exact_words?: string | null;
      notes?: string | null;
      status?: string | null;
    }
  ): Promise<StageResult> {
    return this.request(`/calls/${callId}/stages/${stageNumber}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async skipStage(
    callId: string,
    stageNumber: number,
    notApplicable: boolean = false
  ): Promise<StageResult> {
    return this.request(`/calls/${callId}/stages/${stageNumber}/skip?not_applicable=${notApplicable}`, {
      method: "POST",
    });
  }

  async getStageSuggestion(
    callId: string,
    transcript?: string,
    currentStage?: number
  ): Promise<StageSuggestion> {
    if (transcript !== undefined || currentStage !== undefined) {
      return this.request(`/calls/${callId}/stage-suggestion`, {
        method: "POST",
        body: JSON.stringify({ transcript, current_stage: currentStage }),
      });
    }
    return this.request(`/calls/${callId}/stage-suggestion`);
  }

  async getStageAssistRecommendation(
    callId: string,
    stageNumber: number,
    transcript: string
  ): Promise<StageAssistRecommendation> {
    return this.request(`/calls/${callId}/stage-assist`, {
      method: "POST",
      body: JSON.stringify({ stage_number: stageNumber, transcript }),
    });
  }

  async advanceCallStage(callId: string, stageNumber: number): Promise<Call> {
    return this.request(`/calls/${callId}/advance?stage_number=${stageNumber}`, {
      method: "POST",
    });
  }

  async closeCall(callId: string, payload: CloseCallPayload): Promise<Call> {
    return this.request(`/calls/${callId}/close`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async generateCallSummary(callId: string): Promise<SummaryResponse> {
    return this.request(`/calls/${callId}/summary`, {
      method: "POST",
    });
  }

  async getTranscript(callId: string): Promise<Transcript | null> {
    return this.request(`/calls/${callId}/transcript`);
  }

  async saveEditedTranscript(callId: string, editedTranscript: string): Promise<Transcript> {
    return this.request(`/calls/${callId}/transcript`, {
      method: "PUT",
      body: JSON.stringify({ edited_transcript: editedTranscript }),
    });
  }

  async analyzeRadar(callId: string, transcript?: string): Promise<RadarAnalysisResponse> {
    return this.request(`/calls/${callId}/radar/analyze`, {
      method: "POST",
      body: JSON.stringify(transcript ? { transcript } : {}),
    });
  }

  async getRadar(callId: string): Promise<RadarAnalysisResponse> {
    return this.request(`/calls/${callId}/radar`);
  }

  async createCommitment(callId: string, payload: Partial<Commitment>): Promise<Commitment> {
    return this.request(`/calls/${callId}/commitments`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateCommitment(
    callId: string,
    commitmentId: string,
    updates: Partial<Commitment>
  ): Promise<Commitment> {
    return this.request(`/calls/${callId}/commitments/${commitmentId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async updateMissedOpportunity(
    callId: string,
    opportunityId: string,
    updates: Partial<MissedOpportunity>
  ): Promise<MissedOpportunity> {
    return this.request(`/calls/${callId}/missed-opportunities/${opportunityId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async getHistoricalMatches(query?: string): Promise<HistoricalMatch[]> {
    const qs = query ? `?query=${encodeURIComponent(query)}` : "";
    return this.request(`/radar/historical-matches${qs}`);
  }

  async analyzeConversationGaps(callId: string, transcript?: string): Promise<ConversationGapsResponse> {
    return this.request(`/calls/${callId}/gaps/analyze`, {
      method: "POST",
      body: JSON.stringify(transcript ? { transcript } : {}),
    });
  }

  async getConversationGaps(callId: string): Promise<ConversationGapsResponse> {
    return this.request(`/calls/${callId}/gaps`);
  }

  async updateConversationGap(
    callId: string,
    gapId: string,
    updates: Partial<ConversationGap>
  ): Promise<ConversationGap> {
    return this.request(`/calls/${callId}/gaps/${gapId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async createGapFollowup(callId: string, gapId: string): Promise<ConversationGap> {
    return this.request(`/calls/${callId}/gaps/${gapId}/create-followup`, {
      method: "POST",
    });
  }

  async deleteConversationGap(callId: string, gapId: string): Promise<void> {
    return this.request(`/calls/${callId}/gaps/${gapId}`, {
      method: "DELETE",
    });
  }

  async listProspects(search?: string): Promise<Prospect[]> {
    const qs = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
    return this.request(`/prospects${qs}`);
  }

  async getProspect(prospectId: string): Promise<Prospect> {
    return this.request(`/prospects/${prospectId}`);
  }

  async getProspectCalls(prospectId: string): Promise<Call[]> {
    return this.request(`/prospects/${prospectId}/calls`);
  }

  async createProspect(payload: CreateProspectPayload): Promise<Prospect> {
    return this.request("/prospects", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async listFollowups(): Promise<FollowUpItem[]> {
    return this.request("/followups");
  }

  async updateFollowup(
    followupId: string,
    updates: UpdateFollowUpPayload
  ): Promise<FollowUpItem> {
    return this.request(`/followups/${followupId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Analyze a transcript segment and classify it into the 8 cold-call stages.
   * Returns AI-generated stage notes with evidence quotes.
   */
  async analyzeStageNotes(
    callId: string,
    transcriptSegment: string,
    segmentId: string
  ): Promise<{
    call_id: string;
    segment_id: string;
    stage_notes: Array<{
      stage_number: number;
      stage_name: string;
      note: string;
      evidence_quote: string;
      confidence: number;
      needs_review: boolean;
    }>;
    unclassified_segments: string[];
  }> {
    return this.request(`/calls/${callId}/analyze-stage-notes`, {
      method: "POST",
      body: JSON.stringify({
        transcript_segment: transcriptSegment,
        segment_id: segmentId,
      }),
    });
  }

  async deleteCall(callId: string): Promise<{ deleted: boolean; id: string }> {
    return this.request(`/calls/${callId}`, {
      method: "DELETE",
    });
  }

  async deleteProspect(prospectId: string): Promise<{ deleted: boolean; id: string }> {
    return this.request(`/prospects/${prospectId}`, {
      method: "DELETE",
    });
  }

  async deleteFollowup(followupId: string): Promise<{ deleted: boolean; id: string }> {
    return this.request(`/followups/${followupId}`, {
      method: "DELETE",
    });
  }

  /**
   * Build a WebSocket URL for the live transcription endpoint.
   * Converts the HTTP base URL to ws:// or wss://.
   */
  getLiveTranscriptionWsUrl(callId: string): string {

    const wsBase = this.baseUrl
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://");
    return `${wsBase}/calls/${callId}/transcribe-live`;
  }
}

export const api = new ApiClient(API_BASE_URL);

