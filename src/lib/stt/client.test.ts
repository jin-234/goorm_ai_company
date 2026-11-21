import { describe, expect, test } from "vitest";
import { audioFileName, STT_MAX_BYTES, SttClient, SttError, type SttErrorKind, sttConfigFromEnv } from "./client";

function stub(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (capture) Object.assign(capture, { url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const client = (fetchImpl: typeof fetch, key: string | null = "sk-test-1234567890") =>
  new SttClient({ ...sttConfigFromEnv({}), apiKey: key }, fetchImpl);

const audio = (type = "audio/webm;codecs=opus", size = 1000) => new Blob([new Uint8Array(size)], { type });

async function kindOf(promise: Promise<unknown>): Promise<SttErrorKind | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (error instanceof SttError) return error.kind;
    throw error;
  }
}

describe("OpenAI 음성 인식", () => {
  test("녹음을 보내고 한국어 글을 받는다", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const result = await client(stub(200, { text: "  3단계 필수 업무는 지원서 검토입니다.  " }, capture)).transcribe(audio());
    expect(result.text).toBe("3단계 필수 업무는 지원서 검토입니다.");
    expect(capture.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const form = capture.init?.body as FormData;
    expect(form.get("language")).toBe("ko");
    expect(form.get("model")).toBe("gpt-4o-transcribe");
    expect((form.get("file") as File).name).toBe("pt.webm");
    expect(new Headers(capture.init?.headers).get("Authorization")).toBe("Bearer sk-test-1234567890");
  });

  test("환경변수로 모델·주소·시간을 바꾼다", () => {
    const config = sttConfigFromEnv({ OPENAI_API_KEY: " k ", OPENAI_STT_MODEL: "whisper-1", OPENAI_BASE_URL: "http://x/v1", OPENAI_STT_TIMEOUT: "1" });
    expect(config).toEqual({ apiKey: "k", model: "whisper-1", baseURL: "http://x/v1", timeout: 40 });
  });

  test("Safari 녹음(mp4)도 확장자를 붙인다", () => {
    expect(audioFileName("audio/mp4")).toBe("pt.m4a");
    expect(audioFileName("audio/ogg;codecs=opus")).toBe("pt.ogg");
    expect(audioFileName("text/plain")).toBeNull();
  });

  test("보내기 전에 걸러 낸다", async () => {
    expect(await kindOf(client(stub(200, {}), null).transcribe(audio()))).toBe("missingKey");
    expect(await kindOf(client(stub(200, {})).transcribe(audio("audio/webm", 0)))).toBe("noAudio");
    expect(await kindOf(client(stub(200, {})).transcribe(audio("audio/webm", STT_MAX_BYTES + 1)))).toBe("tooLarge");
    expect(await kindOf(client(stub(200, {})).transcribe(audio("text/plain")))).toBe("unsupportedAudio");
  });

  test("상태 코드를 오류 종류로 바꾼다", async () => {
    const cases: [number, unknown, SttErrorKind][] = [
      [400, { error: { message: "Invalid file format" } }, "unsupportedAudio"],
      [401, { error: { code: "invalid_api_key" } }, "unauthorized"],
      [413, "", "tooLarge"],
      [429, { error: { code: "rate_limit_exceeded" } }, "rateLimited"],
      [429, { error: { code: "insufficient_quota" } }, "quota"],
      [500, "", "server"],
    ];
    for (const [status, body, kind] of cases) {
      expect(await kindOf(client(stub(status, body)).transcribe(audio())), `${status}`).toBe(kind);
    }
  });

  test("빈 결과와 깨진 응답", async () => {
    expect(await kindOf(client(stub(200, { text: "   " })).transcribe(audio()))).toBe("empty");
    expect(await kindOf(client(stub(200, "not json")).transcribe(audio()))).toBe("malformed");
  });

  test("연결 실패와 시간 초과", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const timeout = (async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect(await kindOf(client(offline).transcribe(audio()))).toBe("offline");
    expect(await kindOf(client(timeout).transcribe(audio()))).toBe("timeout");
  });

  test("모든 오류 안내는 글 입력으로 이어 간다", () => {
    for (const kind of ["missingKey", "timeout", "empty", "quota"] as SttErrorKind[]) {
      expect(new SttError(kind).guidance).toContain("직접 적어도 됩니다");
    }
    expect(new SttError("missingKey").toJSON()).toMatchObject({ canRetry: false, typeOnly: true });
    expect(new SttError("timeout").toJSON()).toMatchObject({ canRetry: true, typeOnly: false });
  });
});
