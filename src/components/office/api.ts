/**
 * 화면 → 서버 호출과 화면이 읽는 상태 모양(VISION COMPANY 개정).
 * 화면은 서버가 준 상태만 보고 그리고 규칙은 다시 계산하지 않는다.
 * 상태 모양은 세션 분담표 3.2~3.4와 4a에게 제안한 officeView를 따른다.
 */

// MARK: 상태 모양

export type DayKey = { year: number; month: number; day: number };
export type Phase = "beforeCheckIn" | "morningPT" | "working" | "sharing" | "checkoutReview" | "off";
export type TaskStatus = "confirmed" | "in_progress" | "submitted" | "incomplete" | "reviewed";
export type CloseChoice = "adjust" | "carryOver" | "endToday";
export type AiSource = "solar" | "manual";

export interface Task {
  id: string;
  title: string;
  completionCriteria: string;
  shareForm: string;
  status: TaskStatus;
  carriedFrom: DayKey | null;
  carryCount: number;
  outcome: CloseChoice | null;
}

export interface Submission {
  id: string;
  taskId: string;
  kind: "text" | "link" | "code";
  content: string;
  at: number;
  /** link는 서버가 본문을 읽지 않으므로 "notRead". */
  readScope: "read" | "notRead";
}

/** AI 기획자 응답(개정 기획서 4.3 E). 질문이 없으면 question은 빈 문자열. */
export interface PlannerReply {
  acknowledgement: string;
  question: string;
  question_reason: string;
  known_facts: string[];
  open_questions: string[];
  evidence_refs: string[];
  can_finish: boolean;
}

export interface ShareTurn {
  id: string;
  role: "user" | "planner";
  at: number;
  text?: string;
  reply?: PlannerReply;
  source?: AiSource;
}

/** 마감 요약(개정 기획서 4.3 E). */
export interface Review {
  reported_work: string;
  explained_learning: string;
  artifact_observations: string;
  shared_scope_and_limits: string;
  open_questions: string[];
  job_connection: string;
  next_action: string;
  evidence_refs: string[];
}

export type ShareState = "awaiting_explanation" | "clarifying" | "ready_to_summarize" | "user_confirmed";

export interface Mail {
  id: string;
  sentAt: number;
  from: string;
  to: string;
  kind: string;
  subject: string;
  body: string;
  isRead: boolean;
  isWarm: boolean;
  replySource: "solar" | "localTemplate" | null;
  tag: string;
  fromName: string;
  toName: string;
}

export interface OfficeView {
  onboarded: boolean;
  profile: { name: string; targetRole: string; experience: string; activityStart: number; activityEnd: number };
  clock: { now: number; hm: string; date: string; dateShort: string; dateLong: string; weekLabel: string; isFriday: boolean };
  phase: { value: Phase; label: string; headline: string };
  /** 사용자가 정한 마감 시각이 지났는지. 안내만 하고 강제로 넘기지 않는다. */
  pastActivityEnd: boolean;
  day: {
    date: DayKey;
    checkInAt: number | null;
    goal: string;
    tasks: Task[];
    submissions: Submission[];
    share: { state: ShareState | null; questionCount: number; maxQuestions: number; turns: ShareTurn[] };
    review: {
      draft: Review | null;
      draftSource: AiSource | null;
      confirmed: Review | null;
      confirmedAt: number | null;
      choices: Record<string, CloseChoice>;
    };
  };
  pendingCarry: Task[];
  can: {
    checkIn: boolean;
    /** 업무 상태 바꾸기·결과물 제출이 가능한지. */
    editTasks: boolean;
    confirmTasks: boolean;
    startSharing: boolean;
    endSharing: boolean;
    confirmReview: boolean;
    startNextWorkday: boolean;
    jumpToFriday: boolean;
    skipHour: boolean;
    submitWeekly: boolean;
  };
  mail: { unreadCount: number; inbox: Mail[]; sent: Mail[] };
  weekly: {
    draft: { id: string; weekOf: DayKey; completed: string; incomplete: string; nextGoals: string };
    awaitingReplyId: string | null;
    /** 이번 주에 제출한 보고서(없으면 null). */
    lastSubmitted: {
      id: string;
      weekOf: DayKey;
      submittedAt: number;
      completed: string;
      incomplete: string;
      nextGoals: string;
      replyMailId: string | null;
    } | null;
  };
  /** 지난 활동일 기록(있으면). */
  history?: { date: DayKey; tasks: Task[]; review: Review | null }[];
}

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
  weeklyFeedback: (fallback: boolean) =>
    call<{ result: { source?: string; solarError: SolarErrorInfo | null }; office: OfficeView }>(
      "/api/office/weekly-feedback",
      post({ fallback }),
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
