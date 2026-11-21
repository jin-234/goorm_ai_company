/** 기록 내보내기: 고른 날짜·항목만 담기, 개인 사유 기본 제외, 입력을 HTML·수식으로 실행하지 않기. */
import { describe, expect, test } from "vitest";
import { type ColleagueReply, emptyReview } from "../office/models";
import type { Office } from "../office/office";
import { workingOffice } from "../office/test-helpers";
import { buildReport, defaultExportOptions, exportFileName, recordsPayloadOf } from "./records";
import { reportHtml, safeUrl } from "./report-html";
import { reportSheets, reportXlsx } from "./report-xlsx";
import { columnName, crc32, xmlText } from "./xlsx";

const reply = (question: string): ColleagueReply => ({
  department: "designer",
  persona_id: "P_des_B",
  acknowledgement: "고맙습니다.",
  feedback: null,
  question,
  question_reason: question ? "사용자 안내 문구를 정해야 해서요." : "",
  anchor_quote: "",
  lens_id: "",
  question_type: "",
  bank_id: "",
  basis: { type: "role_reasoning", source_ids: [], note: "" },
  understanding_check: null,
  difficulty: 2,
  known_facts: [],
  open_questions: [],
  evidence_refs: [],
  term_explain: null,
  terms_used: [],
  can_finish: !question,
});

/** v2: 사용자 말은 recordUserTurn, 동료 발언은 서버(/api/office/share)가 남기므로 시험에서는 직접 넣는다. */
const colleagueSays = (office: Office, r: ColleagueReply) =>
  office.day.share.turns.push({ id: crypto.randomUUID(), at: office.now, role: "colleague", stage: "meeting", dept: "designer", meetingRole: "ask", reply: r, source: "sample" });

/** 첫날: 과제 1 제출(링크·글 두 번), 과제 2 이월(사유 적음), 질문 하나에 답, 마감 확정 → 둘째 날 출근. */
function twoDays() {
  const office = workingOffice();
  const [a, b] = office.day.tasks;
  office.submitWork(a.id, "link", "https://github.com/me/weather");
  office.submitWork(a.id, "text", "=HYPERLINK(\"http://evil\")<script>alert(1)</script>");
  office.setTaskStatus(a.id, "submitted");
  office.startSharing();
  office.recordUserTurn("날씨 화면을 만들었습니다.");
  colleagueSays(office, reply("실패하면 무엇이 보이나요?"));
  office.recordUserTurn("아직 안내 문구가 없습니다.");
  colleagueSays(office, reply(""));
  office.endSharing("done");
  office.confirmReview({ ...emptyReview(), reported_work: "날씨 화면", next_action: "실패 안내 추가" }, { [b.id]: "carryOver" }, { [b.id]: "몸이 안 좋았음" });
  office.startNextWorkday();
  office.checkIn();
  return office;
}

describe("내보낼 활동일", () => {
  test("출근한 지난날과 오늘을 날짜 순으로 담고, 질문과 그 다음 내 답을 짝짓는다", () => {
    const payload = recordsPayloadOf(twoDays());
    expect(payload.days.map((d) => d.isToday)).toEqual([false, true]);
    const first = payload.days[0];
    expect(first).toMatchObject({ closed: true, counted: true, explanationCount: 2 });
    expect(first.questions).toEqual([
      expect.objectContaining({ department: "디자인팀", question: "실패하면 무엇이 보이나요?", answer: "아직 안내 문구가 없습니다.", source: "sample" }),
    ]);
    expect(first.tasks[0]).toMatchObject({ done: true, submissionCount: 2 });
  });

  test("기본 선택은 마감한 날이고 미완료 사유는 넣지 않는다", () => {
    const payload = recordsPayloadOf(twoDays());
    const options = defaultExportOptions(payload.days);
    expect(options.dates).toEqual([payload.days[0].date]);
    expect(options.incompleteReasons).toBe(false);
    const report = buildReport(payload, options);
    expect(report.days[0].tasks[1].outcomeReason).toBe("");
    expect(reportHtml(report)).not.toContain("몸이 안 좋았음");
    expect(reportSheets(report).find((s) => s.name === "과제")?.rows[0]).not.toContain("미완료 사유");

    const withReason = buildReport(payload, { ...options, incompleteReasons: true });
    expect(reportHtml(withReason)).toContain("몸이 안 좋았음");
  });

  test("끈 항목은 빠지고, 수정 이력과 근거 한계를 남긴다", () => {
    const payload = recordsPayloadOf(twoDays());
    const report = buildReport(payload, { ...defaultExportOptions(payload.days), questions: false, submissions: false });
    expect(report.days[0].questions).toEqual([]);
    expect(report.days[0].submissions).toEqual([]);
    expect(report.days[0].revisions.map((r) => r.text)).toEqual(expect.arrayContaining([expect.stringContaining("2번 제출"), "미완료 처리: 다음 활동일로 이월"]));
    const full = buildReport(payload, defaultExportOptions(payload.days));
    expect(full.limits.join("\n")).toMatch(/역량 인증서나 경력 증명이 아닙니다/);
    expect(full.limits.join("\n")).toMatch(/링크 본문을 읽지 않았습니다/);
    expect(full.limits.join("\n")).toMatch(/예시 응답/);
    expect(exportFileName(full)).toBe(`VISION_COMPANY_활동기록_김서울_${payload.days[0].date}`);
  });
});

describe("PDF(인쇄 HTML)", () => {
  test("입력은 글자로 넣고 http(s) 링크만 누를 수 있다", () => {
    const payload = recordsPayloadOf(twoDays());
    const html = reportHtml(buildReport(payload, defaultExportOptions(payload.days)));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<a href="https://github.com/me/weather">');
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://a.b/c d")).toBeNull();
  });

  test("고른 날이 없으면 안내만 보인다", () => {
    const payload = recordsPayloadOf(twoDays());
    expect(reportHtml(buildReport(payload, { ...defaultExportOptions(payload.days), dates: [] }))).toContain("하나 이상 골라");
  });
});

describe("엑셀", () => {
  test("모든 칸을 글자(inlineStr)로 넣어 수식으로 실행되지 않는다", () => {
    const payload = recordsPayloadOf(twoDays());
    const bytes = reportXlsx(buildReport(payload, defaultExportOptions(payload.days)));
    const text = new TextDecoder().decode(bytes);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).not.toMatch(/<f>/);
    expect(text).toContain("=HYPERLINK(&quot;http://evil&quot;)&lt;script&gt;");
  });

  test("zip·셀 도우미", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
    expect(xmlText("a\u0001<b>&")).toBe("a&lt;b&gt;&amp;");
  });
});
