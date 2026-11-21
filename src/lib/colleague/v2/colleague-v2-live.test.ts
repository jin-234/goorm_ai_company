/** 실제 Solar로 회의실 발표 한 바퀴(UPSTAGE_API_KEY가 있을 때만). 응답 시간·반려 횟수·검사 결과를 찍는다. */
import { describe, expect, it } from "vitest";
import { makeOffice } from "@/lib/office/test-helpers";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { advanceShare, speak } from "./engine";
import { rejectReasons } from "./validate";

const live = solarConfigFromEnv();

describe.skipIf(!live.apiKey || process.env.OFFICE_AI_MODE === "sample")("실제 Solar 회의실 발표", { timeout: 300_000 }, () => {
  it("팀장 사전 보고 → 컨펌 → 부서 회의 한 바퀴 → 회의록", async () => {
    const client = new SolarClient(live);
    const office = makeOffice();
    office.checkIn();
    office.confirmTasks({ goal: "날씨 조회 화면 만들기", tasks: [{ title: "날씨 조회 화면", completionCriteria: "도시 입력 시 날씨 표시", shareForm: "3줄 설명" }] });
    office.startSharing("", Math.random);
    const lines = [
      "도시를 입력하면 날씨를 보여주는 화면을 만들었어요.",
      "검색 버튼을 누르면 fetch로 날씨 API를 부르고, 받은 JSON에서 기온과 날씨를 꺼내 화면에 그려요.",
      "서울로만 직접 확인했고, 잘못 친 도시는 아직 확인 못 했어요.",
    ];
    const log: string[] = [];
    for (const text of lines) {
      if (office.day.share.stage !== "review") break;
      const { lowered } = office.recordUserTurn(text);
      const t0 = Date.now();
      const r = await advanceShare(office, client, { lowered });
      log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.source} ${r.turns.map((t) => `${t.dept}:${t.meetingRole} "${t.reply?.question || t.reply?.confirm?.decision || ""}"`).join(" / ")}`);
    }
    if (office.day.share.stage === "review") {
      office.recordUserTurn("오늘은 여기까지 설명할게요.");
      await advanceShare(office, client);
    }
    expect(office.day.share.stage).toBe("confirm");
    office.enterMeeting();
    const meetingLines = [
      "도시별 날씨 조회 화면을 만들었고, 검색하면 결과를 카드로 보여줘요.",
      "결과가 없으면 지금은 빈 화면이에요. 안내 문구는 아직 없어요.",
      "출근 전에 날씨를 빨리 보고 싶은 사람이 제일 먼저 쓸 것 같아요.",
      "다음에는 실패 안내와 최근 검색 기록을 넣고 싶어요.",
    ];
    for (const text of meetingLines) {
      if (office.day.share.stage !== "meeting") break;
      const { lowered } = office.recordUserTurn(text);
      const t0 = Date.now();
      const r = await advanceShare(office, client, { lowered });
      log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.source} ${r.turns.map((t) => `${t.dept}:${t.meetingRole} "${t.reply?.question || ""}" 용어=${t.reply?.terms_used.map((x) => x.term).join(",")} 근거=${t.reply?.basis.type}`).join(" / ")}`);
    }
    console.log(log.join("\n"));
    const share = office.day.share;
    console.log("단계:", share.stage, "· 회의록:", share.minutes?.folder, "AI 요약:", share.minutes?.aiSummarized);
    expect(share.turns.filter((t) => t.role === "colleague").every((t) => t.source === "solar")).toBe(true);
    if (share.minutes) console.log(share.minutes.files[0].markdown.slice(0, 600));
  });

  it("검사 통과율: 디자이너 ask 5회(반려·재요청 횟수)", async () => {
    const client = new SolarClient(live);
    let firstPass = 0;
    let finalPass = 0;
    for (let i = 0; i < 5; i++) {
      const office = makeOffice();
      office.checkIn();
      office.confirmTasks({ tasks: [{ title: "할 일 목록", completionCriteria: "추가·삭제", shareForm: "" }] });
      office.startSharing("", Math.random);
      office.enterMeeting();
      office.day.share.meeting!.curveballDept = null;
      office.recordUserTurn("할 일 목록 화면을 만들었어요. 할 일을 적고 추가를 누르면 목록 아래에 붙고, 삭제 버튼으로 지울 수 있어요.");
      const p = office.day.share.meeting!.participants[0];
      const r = await speak(office, client, { dept: p.dept, persona: p.personaId, meetingRole: "ask", curveball: false });
      if (r.rejected.length === 0) firstPass++;
      if (!r.rejectedTwice) finalPass++;
      console.log(`#${i + 1} 반려:${r.rejected.join(" | ") || "없음"} · 최종:${r.rejectedTwice ? "고쳐서 씀" : "통과"} · 질문: ${r.reply.question}`);
      expect(rejectReasons(r.reply, { dept: p.dept, meetingRole: "ask", userTexts: [office.day.share.turns.at(-1)!.text!], usedLenses: [], usedQuestionTypes: [], curveball: false, usedCurveballs: [] }).filter((x) => x.includes("물음표"))).toEqual([]);
    }
    console.log(`첫 응답 통과 ${firstPass}/5 · 재요청 뒤 통과 ${finalPass}/5`);
  });
});
