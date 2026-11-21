/**
 * Upstage Solar(Chat Completions) 호출.
 * 키는 서버(Vercel 함수) 환경변수에서만 읽고, 브라우저나 기록에 남기지 않는다.
 */
import { isTaskLevel, newDraft, type TaskDraft } from "../office/models";
import { WorkRules } from "../office/rules";
import { Clock } from "../office/time";

// MARK: 설정

export interface SolarConfig {
  apiKey: string | null;
  baseURL: string;
  model: string;
  /** 초 */
  timeout: number;
}

export const SOLAR_DEFAULTS = { baseURL: "https://api.upstage.ai/v1", model: "solar-pro4", timeout: 30 } as const;

/** `UPSTAGE_API_KEY` 하나만 넣으면 된다. 나머지는 기본값. */
export function solarConfigFromEnv(env: Record<string, string | undefined> = process.env): SolarConfig {
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  const timeout = Number(clean(env.UPSTAGE_TIMEOUT));
  return {
    apiKey: clean(env.UPSTAGE_API_KEY),
    baseURL: clean(env.UPSTAGE_BASE_URL) ?? SOLAR_DEFAULTS.baseURL,
    model: clean(env.UPSTAGE_MODEL) ?? SOLAR_DEFAULTS.model,
    timeout: Number.isFinite(timeout) && timeout >= 3 ? timeout : SOLAR_DEFAULTS.timeout,
  };
}

/** 화면에 보여 줄 때는 앞 4자…뒤 4자만. */
export function maskKey(key: string | null): string | null {
  if (!key) return null;
  return key.length <= 8 ? "…" : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// MARK: 오류

export type SolarErrorKind =
  | "missingKey"
  | "unauthorized"
  | "blocked"
  | "regionMismatch"
  | "timeout"
  | "offline"
  | "rateLimited"
  | "usageLimit"
  | "badRequest"
  | "server"
  | "truncated"
  | "malformed";

const RETRYABLE: SolarErrorKind[] = ["timeout", "offline", "rateLimited", "server", "truncated", "malformed"];

export class SolarError extends Error {
  constructor(
    public readonly kind: SolarErrorKind,
    public readonly detail: { code?: string | null; message?: string; status?: number } = {},
  ) {
    super(SolarError.titleOf(kind));
    this.name = "SolarError";
  }

  /** 화면에 보이는 한 줄 제목. */
  get title(): string {
    return SolarError.titleOf(this.kind);
  }

  static titleOf(kind: SolarErrorKind): string {
    return {
      missingKey: "Solar 키가 없습니다",
      unauthorized: "Solar 인증에 실패했습니다",
      blocked: "Solar 키가 막혀 있습니다",
      regionMismatch: "Solar 접속 지역이 맞지 않습니다",
      timeout: "Solar 응답 시간이 초과되었습니다",
      offline: "인터넷에 연결되지 않았습니다",
      rateLimited: "Solar 요청이 잠시 몰렸습니다",
      usageLimit: "Solar 월 사용 한도에 도달했습니다",
      badRequest: "Solar가 요청을 받아들이지 않았습니다",
      server: "Solar 서버에 문제가 있습니다",
      truncated: "Solar 응답이 중간에 끊겼습니다",
      malformed: "Solar 응답을 읽지 못했습니다",
    }[kind];
  }

  /** 무엇을 하면 되는지. 의미 단위로 줄을 나눈다. */
  get guidance(): string {
    switch (this.kind) {
      case "missingKey":
        return "서버 환경변수에 UPSTAGE_API_KEY를 넣어 주세요.\n작성한 내용은 그대로 남아 있습니다.";
      case "unauthorized":
        return "키가 틀렸거나 삭제된 키입니다.\n서버 환경변수의 키를 다시 확인해 주세요.";
      case "blocked":
        return "Upstage 콘솔에서 크레딧과 결제 수단을 확인해 주세요.\n새 키를 만들어도 해결되지 않습니다.";
      case "regionMismatch":
        return "한국 리전 전용 키입니다.\nUPSTAGE_BASE_URL을 https://kr.api.upstage.ai/v1 로 바꿔 주세요.";
      case "timeout":
        return "작성한 내용은 그대로 남아 있습니다.\n잠시 뒤 다시 시도해 주세요.";
      case "offline":
        return "네트워크 연결을 확인한 뒤\n다시 시도해 주세요.";
      case "rateLimited":
        return "1분쯤 기다린 뒤\n다시 시도해 주세요.";
      case "usageLimit":
        return "Upstage 콘솔에서 월 한도를 확인해 주세요.\n다시 시도해도 해결되지 않습니다.";
      case "badRequest":
        return `모델 이름이나 요청 형식을 확인해 주세요.\n(${this.detail.message ?? ""})`;
      case "server":
        return `잠시 뒤 다시 시도해 주세요.\n(상태 코드 ${this.detail.status})`;
      case "truncated":
        return "전사문이 너무 길 수 있습니다.\n다시 시도해 주세요.";
      case "malformed":
        return `다시 시도해 주세요.\n(${this.detail.message ?? ""})`;
    }
  }

  /** 같은 요청을 그대로 다시 보내 볼 만한지. */
  get canRetry(): boolean {
    return RETRYABLE.includes(this.kind);
  }

  /** 키 설정을 고쳐야 하는 문제인지. */
  get needsKeySetup(): boolean {
    return this.kind === "missingKey" || this.kind === "unauthorized";
  }

  toJSON() {
    return { kind: this.kind, title: this.title, guidance: this.guidance, canRetry: this.canRetry, needsKeySetup: this.needsKeySetup };
  }

  /** 상태 코드와 오류 본문의 `code`로 구분한다. */
  static fromStatus(status: number, body: string): SolarError {
    let code: string | null = null;
    let message: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
      code = parsed.error?.code ?? null;
      message = parsed.error?.message;
    } catch {
      // 본문이 JSON이 아니면 상태 코드로만 구분한다.
    }
    switch (status) {
      case 400:
      case 404:
      case 405:
      case 413:
      case 422:
        return new SolarError("badRequest", { code, message: message ?? `상태 코드 ${status}` });
      case 401:
        return new SolarError(code === "api_key_is_blocked" ? "blocked" : "unauthorized", { code });
      case 403:
        return new SolarError(code === "data_residency_region_mismatch" ? "regionMismatch" : "blocked", { code });
      case 408:
      case 504:
        return new SolarError("timeout");
      case 429:
        return new SolarError(code === "usage_limit_exceeded" ? "usageLimit" : "rateLimited", { code });
      default:
        return new SolarError("server", { status });
    }
  }
}

