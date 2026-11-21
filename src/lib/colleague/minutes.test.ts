import { describe, expect, it } from "vitest";
import { sampleProposal } from "./colleague";
import { minutesFromGoal, TIME_ONLY } from "./minutes";

describe("목표 글의 시간", () => {
  it("시간·분을 읽는다", () => {
    expect(minutesFromGoal("오늘은 3시간 정도 쓸 수 있습니다.")).toBe(180);
    expect(minutesFromGoal("1시간 30분 쓸 수 있어요")).toBe(90);
    expect(minutesFromGoal("90분 정도 쓸 수 있습니다")).toBe(90);
    expect(minutesFromGoal("API 요청을 배우고 싶습니다")).toBeNull();
  });
  it("시간만 말하는 문장은 과제가 아니다", () => {
    expect(TIME_ONLY.test("오늘은 3시간 정도 쓸 수 있습니다")).toBe(true);
    expect(TIME_ONLY.test("3시간 안에 날씨 화면을 만든다")).toBe(false);
    const p = sampleProposal("API 요청을 배우고 도시별 날씨 조회 화면을 만들고 싶습니다. 오늘은 3시간 정도 쓸 수 있습니다.");
    expect(p.tasks.map((t) => t.title)).toEqual(["API 요청을 배우고 도시별 날씨 조회 화면을 만들고 싶습니다"]);
  });
});
