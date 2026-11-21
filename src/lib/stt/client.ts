/**
 * OpenAI 음성 인식(Audio Transcriptions) 호출.
 * 키는 서버(Vercel 함수) 환경변수에서만 읽는다. 받은 녹음은 OpenAI로 보낸 뒤 서버에 남기지 않는다.
 * 어떤 오류든 화면은 '글로 직접 적기'로 이어 갈 수 있어야 하므로, 오류마다 그 안내를 함께 준다.
 */

// MARK: 설정

export interface SttConfig {
  apiKey: string | null;
  baseURL: string;
  model: string;
  /** 초 */
  timeout: number;
}

export const STT_DEFAULTS = { baseURL: "https://api.openai.com/v1", model: "gpt-4o-transcribe", timeout: 40 } as const;

/** Vercel 함수 요청 본문 한도(4.5MB)보다 조금 작게. */
export const STT_MAX_BYTES = 4 * 1024 * 1024;

/** `OPENAI_API_KEY` 하나만 넣으면 된다. 나머지는 기본값. */
export function sttConfigFromEnv(env: Record<string, string | undefined> = process.env): SttConfig {
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  const timeout = Number(clean(env.OPENAI_STT_TIMEOUT));
  return {
    apiKey: clean(env.OPENAI_API_KEY),
    baseURL: clean(env.OPENAI_BASE_URL) ?? STT_DEFAULTS.baseURL,
    model: clean(env.OPENAI_STT_MODEL) ?? STT_DEFAULTS.model,
    timeout: Number.isFinite(timeout) && timeout >= 3 ? timeout : STT_DEFAULTS.timeout,
  };
}

/** 아침 PT에서 자주 나오는 말. 인식이 이 표현 쪽으로 기울게 한다. */
export const STT_PROMPT =
  "아침 PT 발표입니다. 3단계 필수 업무, 2단계 당일 업무, 1단계 이월 가능 업무, 오후 3시까지, 퇴근 전까지, 하겠습니다.";

// MARK: 오류

export type SttErrorKind =
  | "missingKey"
  | "unauthorized"
  | "noAudio"
  | "tooLarge"
  | "unsupportedAudio"
  | "empty"
  | "timeout"
  | "offline"
  | "rateLimited"
  | "quota"
  | "server"
  | "malformed";

const RETRYABLE: SttErrorKind[] = ["timeout", "offline", "rateLimited", "server", "malformed"];

const TYPE_HINT = "아래 칸에 직접 적어도 됩니다.";

export class SttError extends Error {
  constructor(
    public readonly kind: SttErrorKind,
    public readonly detail: { message?: string; status?: number } = {},
  ) {
    super(SttError.titleOf(kind));
    this.name = "SttError";
  }

  get title(): string {
    return SttError.titleOf(this.kind);
  }

  static titleOf(kind: SttErrorKind): string {
    return {
      missingKey: "음성 인식이 아직 켜지지 않았습니다",
      unauthorized: "음성 인식 인증에 실패했습니다",
      noAudio: "녹음이 비어 있습니다",
      tooLarge: "녹음이 너무 깁니다",
      unsupportedAudio: "녹음 형식을 읽지 못했습니다",
      empty: "말소리를 알아듣지 못했습니다",
      timeout: "음성 인식 시간이 초과되었습니다",
      offline: "음성 인식 서버에 연결하지 못했습니다",
      rateLimited: "음성 인식 요청이 잠시 몰렸습니다",
      quota: "음성 인식 사용 한도에 도달했습니다",
      server: "음성 인식 서버에 문제가 있습니다",
      malformed: "음성 인식 결과를 읽지 못했습니다",
    }[kind];
  }

