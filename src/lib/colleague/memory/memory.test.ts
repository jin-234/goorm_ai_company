import { describe, expect, test } from "vitest";
import { SolarClient } from "@/lib/solar/client";
import { emptyNotes, memoryForPrompt, mergeSummary, parseMemory, renderMemory } from "./markdown";
import {
  type Ctx, deleteConversation, editConversation, finishConversation, lastQuestion, listConversations, readMemory, sendMessage,
  startConversation, writeMemory,
} from "./service";
import { MemoryConversationStore } from "./store";

const summary = (over: Partial<Parameters<typeof mergeSummary>[1]> = {}) => ({
  title: "로그인 화면 상태",
  points: ["사원: 로그인 실패 문구를 정함"],
  context: ["로그인 화면을 만들고 있다"],
  decisions: ["실패 문구는 한 줄로"],
  followups: ["비밀번호 찾기 흐름 확인"],
  resolved: [],
  ...over,
});

describe("기억 MD", () => {
  test("그린 MD를 다시 읽으면 같은 내용", () => {
    const notes = mergeSummary(emptyNotes(), summary(), { conversationId: "c1", date: "2026-11-21" });
    const md = renderMemory("designer", notes, "2026-11-21 14:00");
    expect(md).toContain("# 서하늘 디자이너(디자인팀)와의 대화 기억");
    expect(md).toContain("### 2026-11-21 · 로그인 화면 상태 <!-- c:c1 -->");
    const back = parseMemory(md);
    expect(back.context).toEqual(["로그인 화면을 만들고 있다"]);
    expect(back.decisions).toEqual(["실패 문구는 한 줄로"]);
    expect(back.followups).toEqual(["비밀번호 찾기 흐름 확인"]);
    expect(back.log).toEqual([{ conversationId: "c1", date: "2026-11-21", title: "로그인 화면 상태", points: ["사원: 로그인 실패 문구를 정함"] }]);
  });

  test("사용자가 고친 항목과 직접 추가한 절은 합칠 때 살아남는다", () => {
    const md = renderMemory("designer", mergeSummary(emptyNotes(), summary(), { conversationId: "c1", date: "2026-11-21" }), "x")
      .replace("- 로그인 화면을 만들고 있다", "- 로그인·회원가입 화면을 만들고 있다\n- 색은 초록 계열을 좋아한다")
      .replace("## 대화 기록", "## 내 메모\n자유롭게 적은 글\n\n## 대화 기록");
    const merged = mergeSummary(parseMemory(md), summary({ title: "두 번째", context: ["다음 주 발표 예정"], followups: [], resolved: ["비밀번호 찾기 흐름 확인"] }), {
      conversationId: "c2",
      date: "2026-11-22",
    });
    expect(merged.context).toEqual(["다음 주 발표 예정", "로그인·회원가입 화면을 만들고 있다", "색은 초록 계열을 좋아한다"]);
    expect(merged.followups).toEqual([]);
    expect(merged.extra).toContain("## 내 메모");
    expect(merged.log.map((l) => l.conversationId)).toEqual(["c2", "c1"]);
  });

  test("같은 대화를 다시 요약하면 기록 항목을 바꾼다", () => {
    const once = mergeSummary(emptyNotes(), summary(), { conversationId: "c1", date: "d" });
    const twice = mergeSummary(once, summary({ title: "고친 제목" }), { conversationId: "c1", date: "d" });
    expect(twice.log).toHaveLength(1);
    expect(twice.log[0].title).toBe("고친 제목");
  });

  test("프롬프트에 넣을 때 길면 오래된 기록부터 뺀다", () => {
    let notes = emptyNotes();
    for (let i = 0; i < 20; i++) notes = mergeSummary(notes, summary({ title: `대화 ${i}`, points: ["가".repeat(150)] }), { conversationId: `c${i}`, date: "d" });
    const md = renderMemory("pm", notes, "x");
    const short = memoryForPrompt(md, 1500);
    expect(short.length).toBeLessThanOrEqual(1500);
    expect(short).toContain("대화 19");
    expect(short).not.toContain("대화 0\n");
  });
});

