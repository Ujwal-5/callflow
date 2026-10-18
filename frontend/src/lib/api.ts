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
} from "@/types";


const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

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
        let errorMessage = `HTTP error ${response.status}`;
        try {
          const errData = await response.json();
          if (errData && errData.detail) {
            errorMessage = typeof errData.detail === "string" 
              ? errData.detail 
              : JSON.stringify(errData.detail);
          }
        } catch {
          // Response body was not JSON
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          throw new Error("Request timed out. Please check if the backend server is reachable.");
        }
        throw err;
      }
      throw new Error("An unexpected network error occurred.");
    }
  }

  async getHealth(): Promise<{ status: string; service: string; database_mode: string; gemini_configured: boolean }> {
    return this.request("/health");
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
    }
  ): Promise<StageResult> {
    return this.request(`/calls/${callId}/stages/${stageNumber}`, {
      method: "PUT",
      body: JSON.stringify(payload),
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

  /**
   * Upload audio Blob to the backend transcription endpoint.
   * Uses fetch directly (not the JSON helper) because the body is multipart/form-data.
   * Throws an Error with a user-friendly message on non-2xx responses.
   */
  async uploadAndTranscribe(callId: string, audioBlob: Blob, mimeType: string): Promise<Transcript> {
    const url = `${this.baseUrl}/calls/${callId}/transcript`;
    const formData = new FormData();
    formData.append("audio", audioBlob, `recording.${mimeType.split("/")[1]?.split(";")[0] || "webm"}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2 min upload timeout

    try {
      const response = await fetch(url, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `Transcription request failed (HTTP ${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.detail) {
            errorMessage = typeof errData.detail === "string"
              ? errData.detail
              : JSON.stringify(errData.detail);
          }
        } catch {
          // Non-JSON error body
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          throw new Error("Upload timed out. Check your connection and try again.");
        }
        throw err;
      }
      throw new Error("An unexpected error occurred during audio upload.");
    }
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
}

export const api = new ApiClient(API_BASE_URL);

