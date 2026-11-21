/** 동료 대화 화면 → 서버 호출. 모양은 서버 타입을 그대로 쓴다(타입만 가져온다). */
import type { ChatTurn, ColleagueMemory, Conversation } from "@/lib/colleague/memory/store";
import type { Persona, PersonaId } from "@/lib/colleague/memory/personas";
import type { SolarErrorInfo } from "../office/api";

export type { ChatTurn, Conversation, PersonaId };
export type Colleague = Omit<Persona, "sampleQuestions"> & { memoryUpdatedAt: string | null };
export type ConversationItem = Omit<Conversation, "turns"> & { turnCount: number; lastText: string };
export type Memory = ColleagueMemory & { exists: boolean };

export class ColleagueApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  } catch {
    throw new ColleagueApiError("서버에 연결하지 못했습니다.\n인터넷 연결을 확인해 주세요.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ColleagueApiError(err?.type === "solar" ? `${err.title}\n${err.guidance}` : (err?.message ?? `서버 오류가 났습니다. (${res.status})`));
  }
  return body as T;
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

type WithSolar<T> = T & { solarError: SolarErrorInfo | null };

export const colleagueApi = {
  colleagues: () => call<{ aiMode: "solar" | "sample"; colleagues: Colleague[] }>("/api/colleagues"),
  list: () => call<{ conversations: ConversationItem[] }>("/api/colleagues/conversations"),
  get: (id: string) => call<{ conversation: Conversation }>(`/api/colleagues/conversations/${id}`),
  start: (input: { participants: PersonaId[]; title?: string; opening?: boolean }) =>
    call<WithSolar<{ conversation: Conversation }>>("/api/colleagues/conversations", send("POST", input)),
  say: (id: string, text: string) => call<WithSolar<{ conversation: Conversation }>>(`/api/colleagues/conversations/${id}/messages`, send("POST", { text })),
  edit: (
    id: string,
    patch: { title?: string; edits?: { id: string; text: string }[]; remove?: string[]; append?: { speaker: ChatTurn["speaker"]; text: string }[]; summaryMd?: string },
  ) => call<{ conversation: Conversation }>(`/api/colleagues/conversations/${id}`, send("PATCH", patch)),
  finish: (id: string) => call<WithSolar<{ conversation: Conversation; memories: ColleagueMemory[] }>>(`/api/colleagues/conversations/${id}/finish`, send("POST")),
  remove: (id: string) => call<{ ok: true }>(`/api/colleagues/conversations/${id}`, send("DELETE")),
  memory: (personaId: PersonaId) => call<{ memory: Memory }>(`/api/colleagues/memory/${personaId}`),
  saveMemory: (personaId: PersonaId, markdown: string) => call<{ memory: Memory }>(`/api/colleagues/memory/${personaId}`, send("PUT", { markdown })),
  memoryFileUrl: (personaId: PersonaId) => `/api/colleagues/memory/${personaId}?format=md`,
};
