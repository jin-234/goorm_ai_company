/**
 * 리포트 → 엑셀 시트. 날짜별 상세 활동·상태·근거·다음 행동을 표로 남긴다(개발기획서 3.3).
 * PDF는 대표 활동을 보여 주고, 엑셀은 같은 선택 범위의 원문을 자르지 않고 모두 담는다.
 */
import { type Report, REVIEW_LABELS, reviewValue, SUBMISSION_KIND_LABEL } from "./records";
import { buildXlsx, type Sheet } from "./xlsx";

export function reportSheets(report: Report): Sheet[] {
  const o = report.options;
  const sheets: Sheet[] = [];

  sheets.push({
    name: "날짜별 요약",
    widths: [12, 10, 10, 40, 8, 8, 8, 40],
    rows: [
      ["날짜", "마감", "활동 인정", "오늘 목표", "과제", "마친 과제", "설명 횟수", "다음 행동"],
      ...report.days.map((d) => [
        d.date,
        d.closed ? "마감함" : "마감 전",
        d.counted ? "인정" : "미인정",
        d.goal,
        String(d.tasks.length),
        String(d.tasks.filter((t) => t.done).length),
        String(d.explanationCount),
        d.review?.next_action ?? "",
      ]),
    ],
  });

  const taskHead = ["날짜", "과제", "완료 기준", "상태", "마감 처리", "이월 횟수", "처음 확정한 날", "결과물 수"];
  if (o.incompleteReasons) taskHead.push("미완료 사유");
  sheets.push({
    name: "과제",
    widths: [12, 30, 36, 10, 16, 9, 14, 9, 30],
    rows: [
      taskHead,
      ...report.days.flatMap((d) =>
        d.tasks.map((t) => {
          const row = [d.date, t.title, t.completionCriteria, t.statusLabel, t.outcomeLabel ?? "", String(t.carryCount), t.carriedFrom ?? "", String(t.submissionCount)];
          if (o.incompleteReasons) row.push(t.outcomeReason);
          return row;
        }),
      ),
    ],
  });

  if (o.submissions) {
    sheets.push({
      name: "결과물",
      widths: [12, 28, 8, 70, 20],
      rows: [
        ["날짜", "과제", "종류", "내용", "서비스가 읽은 범위"],
        ...report.days.flatMap((d) =>
          d.submissions.map((s) => [d.date, s.taskTitle, SUBMISSION_KIND_LABEL[s.kind], s.content, s.readScope === "read" ? "붙여 넣은 내용을 읽음" : "주소만 기록(본문 읽지 않음)"]),
        ),
      ],
    });
  }

  if (o.questions) {
    sheets.push({
      name: "타 부서 질문",
      widths: [12, 14, 44, 34, 56, 14],
      rows: [
        ["날짜", "부서", "질문", "물은 이유", "내 답", "응답 출처"],
        ...report.days.flatMap((d) =>
          d.questions.map((q) => [d.date, q.department, q.question, q.reason, q.answer, q.source === "sample" ? "예시 응답(AI 연결 전)" : q.source === "solar" ? "AI" : ""]),
        ),
      ],
    });
  }

  if (o.revisions) {
    sheets.push({
      name: "수정 이력",
      widths: [12, 30, 50],
      rows: [["날짜", "과제", "내용"], ...report.days.flatMap((d) => d.revisions.map((r) => [d.date, r.taskTitle, r.text]))],
    });
  }

  if (o.review) {
    sheets.push({
      name: "마감 요약",
      widths: [12, ...REVIEW_LABELS.map(() => 32)],
      rows: [
        ["날짜", ...REVIEW_LABELS.map(([, label]) => label)],
        ...report.days.filter((d) => d.review).map((d) => [d.date, ...REVIEW_LABELS.map(([k]) => (d.review ? reviewValue(d.review, k) : ""))]),
      ],
    });
  }

  sheets.push({ name: "읽을 때", widths: [100], rows: [["이 기록을 읽을 때"], ...report.limits.map((l) => [l])] });
  return sheets;
}

export const reportXlsx = (report: Report): Uint8Array => buildXlsx(reportSheets(report));