function ctxOf(overrides: Partial<Ctx> = {}): Ctx {
  let t = Date.parse("2026-11-21T05:00:00Z");
  return {
    store: new MemoryConversationStore(),
    client: new SolarClient({ apiKey: null, baseURL: "http://x", model: "m", timeout: 5 }),
    officeId: "office-1",
    myName: "김사원",
    mode: "sample",
    now: () => new Date((t += 1000)),
    ...overrides,
  };
}

describe("대화 흐름(예시 응답)", () => {
  test("시작 → 대화 → 마치기 → 다음 대화가 기억을 읽고 이어 간다", async () => {
    const ctx = ctxOf();
    const { conversation: first } = await startConversation(ctx, { participants: ["designer"] });
    expect(first.turns[0].speaker).toBe("designer");
    expect(first.turns[0].text).toContain("오늘은 어떤 이야기");
    expect(first.memoryUsed).toEqual([]);

    const { conversation: after } = await sendMessage(ctx, first.id, "오늘 로그인 화면을 만들었어요.");
    expect(after.turns.map((t) => t.speaker)).toEqual(["designer", "me", "designer"]);
    expect(lastQuestion(after.turns[2].text)).toBe("사용자는 어떤 순서로 화면을 거치나요?");

    const done = await finishConversation(ctx, first.id);
    expect(done.conversation.status).toBe("closed");
    expect(done.conversation.summaryMd).toContain("주요 내용");
    const md = (await readMemory(ctx, "designer")).markdown;
    expect(md).toContain("사원: 오늘 로그인 화면을 만들었어요.");
    // 답하지 못한 질문은 다음에 이어갈 것으로
    expect(parseMemory(md).followups).toEqual(["사용자는 어떤 순서로 화면을 거치나요?"]);

    const { conversation: second } = await startConversation(ctx, { participants: ["designer"] });
    expect(second.memoryUsed).toEqual(["designer"]);
    expect(second.turns[0].text).toContain("지난번에 남겨 둔 이야기부터 이어 갈게요. 사용자는 어떤 순서로 화면을 거치나요?");
  });

  test("동료마다 기억이 따로다", async () => {
    const ctx = ctxOf();
    const { conversation } = await startConversation(ctx, { participants: ["marketer"] });
    await sendMessage(ctx, conversation.id, "신규 가입 기능을 알리고 싶어요.");
    await finishConversation(ctx, conversation.id);
    expect((await readMemory(ctx, "marketer")).markdown).toContain("신규 가입");
    expect((await readMemory(ctx, "leader")).updatedAt).toBe("");
  });

  test("회의: 참여자가 돌아가며 말하고, 마치면 참여자 모두의 기억에 남는다", async () => {
    const ctx = ctxOf();
    const { conversation } = await startConversation(ctx, { participants: ["pm", "designer"], title: "주간 회의" });
    expect(conversation.kind).toBe("meeting");
    const { conversation: c1 } = await sendMessage(ctx, conversation.id, "이번 주 로그인 기능을 끝냈습니다.");
    expect(c1.turns[2].speaker).toBe("designer");
    const { conversation: c2 } = await sendMessage(ctx, conversation.id, "다음 주는 회원가입입니다.");
    expect(c2.turns[4].speaker).toBe("pm");
    await finishConversation(ctx, conversation.id);
    expect((await readMemory(ctx, "pm")).markdown).toContain("### 2026-11-21 · 주간 회의");
    expect((await readMemory(ctx, "designer")).markdown).toContain("### 2026-11-21 · 주간 회의");
  });

  test("기록을 고치고 다시 마치면 기억이 새 내용으로 바뀐다", async () => {
    const ctx = ctxOf();
    const { conversation } = await startConversation(ctx, { participants: ["leader"] });
    const { conversation: c } = await sendMessage(ctx, conversation.id, "오늘은 이력서를 고쳤습니다.");
    await finishConversation(ctx, c.id);
    const mine = c.turns.find((t) => t.speaker === "me")!;
    const edited = await editConversation(ctx, c.id, { title: "이력서 점검", edits: [{ id: mine.id, text: "오늘은 포트폴리오를 고쳤습니다." }] });
    expect(edited.turns.find((t) => t.id === mine.id)).toMatchObject({ text: "오늘은 포트폴리오를 고쳤습니다.", edited: true });
    await finishConversation(ctx, c.id);
    const notes = parseMemory((await readMemory(ctx, "leader")).markdown);
    expect(notes.log).toHaveLength(1);
    expect(notes.log[0].title).toBe("이력서 점검");
    expect(notes.log[0].points.join()).toContain("포트폴리오");
    expect(notes.log[0].points.join()).not.toContain("이력서를");
  });

  test("회의 내용을 손으로 옮겨 적고 요약할 수 있다", async () => {
    const ctx = ctxOf();
    const { conversation } = await startConversation(ctx, { participants: ["pm"], opening: false, title: "킥오프" });
    expect(conversation.turns).toEqual([]);
    await editConversation(ctx, conversation.id, {
      append: [
        { speaker: "pm", text: "출시는 12월 첫 주입니다." },
        { speaker: "me", text: "로그인은 다음 주까지 끝내겠습니다." },
      ],
    });
    await expect(editConversation(ctx, conversation.id, { append: [{ speaker: "designer", text: "끼어들기" }] })).rejects.toThrow("말한 사람");
    const done = await finishConversation(ctx, conversation.id);
    expect(done.memories[0].markdown).toContain("로그인은 다음 주까지");
  });

  test("기록을 지우면 기억 MD의 그 대화 항목도 빠진다", async () => {
    const ctx = ctxOf();
    const { conversation } = await startConversation(ctx, { participants: ["planner"] });
    await sendMessage(ctx, conversation.id, "안내 문구를 정리했어요.");
    await finishConversation(ctx, conversation.id);
    await deleteConversation(ctx, conversation.id);
    expect(await listConversations(ctx)).toEqual([]);
    expect(parseMemory((await readMemory(ctx, "planner")).markdown).log).toEqual([]);
  });

  test("기억 MD를 직접 고치면 다음 대화가 고친 내용을 읽는다", async () => {
    const ctx = ctxOf();
    await writeMemory(ctx, "pm", "# 메모\n\n## 다음에 이어갈 것\n- 출시 일정 확정\n");
    const { conversation } = await startConversation(ctx, { participants: ["pm"] });
    expect(conversation.turns[0].text).toContain("출시 일정 확정");
  });

  test("다른 참여자의 기록은 보이지 않는다", async () => {
    const ctx = ctxOf();
    const { conversation } = await startConversation(ctx, { participants: ["pm"] });
    const other = { ...ctx, officeId: "office-2" };
    await expect(sendMessage(other, conversation.id, "안녕")).rejects.toThrow("찾지 못했습니다");
    expect(await listConversations(other)).toEqual([]);
  });
});

