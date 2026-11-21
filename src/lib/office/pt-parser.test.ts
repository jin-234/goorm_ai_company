import { describe, expect, test } from "vitest";
import { missingFields } from "./models";
import { actionPhrase, deadline, parse, sentences } from "./pt-parser";

/** 기획서의 발표 양식 예시. */
const sample = `3단계 필수 업무는 지원서 최종 검토입니다. 오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다.
2단계 당일 업무는 포트폴리오 한 문단 초안입니다. 오후 5시까지 문단을 쓰겠습니다.
1단계 이월 가능 업무는 관심 기업 세 곳 저장입니다. 퇴근 전까지 링크를 모으겠습니다.`;

describe("아침 PT 규칙 읽기 (Solar 미연결 시)", () => {
  test("기획서 예시가 올바른 칸에 들어간다", () => {
    const drafts = parse(sample);
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => [d.title, d.level, d.due, d.doneCriteria])).toEqual([
      ["지원서 최종 검토", 3, 15 * 60, "오탈자를 확인하고 제출본을 저장"],
      ["포트폴리오 한 문단 초안", 2, 17 * 60, "문단을 쓰기"],
      ["관심 기업 세 곳 저장", 1, 18 * 60, "링크를 모으기"],
    ]);
    expect(drafts.every((d) => missingFields(d).length === 0)).toBe(true);
  });

  test("마침표 없는 음성 전사도 읽는다", () => {
    const spoken =
      "삼 단계 필수 업무는 지원서 최종 검토입니다 오후 세 시까지 오탈자를 확인하고 제출본을 저장하겠습니다 이 단계 당일 업무는 포트폴리오 한 문단 초안입니다 오후 다섯 시까지 문단을 쓰겠습니다 일 단계 이월 가능 업무는 관심 기업 세 곳 저장입니다 퇴근 전까지 링크를 모으겠습니다";
    const drafts = parse(spoken);
    expect(drafts.map((d) => d.title)).toEqual(["지원서 최종 검토", "포트폴리오 한 문단 초안", "관심 기업 세 곳 저장"]);
    expect(drafts.map((d) => d.level)).toEqual([3, 2, 1]);
    expect(drafts.map((d) => d.due)).toEqual([15 * 60, 17 * 60, 18 * 60]);
    expect(drafts[0].doneCriteria).toBe("오탈자를 확인하고 제출본을 저장");
  });

  test("낮은 단계부터 말해도 높은 단계가 위로 온다", () => {
    const drafts = parse("1단계 업무는 링크 정리입니다. 3단계 업무는 지원서 제출입니다. 오전 11시까지 제출하겠습니다.");
    expect(drafts.map((d) => d.level)).toEqual([3, 1]);
    expect(drafts[0].title).toBe("지원서 제출");
    expect(drafts[0].due).toBe(11 * 60);
    expect(drafts[0].doneCriteria).toBe("제출");
  });

  test("전사문에 없는 값은 비워 둔다", () => {
    const drafts = parse("2단계 당일 업무는 자격증 기출 풀이입니다.");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("자격증 기출 풀이");
    expect(drafts[0].level).toBe(2);
    expect(drafts[0].due).toBeNull();
    expect(drafts[0].doneCriteria).toBeNull();
    expect(missingFields(drafts[0])).toEqual(["마감", "완료 기준"]);
  });

  test("단계를 말하지 않으면 중요도를 추측하지 않는다", () => {
    const drafts = parse("안녕하세요. 오늘은 이력서 사진을 바꾸겠습니다. 오후 4시까지 자기소개서 초안을 쓰겠습니다. 감사합니다.");
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.level == null)).toBe(true);
    expect(drafts[0].title).toBe("오늘은 이력서 사진을 바꾸기");
    expect(drafts[1].title).toBe("자기소개서 초안을 쓰기");
    expect(drafts[1].due).toBe(16 * 60);
  });

  test("순서를 안내하는 말은 업무가 아니다", () => {
    const drafts = parse(
      "3단계부터 1단계 순서로 말씀드리겠습니다. 3단계 필수 업무는 면접 답변 정리입니다. 오후 2시까지 다섯 문항을 쓰겠습니다.",
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("면접 답변 정리");
    expect(drafts[0].due).toBe(14 * 60);
    expect(drafts[0].doneCriteria).toBe("다섯 문항을 쓰기");
  });

  test("여러 가지 마감 표현", () => {
    const due = (text: string) => deadline(text, 18 * 60)?.minutes ?? null;
    expect(due("오후 3시까지 끝냅니다")).toBe(15 * 60);
    expect(due("오후 3시 30분까지")).toBe(15 * 60 + 30);
    expect(due("세 시 반까지")).toBe(15 * 60 + 30);
    expect(due("오전 10시까지")).toBe(10 * 60);
    expect(due("11시까지")).toBe(11 * 60);
    expect(due("4시까지")).toBe(16 * 60);
    expect(due("15시까지")).toBe(15 * 60);
    expect(due("15:30까지")).toBe(15 * 60 + 30);
    expect(due("저녁 7시 전에")).toBe(19 * 60);
    expect(due("낮 12시까지")).toBe(12 * 60);
    expect(due("퇴근 전까지")).toBe(18 * 60);
    expect(due("오늘 안에")).toBe(18 * 60);
    expect(due("점심 전까지")).toBe(12 * 60);
    expect(due("오전 중으로")).toBe(12 * 60);
    expect(due("3시간 동안 풀겠습니다")).toBeNull();
    expect(due("문단을 쓰겠습니다")).toBeNull();
  });

  test("하겠다는 말을 완료 기준 문구로", () => {
    expect(actionPhrase("오탈자를 확인하고 제출본을 저장하겠습니다.")).toBe("오탈자를 확인하고 제출본을 저장");
    expect(actionPhrase("문단을 쓰겠습니다")).toBe("문단을 쓰기");
    expect(actionPhrase("링크를 모으겠습니다")).toBe("링크를 모으기");
    expect(actionPhrase("정리를 하겠습니다")).toBe("정리를 하기");
    expect(actionPhrase("메일을 보내도록 하겠습니다")).toBe("메일을 보내기");
    expect(actionPhrase("세 문제를 풀 예정입니다")).toBe("세 문제를 풀 예정입니다");
    expect(actionPhrase("제출할 예정입니다")).toBe("제출");
    expect(actionPhrase("초안 완성")).toBe("초안 완성");
  });

  test("빈 전사문", () => {
    expect(parse("")).toHaveLength(0);
    expect(parse("   \n ")).toHaveLength(0);
    expect(parse("안녕하세요. 감사합니다.")).toHaveLength(0);
  });

  test("문장 나누기", () => {
    expect(sentences("첫 문장입니다. 둘째 문장입니다.셋째")).toEqual(["첫 문장입니다", "둘째 문장입니다", "셋째"]);
    expect(sentences("교재 3.5장을 읽겠습니다")).toEqual(["교재 3.5장을 읽겠습니다"]);
    expect(sentences("검토입니다 오후 3시까지 저장하겠습니다")).toEqual(["검토입니다", "오후 3시까지 저장하겠습니다"]);
  });
});