  /** 무엇을 하면 되는지. 마지막 줄은 항상 글로 적는 길을 알려 준다. */
  get guidance(): string {
    const head = (() => {
      switch (this.kind) {
        case "missingKey":
          return "서버 환경변수에 OPENAI_API_KEY를 넣으면 켜집니다.";
        case "unauthorized":
          return "서버의 OPENAI_API_KEY를 다시 확인해 주세요.";
        case "noAudio":
          return "마이크가 켜져 있는지 확인하고 다시 녹음해 주세요.";
        case "tooLarge":
          return "3분 안쪽으로 나눠서 녹음해 주세요.";
        case "unsupportedAudio":
          return "다른 브라우저(Chrome, Safari)로 다시 녹음해 주세요.";
        case "empty":
          return "조용한 곳에서 마이크에 조금 더 가까이 말해 주세요.";
        case "timeout":
        case "server":
        case "malformed":
          return "녹음은 남아 있으니 다시 시도해 주세요.";
        case "offline":
          return "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
        case "rateLimited":
          return "1분쯤 기다린 뒤 다시 시도해 주세요.";
        case "quota":
          return "OpenAI 콘솔에서 결제와 한도를 확인해 주세요.";
      }
    })();
    return `${head}\n${TYPE_HINT}`;
  }

  /** 같은 녹음을 그대로 다시 보내 볼 만한지. */
  get canRetry(): boolean {
    return RETRYABLE.includes(this.kind);
  }

  /** 다시 해도 안 되는 문제라 글 입력으로 넘어가야 하는지(키 없음·인증·한도). */
  get typeOnly(): boolean {
    return this.kind === "missingKey" || this.kind === "unauthorized" || this.kind === "quota";
  }

  toJSON() {
    return { kind: this.kind, title: this.title, guidance: this.guidance, canRetry: this.canRetry, typeOnly: this.typeOnly };
  }

  static fromStatus(status: number, body: string): SttError {
    let code: string | null = null;
    let message: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: { code?: string; type?: string; message?: string } };
      code = parsed.error?.code ?? parsed.error?.type ?? null;
      message = parsed.error?.message;
    } catch {
      // 본문이 JSON이 아니면 상태 코드로만 구분한다.
    }
    switch (status) {
      case 400:
      case 415:
      case 422:
        return new SttError("unsupportedAudio", { message, status });
      case 401:
      case 403:
        return new SttError("unauthorized", { status });
      case 408:
      case 504:
        return new SttError("timeout", { status });
      case 413:
        return new SttError("tooLarge", { status });
      case 429:
        return new SttError(code === "insufficient_quota" ? "quota" : "rateLimited", { status });
      default:
        return new SttError("server", { status });
    }
  }
}

// MARK: 녹음 형식

/** MIME(코덱 정보 포함 가능) → OpenAI가 확장자로 알아보는 파일 이름. */
export function audioFileName(mime: string): string | null {
  const base = mime.split(";")[0].trim().toLowerCase();
  const ext: Record<string, string> = {
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/flac": "flac",
  };
  return ext[base] ? `pt.${ext[base]}` : null;
}

// MARK: 클라이언트

export interface Transcription {
  text: string;
  model: string;
}

export class SttClient {
  constructor(
    public readonly config: SttConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get hasKey(): boolean {
    return !!this.config.apiKey;
  }

  /** 녹음 하나를 한국어 글로 바꾼다. */
  async transcribe(audio: Blob): Promise<Transcription> {
    const key = this.config.apiKey?.trim();
    if (!key) throw new SttError("missingKey");
    if (audio.size === 0) throw new SttError("noAudio");
    if (audio.size > STT_MAX_BYTES) throw new SttError("tooLarge");
    const fileName = audioFileName(audio.type);
    if (!fileName) throw new SttError("unsupportedAudio", { message: audio.type || "형식 없음" });

    const form = new FormData();
    form.append("file", audio, fileName);
    form.append("model", this.config.model);
    form.append("language", "ko");
    form.append("response_format", "json");
    form.append("prompt", STT_PROMPT);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseURL.replace(/\/+$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(this.config.timeout * 1000),
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      throw new SttError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "offline");
    }

    const body = await response.text();
    if (!response.ok) throw SttError.fromStatus(response.status, body);
    let text: unknown;
    try {
      text = (JSON.parse(body) as { text?: unknown }).text;
    } catch {
      throw new SttError("malformed");
    }
    if (typeof text !== "string") throw new SttError("malformed");
    const trimmed = text.trim();
    if (!trimmed) throw new SttError("empty");
    return { text: trimmed, model: this.config.model };
  }
}