describe("대화 흐름(Solar)", () => {
  function solarCtx(replies: string[]) {
    const bodies: { messages: { role: string; content: string }[] }[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const content = replies.shift() ?? "{}";
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const ctx = ctxOf({ mode: "solar", client: new SolarClient({ apiKey: "k", baseURL: "http://x", model: "m", timeout: 5 }, fetchImpl) });
    return { ctx, bodies };
  }

  test("시작할 때 기억 MD를 시스템 맥락으로 보내고, 판정 표현은 걸러 낸다", async () => {
    const { ctx, bodies } = solarCtx([
      JSON.stringify({ speaker: "leader", text: "지난번 이력서 건은 어떻게 됐나요?" }),
      JSON.stringify({ speaker: "leader", text: "좋아요. 성실도 90점입니다. 다음엔 무엇을 해 볼까요? 언제 할까요?" }),
    ]);
    await writeMemory(ctx, "leader", "## 다음에 이어갈 것\n- 이력서 첫 줄 고치기\n");
    const { conversation } = await startConversation(ctx, { participants: ["leader"] });
    expect(JSON.parse(bodies[0].messages[1].content).colleague_memory.leader).toContain("이력서 첫 줄 고치기");
    expect(conversation.turns[0]).toMatchObject({ source: "solar", text: "지난번 이력서 건은 어떻게 됐나요?" });

    const { conversation: c } = await sendMessage(ctx, conversation.id, "고쳤어요.");
    expect(c.turns[2].text).toBe("좋아요. 다음엔 무엇을 해 볼까요?");
  });

  test("요약의 해결됨은 기억에 있던 항목만 받아 다음에 이어갈 것에서 뺀다", async () => {
    const { ctx } = solarCtx([
      JSON.stringify({ speaker: "leader", text: "이력서 건은요?" }),
      JSON.stringify({ speaker: "leader", text: "잘하셨어요." }),
      JSON.stringify({
        title: "이력서",
        points: ["이력서 첫 줄을 고쳤다"],
        context: [],
        decisions: [],
        followups: ["포트폴리오 링크 정리"],
        resolved: ["이력서 첫 줄 고치기", "없던 항목"],
      }),
    ]);
    await writeMemory(ctx, "leader", "## 다음에 이어갈 것\n- 이력서 첫 줄 고치기\n");
    const { conversation } = await startConversation(ctx, { participants: ["leader"] });
    await sendMessage(ctx, conversation.id, "고쳤어요.");
    const done = await finishConversation(ctx, conversation.id);
    expect(done.summarySource).toBe("solar");
    expect(parseMemory(done.memories[0].markdown).followups).toEqual(["포트폴리오 링크 정리"]);
  });

  test("Solar가 실패해도 내 말은 남고 정해진 질문(manual)으로 이어 간다", async () => {
    const fetchImpl = (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const ctx = ctxOf({ mode: "solar", client: new SolarClient({ apiKey: "k", baseURL: "http://x", model: "m", timeout: 5 }, fetchImpl) });
    const { conversation, solarError } = await startConversation(ctx, { participants: ["pm"] });
    expect(solarError?.kind).toBe("server");
    const { conversation: c } = await sendMessage(ctx, conversation.id, "내 말");
    expect(c.turns.map((t) => t.source)).toEqual(["manual", "user", "manual"]);
  });
});

/** 실제 Postgres가 있을 때만 돈다. 예: TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres npm test */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres 대화 저장소 (TEST_DATABASE_URL)", { timeout: 30_000 }, () => {
  test("대화·기억을 저장하고 고치고 지운다", async () => {
    const { PostgresConversationStore } = await import("./store");
    const store = new PostgresConversationStore(url!);
    const ctx = ctxOf({ store, officeId: crypto.randomUUID() });
    try {
      const { conversation } = await startConversation(ctx, { participants: ["pm", "designer"] });
      await sendMessage(ctx, conversation.id, "로그인 기능을 끝냈습니다.");
      await finishConversation(ctx, conversation.id);
      const loaded = await store.get(ctx.officeId, conversation.id);
      expect(loaded?.turns).toHaveLength(3);
      expect(loaded?.participants).toEqual(["pm", "designer"]);
      expect(loaded?.status).toBe("closed");
      expect((await readMemory(ctx, "pm")).markdown).toContain("로그인 기능");
      await deleteConversation(ctx, conversation.id);
      expect(await store.get(ctx.officeId, conversation.id)).toBeNull();
    } finally {
      await store.removeAll(ctx.officeId);
      await store.close();
    }
  });
});
