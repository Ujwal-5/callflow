import {
  StageDefinition,
  Call,
  CreateCallPayload,
  CloseCallPayload,
  StageResult,
  SummaryResponse,
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
}

export const api = new ApiClient(API_BASE_URL);
