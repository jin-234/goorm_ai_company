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

/** 서버 SttError.toJSON() 모양. typeOnly면 다시 해도 안 되니 글 입력으로 넘어간다. */
export interface SttErrorInfo {
  kind: string;
  title: string;
  guidance: string;
  canRetry: boolean;
  typeOnly: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly type: "rule" | "badRequest" | "solar" | "stt" | "server" | "network",
    readonly solar: SolarErrorInfo | null = null,
    readonly stt: SttErrorInfo | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // FormData는 브라우저가 경계(boundary)를 붙인 Content-Type을 직접 넣는다.
    const isForm = init?.body instanceof FormData;
    res = await fetch(path, {
      ...init,
      headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("서버에 연결하지 못했습니다.\n인터넷 연결을 확인해 주세요.", "network");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    if (err?.type === "solar") throw new ApiError(`${err.title}\n${err.guidance}`, "solar", err);
    if (err?.type === "stt") throw new ApiError(`${err.title}\n${err.guidance}`, "stt", null, err);
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
  /** 음성 인식이 서버에서 켜져 있는지(OPENAI_API_KEY). */
  sttStatus: () => call<{ enabled: boolean; model: string; maxBytes: number }>("/api/stt"),
  /** 녹음 → 글. 녹음은 서버에 남지 않는다. */
  transcribe: (audio: Blob) => {
    const form = new FormData();
    form.append("audio", audio);
    return call<{ text: string; model: string; seconds: number }>("/api/stt", { method: "POST", body: form });
  },
  solarStatus: () => call<{ hasKey: boolean; key: string; model: string; baseURL: string }>("/api/solar"),
  solarPing: () => call<{ ok: boolean; model?: string; error?: SolarErrorInfo }>("/api/solar", { method: "POST" }),
};
