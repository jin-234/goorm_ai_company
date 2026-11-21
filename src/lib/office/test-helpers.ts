import type { TaskInput } from "./models";
import { Office } from "./office";
import { type DayKey, at, makeDay } from "./time";

// 2026-11-16은 월요일이다.
export const monday = makeDay(2026, 11, 16);
export const friday = makeDay(2026, 11, 20);

export function makeOffice(minutes = 8 * 60 + 55, day: DayKey = monday): Office {
  const office = new Office(at(day, minutes));
  office.completeOnboarding({ name: "김서울", targetRole: "프런트엔드 개발", experience: "React 독학 3개월", activityStart: 9 * 60, activityEnd: 18 * 60 });
  return office;
}

/** 개정 기획서 3.2 예시 목표의 과제 두 건. */
export function sampleTasks(): TaskInput[] {
  return [
    { title: "도시별 날씨 조회 화면", completionCriteria: "도시를 입력하면 날씨가 보인다", shareForm: "화면 캡처와 3줄 설명" },
    { title: "fetch로 API 요청 정리", completionCriteria: "요청·응답 흐름을 글로 정리", shareForm: "정리 글" },
  ];
}

/** 출근하고 예시 과제를 확정해 수행을 시작한 상태. */
export function workingOffice(): Office {
  const office = makeOffice();
  office.checkIn();
  office.confirmTasks({ goal: "API 요청을 배우고 도시별 날씨 조회 화면 만들기", tasks: sampleTasks() });
  return office;
}
