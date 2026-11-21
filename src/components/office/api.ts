/**
 * 화면 → 서버 호출. 화면은 서버가 준 officeView만 보고 그리고, 규칙은 다시 계산하지 않는다.
 * 서버 오류는 한국어 메시지를 담은 ApiError로 바꿔 던진다.
 */
import type { OfficeView } from "@/lib/server/view";

export type { OfficeView };

/** 서버 SolarError.toJSON() 모양. */
export interface SolarErrorInfo {
  kind: string;
  title: string;
  guidance: string;
  canRetry: boolean;
  needsKeySetup: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly type: "rule" | "badRequest" | "solar" | "server" | "network",
    readonly solar: SolarErrorInfo | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("서버에 연결하지 못했습니다.\n인터넷 연결을 확인해 주세요.", "network");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    if (err?.type === "solar") throw new ApiError(`${err.title}\n${err.guidance}`, "solar", err);
    throw new ApiError(err?.message ?? `서버 오류가 났습니다. (${res.status})`, err?.type ?? "server");
  }
  return body as T;
}

export const api = {
  office: () => call<OfficeView>("/api/office"),
  reset: () => call<OfficeView>("/api/office", { method: "DELETE" }),
  /** 행동 하나. 서버는 { result, office }를 돌려준다. */
  act: (type: string, payload: Record<string, unknown> = {}) =>
    call<{ result: unknown; office: OfficeView }>("/api/office/actions", {
      method: "POST",
      body: JSON.stringify({ type, ...payload }),
    }),
  draft: (transcript: string) =>
    call<{
      result: { source: "solar" | "localRules"; seconds: number; solarError: SolarErrorInfo | null };
      office: OfficeView;
    }>("/api/office/draft", { method: "POST", body: JSON.stringify({ transcript }) }),
  weeklyFeedback: (fallback: boolean) =>
    call<{ result: { source?: string; solarError: SolarErrorInfo | null }; office: OfficeView }>(
      "/api/office/weekly-feedback",
      { method: "POST", body: JSON.stringify({ fallback }) },
    ),
  solarStatus: () => call<{ hasKey: boolean; key: string; model: string; baseURL: string }>("/api/solar"),
  solarPing: () => call<{ ok: boolean; model?: string; error?: SolarErrorInfo }>("/api/solar", { method: "POST" }),
};
