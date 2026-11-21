import { describe, expect, test } from "vitest";
import { decodeChecklist, maskKey, SolarClient, SolarError, type SolarErrorKind, SolarPrompts, solarConfigFromEnv } from "./client";

const transcript = "3단계 필수 업무는 지원서 최종 검토입니다. 오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다.";

function stub(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (capture) Object.assign(capture, { url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const completion = (content: string, finish = "stop") => ({
  model: "solar-pro4-250101",
  choices: [{ message: { content }, finish_reason: finish }],
});

const errorBody = (code: string, message = "오류") => ({ error: { code, message, type: "error" } });

const client = (fetchImpl: typeof fetch, key: string | null = "test-key-1234567890") =>
  new SolarClient({ ...solarConfigFromEnv({}), apiKey: key }, fetchImpl);

async function kindOf(promise: Promise<unknown>): Promise<SolarErrorKind | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (error instanceof SolarError) return error.kind;
    throw error;
  }
}

describe("Upstage Solar", () => {
  test("전사문을 보내고 체크리스트를 받는다", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const content = JSON.stringify({
      tasks: [{ title: "지원서 최종 검토", priority: 3, deadline: "15:00", done_criteria: "오탈자를 확인하고 제출본을 저장" }],
    });
    const drafts = await client(stub(200, completion(content), capture)).checklist(transcript);
    expect(drafts.map((d) => [d.title, d.level, d.due, d.doneCriteria])).toEqual([
      ["지원서 최종 검토", 3, 15 * 60, "오탈자를 확인하고 제출본을 저장"],
    ]);

    expect(capture.url).toBe("https://api.upstage.ai/v1/chat/completions");
    expect((capture.init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key-1234567890");
    const sent = JSON.parse(String(capture.init?.body));
    expect(sent.model).toBe("solar-pro4");
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.messages[1].content).toContain(transcript);
    expect(sent.messages[1].content).toContain("퇴근 시각: 18:00");
  });

  test("응답 형식은 모든 칸을 필수로 하고 null을 허용한다", () => {
    const item = SolarPrompts.checklistSchema.properties.tasks.items;
    expect(item.required).toEqual(["title", "priority", "deadline", "done_criteria"]);
    expect(item.additionalProperties).toBe(false);
    for (const key of item.required) {
      expect(item.properties[key as keyof typeof item.properties].type).toContain("null");
    }
  });

  test("없는 값과 범위를 벗어난 값은 확인 필요로 둔다", () => {
    const drafts = decodeChecklist(
      JSON.stringify({ tasks: [{ title: "  ", priority: 5, deadline: "오후 3시", done_criteria: null }] }),
    );
    expect(drafts[0]).toMatchObject({ title: null, level: null, due: null, doneCriteria: null });
  });

  test("키가 없으면 요청을 보내지 않는다", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect(await kindOf(client(fetchImpl, null).checklist(transcript))).toBe("missingKey");
    expect(called).toBe(false);
  });

  test("상태 코드와 오류 코드로 오류를 구분한다", async () => {
    const cases: [number, unknown, SolarErrorKind][] = [
      [401, errorBody("invalid_api_key"), "unauthorized"],
      [401, errorBody("api_key_is_blocked"), "blocked"],
      [403, errorBody("data_residency_region_mismatch"), "regionMismatch"],
      [403, errorBody("forbidden"), "blocked"],
      [408, "", "timeout"],
      [504, "", "timeout"],
      [429, errorBody("too_many_requests"), "rateLimited"],
      [429, errorBody("usage_limit_exceeded"), "usageLimit"],
      [400, errorBody("invalid_request", "model not found"), "badRequest"],
      [422, "", "badRequest"],
      [500, "", "server"],
      [503, "<html>", "server"],
    ];
    for (const [status, body, kind] of cases) {
      expect(await kindOf(client(stub(status, body)).checklist(transcript)), `${status}`).toBe(kind);
    }
  });

  test("인터넷 끊김과 시간 초과", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await kindOf(client(offline).checklist(transcript))).toBe("offline");

    const timeout = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    expect(await kindOf(client(timeout).checklist(transcript))).toBe("timeout");
  });

  test("잘린 응답과 읽을 수 없는 응답", async () => {
    expect(await kindOf(client(stub(200, completion("{", "length"))).checklist(transcript))).toBe("truncated");
    expect(await kindOf(client(stub(200, completion("체크리스트가 아님"))).checklist(transcript))).toBe("malformed");
    expect(await kindOf(client(stub(200, "not json")).checklist(transcript))).toBe("malformed");
  });

  test("주간보고서를 보내고 답장을 받는다", async () => {
    const content = JSON.stringify({
      subject: "[주간 피드백] 지원서 제출본 저장",
      body: "주간보고서 잘 읽었습니다.\n지원서 최종 검토를 끝낸 점이 좋았습니다.\n\n한정민 드림",
      achievement: "지원서 최종 검토",
    });
    const reply = await client(stub(200, completion(content))).weeklyReply(
      { completed: "지원서 최종 검토", incomplete: "없음", nextGoals: "포트폴리오" },
      "김서울",
    );
    expect(reply.achievement).toBe("지원서 최종 검토");
    expect(await kindOf(client(stub(200, completion(JSON.stringify({ subject: "s", body: " ", achievement: "a" })))).weeklyReply(
      { completed: "a", incomplete: "b", nextGoals: "c" },
      "김서울",
    ))).toBe("malformed");
  });

  test("연결 확인은 응답한 모델 이름을 돌려준다", async () => {
    expect(await client(stub(200, completion("확인"))).ping()).toBe("solar-pro4-250101");
  });

  test("모든 오류에 제목과 안내 문구가 있다", () => {
    const kinds: SolarErrorKind[] = [
      "missingKey", "unauthorized", "blocked", "regionMismatch", "timeout", "offline",
      "rateLimited", "usageLimit", "badRequest", "server", "truncated", "malformed",
    ];
    for (const kind of kinds) {
      const error = new SolarError(kind, { status: 500, message: "x" });
      expect(error.title.length).toBeGreaterThan(0);
      expect(error.guidance.length).toBeGreaterThan(0);
    }
    expect(new SolarError("timeout").canRetry).toBe(true);
    expect(new SolarError("usageLimit").canRetry).toBe(false);
  });

  test("환경변수: 키 하나만 넣으면 나머지는 기본값", () => {
    expect(solarConfigFromEnv({ UPSTAGE_API_KEY: " up_abc " })).toEqual({
      apiKey: "up_abc",
      baseURL: "https://api.upstage.ai/v1",
      model: "solar-pro4",
      timeout: 30,
    });
    expect(solarConfigFromEnv({ UPSTAGE_API_KEY: "", UPSTAGE_TIMEOUT: "1" })).toMatchObject({ apiKey: null, timeout: 30 });
    expect(solarConfigFromEnv({ UPSTAGE_TIMEOUT: "10", UPSTAGE_MODEL: "solar-mini" })).toMatchObject({ timeout: 10, model: "solar-mini" });
    expect(maskKey("up_1234567890abcd")).toBe("up_1…abcd");
  });
});
