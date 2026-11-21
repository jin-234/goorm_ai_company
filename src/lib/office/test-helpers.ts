import { newDraft, type TaskDraft, type TaskLevel, type WorkTask } from "./models";
import { Office } from "./office";
import { type DayKey, at, hm, makeDay } from "./time";

// 2026-11-16은 월요일이다.
export const monday = makeDay(2026, 11, 16);
export const friday = makeDay(2026, 11, 20);

export function makeOffice(minutes = 8 * 60 + 55, day: DayKey = monday): Office {
  const office = new Office(at(day, minutes));
  office.completeOnboarding("김서울");
  return office;
}

/** 기획서 예시 PT의 업무 세 건. */
export function sampleDrafts(): TaskDraft[] {
  return [
    newDraft({ title: "지원서 최종 검토", level: 3, due: 15 * 60, doneCriteria: "오탈자를 확인하고 제출본을 저장" }),
    newDraft({ title: "포트폴리오 한 문단 초안", level: 2, due: 17 * 60, doneCriteria: "문단을 쓰기" }),
    newDraft({ title: "관심 기업 세 곳 저장", level: 1, due: 18 * 60, doneCriteria: "링크를 모으기" }),
  ];
}

/** 출근하고 예시 업무를 확정해 근무를 시작한 상태. */
export function workingOffice(): Office {
  const office = makeOffice();
  office.checkIn();
  office.replaceDrafts(sampleDrafts(), "manual");
  office.confirmTasks();
  return office;
}

export function task(office: Office, level: TaskLevel): WorkTask {
  return office.day.tasks.find((t) => t.level === level)!;
}

/** 근무를 시작한 뒤 퇴근 점검(18:00)까지 보낸다. `done` 단계의 업무는 끝낸 것으로 한다. */
export function officeAtCheckout(done: TaskLevel[]): Office {
  const office = workingOffice();
  office.advance(at(monday, 16 * 60));
  for (const level of done) {
    office.setTask(task(office, level).id, true);
    office.setDeliverable(task(office, level).id, "결과물 메모");
  }
  while (office.canSkipHour) office.skipHour();
  if (office.day.phase !== "checkoutReview" || hm(office.now) !== "18:00") throw new Error("퇴근 점검에 닿지 못함");
  return office;
}
