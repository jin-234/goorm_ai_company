/**
 * 화면 → 서버 호출과 화면이 읽는 상태 모양(VISION COMPANY 개정).
 * 화면은 서버가 준 상태만 보고 그리고 규칙은 다시 계산하지 않는다.
 * 상태 모양은 세션 분담표 3.2~3.4와 4a에게 제안한 officeView를 따른다.
 */

// MARK: 상태 모양
// 서버가 만드는 officeView 타입을 그대로 쓴다(타입만 가져오므로 서버 코드는 화면에 실리지 않는다).
import type { OfficeView as ServerOfficeView } from "@/lib/server/view";

export type OfficeView = ServerOfficeView;
export type Phase = OfficeView["phase"]["value"];
export type Task = OfficeView["day"]["tasks"][number];
export type TaskStatus = Task["status"];
export type Submission = OfficeView["day"]["submissions"][number];
export type ShareTurn = OfficeView["day"]["share"]["turns"][number];
export type PlannerReply = NonNullable<ShareTurn["reply"]>;
export type ShareState = NonNullable<OfficeView["day"]["share"]["state"]>;
export type Review = NonNullable<OfficeView["day"]["review"]["draft"]>;
export type CloseChoice = NonNullable<Task["outcome"]>;
/** AI 응답 출처. sample = AI 연결 전 예시 생성기(실제처럼 이어지지만 AI가 아님을 꼬리표로 알린다). */
export type AiSource = "solar" | "manual" | "sample";
/** 서버 타입에 sample이 아직 없어도 비교할 수 있게 문자열로 본다. */
export const isSample = (source: string | null | undefined) => source === "sample";
export const isManual = (source: string | null | undefined) => source === "manual";
export type DayKey = { year: number; month: number; day: number };

/** AI 팀장 제안(분담표 3.4). AI 실패 시 source "manual"로 사용자의 글을 그대로 한 과제 초안으로 준다. */
export interface LeaderProposal {
  tasks: { title: string; completionCriteria: string; shareForm: string }[];
  question?: string;
}

// MARK: 오류

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
    throw new ApiError(err?.message ?? `서버 오류가 났습니다. (${res.status})`, err?.type ?? "server");
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

// MARK: 호출

export const api = {
  office: () => call<OfficeView>("/api/office"),
  reset: () => call<OfficeView>("/api/office", { method: "DELETE" }),
  /** 행동 하나. 서버는 { result, office }를 돌려준다. */
  act: (type: string, payload: Record<string, unknown> = {}) =>
    call<{ result: unknown; office: OfficeView }>("/api/office/actions", post({ type, ...payload })),
  /** AI 팀장: 오늘 목표 → 작은 범위·완료 기준·공유 형태 제안. */
  leader: (goal: string, availableMinutes?: number) =>
    call<{ source: AiSource; proposal: LeaderProposal; solarError?: { kind: string; message?: string } | null; office?: OfficeView }>(
      "/api/office/draft",
      post({ goal, availableMinutes }),
    ),
  /** AI 기획자: 내 설명 한 마디 → 응답(질문은 한 번에 하나). */
  share: (message: string) =>
    call<{ source: AiSource; reply?: PlannerReply; error?: unknown; office?: OfficeView }>("/api/office/share", post({ message })),
  /** 마감 요약 초안. */
  reviewDraft: () =>
    call<{ source: AiSource; review: Review; office?: OfficeView; solarError?: { kind: string; message?: string } | null }>(
      "/api/office/review-draft",
      post({}),
    ),
  solarStatus: () => call<{ hasKey: boolean; key: string; model: string; baseURL: string }>("/api/solar"),
  solarPing: () => call<{ ok: boolean; model?: string; error?: SolarErrorInfo }>("/api/solar", { method: "POST" }),
};

/** 분 → "HH:MM". */
export const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "HH:MM" → 분. 형식이 틀리면 null. */
export function minutesOf(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
