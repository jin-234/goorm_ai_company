import { describe, expect, it } from "vitest";
import { COWORKERS, coworkerAt, crewAt, entranceAt, leaveAt, planSummary, type Snapshot } from "./schedule";
import { closestPair, separate } from "./separate";
import { GUESTS, reviewAt, shareArrivalAt, shareEndAt } from "./share";

const day0 = Date.UTC(2026, 10, 16) - 9 * 3600_000;
const at = (h: number, m = 0, s = 0) => day0 + ((h * 60 + m) * 60 + s) * 1000;
const MIN_GAP = 0.45;

/** 한 시각의 모두(동료 + 나 + 손님)를 모아 떼어 놓은 뒤 가장 가까운 두 사람. */
function check(people: Snapshot[], label: string) {
  separate(people);
  const c = closestPair(people);
  expect(c.d, `${label}: ${c.a} ↔ ${c.b}`).toBeGreaterThanOrEqual(MIN_GAP);
}

const coworkers = (t: number, phase = "working") => {
  const crew = crewAt(t, { kind: "seated" }, phase);
  return COWORKERS.map((id) => crew[id].snapshot);
};

describe("캐릭터끼리 겹치지 않는다(0.1초 간격, 두 사람 사이 0.45m 이상)", () => {
  it("아침 출근 시간: 동료들이 가방 메고 들어와 앉는 동안(문 밖 대기하는 나 포함)", () => {
    for (let t = at(8, 5); t < at(8, 55); t += 100) {
      const crew = crewAt(t, { kind: "beforeCheckIn" }, "beforeCheckIn");
      check(Object.values(crew).map((c) => c.snapshot), `출근 ${new Date(t).toISOString()}`);
    }
  });

  it("사원증 찍고 입장하는 나와 이미 출근한 동료", () => {
    const t0 = at(8, 58);
    for (let s = 0; s < 10; s += 0.1) {
      const me = entranceAt(s).snapshot;
      check([...coworkers(t0 + s * 1000, "morningPT"), me], `입장 ${s.toFixed(1)}s`);
    }
  });

  it("커피·물·화장실 다녀오기가 많은 오전 두 시간", () => {
    for (let t = at(9, 20); t < at(11, 20); t += 100) check(coworkers(t), `오전 ${new Date(t).toISOString()}`);
  });

  it("타 부서 공유: 손님 셋이 들어와 앉고 내가 발표하러 가는 동안, 끝나고 한 줄로 나가는 동안", () => {
    const t0 = at(15);
    for (let s = 0; s < 16; s += 0.1) {
      const a = shareArrivalAt(s);
      check([...coworkers(t0 + s * 1000), a.me, ...GUESTS.map((g) => a.guests[g])], `공유 입장 ${s.toFixed(1)}s`);
    }
    const t1 = at(15, 40);
    for (let s = 0; s < 18; s += 0.1) {
      const e = shareEndAt(s);
      check([...coworkers(t1 + s * 1000), e.me, ...GUESTS.map((g) => e.guests[g])], `공유 퇴장 ${s.toFixed(1)}s`);
    }
  });

  it("팀장 사전 보고하러 가는 동안과, 팀장 앞에서 회의실로 가는 동안(손님 입장과 함께)", () => {
    const t0 = at(14, 30);
    for (let s = 0; s < 8; s += 0.1) check([...coworkers(t0 + s * 1000), reviewAt(s).me], `보고하러 ${s.toFixed(1)}s`);
    const t1 = at(14, 40);
    for (let s = 0; s < 16; s += 0.1) {
      const a = shareArrivalAt(s, "report", "designer");
      check([...coworkers(t1 + s * 1000), a.me, ...GUESTS.map((g) => a.guests[g])], `보고 뒤 회의 ${s.toFixed(1)}s`);
    }
  });

  it("퇴근: 내가 짐 챙겨 나가는 동안과 동료들이 퇴근하는 동안", () => {
    const leaves = COWORKERS.map((id) => planSummary(id, day0).leave);
    const t0 = Math.min(...leaves) - 20_000;
    for (let s = 0; s < 12 * 60; s += 0.1) {
      const me = leaveAt(s % 12).snapshot;
      check([...COWORKERS.map((id) => coworkerAt(id, t0 + s * 1000).snapshot), me], `퇴근 ${s.toFixed(1)}s`);
    }
  });
});