// MARK: 지시문과 응답 형식

export const SolarPrompts = {
  checklistSystem(workEnd: number): string {
    return `당신은 가상회사의 AI 팀장입니다.
사원이 아침 PT에서 말한 내용을 받아 적은 전사문을 읽고, 오늘 업무 체크리스트 초안을 JSON으로 정리합니다.

규칙
1. 전사문에 나온 업무만 적습니다. 업무를 새로 만들거나 합치지 않습니다.
2. 각 업무는 업무명(title), 중요도(priority), 마감(deadline), 완료 기준(done_criteria)을 가집니다.
3. 중요도는 사원이 말한 단계를 그대로 씁니다. 3은 필수 마감, 2는 당일 완료, 1은 이월 가능입니다. "삼 단계"처럼 말해도 숫자로 적습니다. 사원이 단계를 말하지 않은 업무는 null로 둡니다. 추측하지 않습니다.
4. 마감은 24시간 HH:MM 형식입니다. "오후 3시까지"는 "15:00", "오후 5시 반까지"는 "17:30"입니다. "퇴근 전까지"와 "오늘 안에"는 퇴근 시각인 "${Clock.hm(workEnd)}"로 적습니다. 마감을 말하지 않은 업무는 null로 둡니다.
5. 완료 기준은 사원이 말한 끝내는 조건을 짧게 적습니다. 예: "오탈자를 확인하고 제출본을 저장". 말하지 않았으면 null로 둡니다.
6. 업무명은 사원이 말한 표현을 살려 짧게 적습니다. "~입니다", "~하겠습니다" 같은 말끝은 뺍니다.
7. 음성 인식 오류로 보이는 글자는 문맥에 맞게 바로잡되 뜻을 바꾸지 않습니다.
8. 중요도가 높은 순서(3, 2, 1)로 정렬하고, 중요도가 null인 업무는 맨 뒤에 둡니다.
9. 인사말처럼 업무가 아닌 말은 무시합니다. 업무가 하나도 없으면 tasks를 빈 배열로 둡니다.`;
  },

  checklistUser(transcript: string, workEnd: number): string {
    return `퇴근 시각: ${Clock.hm(workEnd)}\n\n전사문:\n${transcript.trim()}`;
  },

  checklistSchemaName: "morning_pt_checklist",

  /** 업무명·중요도·마감·완료 기준. 전사문에 없는 값은 null로 받는다. */
  checklistSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: ["string", "null"], description: "업무명. 전사문에 없으면 null" },
            priority: { type: ["integer", "null"], description: "중요도 단계. 1, 2, 3 중 하나. 전사문에 없으면 null" },
            deadline: { type: ["string", "null"], description: "마감 시각. 24시간 HH:MM. 전사문에 없으면 null" },
            done_criteria: { type: ["string", "null"], description: "완료 기준. 전사문에 없으면 null" },
          },
          required: ["title", "priority", "deadline", "done_criteria"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
};

// MARK: 응답 읽기

interface Envelope {
  model?: string;
  choices: { message: { content?: string | null }; finish_reason?: string | null }[];
}

/** 구조화 출력(JSON 문자열)을 업무 초안으로 바꾼다. 범위를 벗어난 중요도나 읽을 수 없는 마감은 null. */
export function decodeChecklist(content: string): TaskDraft[] {
  let payload: { tasks: { title?: string | null; priority?: number | null; deadline?: string | null; done_criteria?: string | null }[] };
  try {
    payload = JSON.parse(content);
    if (!Array.isArray(payload.tasks)) throw new Error();
  } catch {
    throw new SolarError("malformed", { message: "체크리스트 형식이 예상과 다릅니다" });
  }
  return payload.tasks.map((item) => {
    const title = item.title?.trim();
    const criteria = item.done_criteria?.trim();
    return newDraft({
      title: title ? title : null,
      level: isTaskLevel(item.priority) ? item.priority : null,
      due: item.deadline ? Clock.minutesFromHM(item.deadline) : null,
      doneCriteria: criteria ? criteria : null,
    });
  });
}

// MARK: 클라이언트

export class SolarClient {
  constructor(
    public readonly config: SolarConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get hasKey(): boolean {
    return !!this.config.apiKey;
  }

  /** 아침 PT 전사문에서 업무 체크리스트 초안을 받는다. */
  async checklist(transcript: string, workEnd: number = WorkRules.defaultWorkEnd): Promise<TaskDraft[]> {
    const content = await this.complete({
      system: SolarPrompts.checklistSystem(workEnd),
      user: SolarPrompts.checklistUser(transcript, workEnd),
      schemaName: SolarPrompts.checklistSchemaName,
      schema: SolarPrompts.checklistSchema,
      temperature: 0.1,
      maxTokens: 1500,
    });
    return decodeChecklist(content);
  }

  /** 키와 모델이 실제로 응답하는지 확인한다. 응답한 모델 이름을 돌려준다. */
  async ping(): Promise<string> {
    const envelope = await this.post({
      model: this.config.model,
      messages: [{ role: "user", content: "연결 확인입니다. '확인'이라고만 답해 주세요." }],
      max_tokens: 16,
    });
    return envelope.model ?? this.config.model;
  }

  /**
   * 역할 지침(system)과 대화(messages)를 보내 JSON 스키마에 맞는 답을 받는다. AI 동료 대화(src/lib/colleague)가 쓴다.
   * 돌려준 문자열은 호출한 쪽에서 해석·검증한다.
   */
  async completeJSON(args: {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    /** 없으면 JSON 객체 하나만 받는다(json_object). AI 동료 v2는 형식을 서버에서 검사·재요청한다. */
    schemaName?: string;
    schema?: object;
    temperature: number;
    maxTokens: number;
  }): Promise<string> {
    const envelope = await this.post({
      model: this.config.model,
      messages: [{ role: "system", content: args.system }, ...args.messages],
      temperature: args.temperature,
      max_tokens: args.maxTokens,
      response_format:
        args.schema && args.schemaName
          ? { type: "json_schema", json_schema: { name: args.schemaName, strict: true, schema: args.schema } }
          : { type: "json_object" },
    });
    const choice = envelope.choices?.[0];
    if (!choice) throw new SolarError("malformed", { message: "응답에 선택지가 없습니다" });
    if (choice.finish_reason === "length") throw new SolarError("truncated");
    const content = choice.message?.content;
    if (!content) throw new SolarError("malformed", { message: "응답 본문이 비어 있습니다" });
    return content;
  }

  private async complete(args: {
    system: string;
    user: string;
    schemaName: string;
    schema: object;
    temperature: number;
    maxTokens: number;
  }): Promise<string> {
    const envelope = await this.post({
      model: this.config.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      temperature: args.temperature,
      max_tokens: args.maxTokens,
      response_format: { type: "json_schema", json_schema: { name: args.schemaName, strict: true, schema: args.schema } },
    });
    const choice = envelope.choices?.[0];
    if (!choice) throw new SolarError("malformed", { message: "응답에 선택지가 없습니다" });
    if (choice.finish_reason === "length") throw new SolarError("truncated");
    const content = choice.message?.content;
    if (!content) throw new SolarError("malformed", { message: "응답 본문이 비어 있습니다" });
    return content;
  }

  private async post(body: object): Promise<Envelope> {
    const key = this.config.apiKey?.trim();
    if (!key) throw new SolarError("missingKey");

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseURL.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout * 1000),
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      throw new SolarError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "offline");
    }

    const text = await response.text();
    if (!response.ok) throw SolarError.fromStatus(response.status, text);
    try {
      const envelope = JSON.parse(text) as Envelope;
      if (!Array.isArray(envelope.choices)) throw new Error();
      return envelope;
    } catch {
      throw new SolarError("malformed", { message: "응답 형식이 예상과 다릅니다" });
    }
  }
}
