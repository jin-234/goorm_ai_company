import { describe, expect, it } from "vitest";
import { BLOCKERS, route, SEATS, SPOTS, type Spot, type Vec2 } from "./layout";
import { COWORKERS, coworkerAt, crewAt, dayStart, meAt, planSummary } from "./schedule";

// 2026-11-16(월)~20(금) 한국 시각 자정.
const DAYS = [16, 17, 18, 19, 20].map((d) => Date.UTC(2026, 10, d) - 9 * 3600_000);
const at = (day0: number, h: number, m = 0, s = 0) => day0 + ((h * 60 + m) * 60 + s) * 1000;

/** 하루를 step초 간격으로 훑는다. */
function* sweep(day0: number, from: number, to: number, stepSeconds: number) {
  for (let t = at(day0, from); t < at(day0, to); t += stepSeconds * 1000) yield t;
}

const insideBlocker = ([x, z]: Vec2, margin = 0.12) =>
  BLOCKERS.find(({ box: [x0, z0, x1, z1] }) => x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin);

describe("동료의 하루", () => {
  it("8시 전엔 아무도 없고, 8시 55분엔 모두 자리에 앉아 있다", () => {
    for (const day0 of DAYS) {
      for (const id of COWORKERS) {
        expect(coworkerAt(id, at(day0, 7, 50)).snapshot.visible).toBe(false);
        const s = coworkerAt(id, at(day0, 8, 55)).snapshot;
        expect(s.visible, `${id} 8:55`).toBe(true);
        expect(["sitType", "sitMug"]).toContain(s.pose);
      }
    }
  });

  it("출근길엔 가방을 메고 걸어 들어오고, 앉은 뒤엔 가방이 의자 옆에 있다", () => {
    for (const day0 of DAYS) {
      for (const id of COWORKERS) {
        const { arrive } = planSummary(id, day0);
        const walking = coworkerAt(id, arrive + 4000);
        expect(walking.snapshot.pose).toBe("walk");
        expect(walking.snapshot.holding.bag).toBe("worn");
        expect(walking.desk.bagAtDesk).toBe(false);
        expect(coworkerAt(id, arrive + 60_000).desk.bagAtDesk).toBe(true);
      }
    }
  });

  it("퇴근할 땐 짐을 챙겨 가방을 들고 나가고, 나간 뒤엔 의자 옆 가방도 없다", () => {
    for (const day0 of DAYS) {
      for (const id of COWORKERS) {
        const { leave } = planSummary(id, day0);
        const packing = coworkerAt(id, leave + 1000);
        expect(packing.snapshot.pose).toBe("packUp");
        expect(packing.snapshot.holding.bag).toBe("carried");
        const going = coworkerAt(id, leave + 6000);
        expect(going.snapshot.pose).toBe("walk");
        expect(going.snapshot.holding.bag).toBe("worn");
        expect(going.desk.bagAtDesk).toBe(false);
        expect(coworkerAt(id, leave + 120_000).snapshot.visible).toBe(false);
      }
    }
  });

  it("머그는 늘 한 개: 손에 들면 책상 위 머그는 사라지고, 내려놓으면 다시 보인다", () => {
    for (const day0 of DAYS.slice(0, 2)) {
      for (const t of sweep(day0, 8, 22, 5)) {
        for (const id of COWORKERS) {
          const { snapshot, desk } = coworkerAt(id, t);
          const inHand = snapshot.holding.cup === "mug" || snapshot.pose === "sitMug" || snapshot.pose === "standMug";
          expect(desk.mugOnDesk, `${id} ${new Date(t).toISOString()} ${snapshot.doing}`).toBe(!inHand);
        }
      }
    }
  });

  it("커피는 자기 머그로, 물은 정수기 종이컵으로 마신다", () => {
    const seen = { coffeeMug: 0, waterPaper: 0, restroom: 0 };
    for (const day0 of DAYS) {
      for (const t of sweep(day0, 9, 18, 2)) {
        for (const id of COWORKERS) {
          const s = coworkerAt(id, t).snapshot;
          if (s.doing === "커피 받기") { expect(s.holding.cup).toBe("mug"); seen.coffeeMug++; }
          if (s.doing === "종이컵에 물 받기" || s.doing === "물 마시기") { expect(s.holding.cup).toBe("paper"); seen.waterPaper++; }
          if (s.doing === "화장실") seen.restroom++;
        }
      }
    }
    expect(seen.coffeeMug).toBeGreaterThan(20);
    expect(seen.waterPaper).toBeGreaterThan(20);
    expect(seen.restroom).toBeGreaterThan(20);
  });

  it("한 사람이 하루에 여러 번(10번 넘게) 자리를 잠깐 비운다", () => {
    for (const id of COWORKERS) {
      let trips = 0;
      let wasSeated = true;
      for (const t of sweep(DAYS[0], 9, 17, 3)) {
        const s = coworkerAt(id, t).snapshot;
        const seated = s.pose === "sitType" || s.pose === "sitMug";
        if (wasSeated && s.pose === "walk") trips++;
        wasSeated = seated;
      }
      expect(trips, id).toBeGreaterThan(10);
    }
  });

  it("커피 기계·정수기·창가·화장실은 한 번에 한 사람만 쓴다", () => {
    for (const day0 of DAYS) {
      for (const t of sweep(day0, 9, 22, 2)) {
        const users: Record<string, string[]> = {};
        for (const id of COWORKERS) {
          const d = coworkerAt(id, t).snapshot.doing;
          const spot = d === "커피 받기" ? "coffee" : d.includes("물 받기") || d === "물 마시기" ? "water" : d === "화장실" ? "restroom" : d === "기지개" ? "window" : null;
          if (spot) (users[spot] ??= []).push(id);
        }
        for (const [spot, list] of Object.entries(users)) expect(list.length, `${spot} ${list}`).toBe(1);
      }
    }
  });

  it("걷는 길은 벽과 가구를 지나지 않는다", () => {
    const spots = Object.keys(SPOTS) as Spot[];
    for (const id of Object.keys(SEATS) as (keyof typeof SEATS)[]) {
      for (const spot of spots) {
        const path = route({ seat: id }, { spot });
        for (let i = 1; i < path.length; i++) {
          const [a, b] = [path[i - 1], path[i]];
          const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05);
          for (let k = 0; k <= n; k++) {
            const p: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
            // 자기 책상 바로 옆(일어선 자리)은 책상 상자와 맞닿으니 처음 0.6m는 빼고 본다.
            if (i === 1 && Math.hypot(p[0] - path[0][0], p[1] - path[0][1]) < 0.6) continue;
            const hit = insideBlocker(p);
            expect(hit?.name, `${id}→${spot} (${p[0].toFixed(2)}, ${p[1].toFixed(2)})`).toBeUndefined();
          }
        }
      }
    }
  });

  it("같은 시각이면 언제 물어도 같은 장면(시계를 건너뛰어도 그대로)", () => {
    const t = at(DAYS[2], 14, 37, 12);
    const a = JSON.stringify(crewAt(t, { kind: "seated" }, "working"));
    coworkerAt("peerA", at(DAYS[3], 10));
    expect(JSON.stringify(crewAt(t, { kind: "seated" }, "working"))).toBe(a);
    expect(dayStart(t)).toBe(DAYS[2]);
  });

  it("출근 전 문 밖에 서 있는 나와 드나드는 동료가 겹치지 않는다", () => {
    for (const day0 of DAYS) {
      for (const t of sweep(day0, 8, 9, 1)) {
        const crew = crewAt(t, { kind: "beforeCheckIn" }, "beforeCheckIn");
        const me = crew.me.snapshot.position;
        for (const id of COWORKERS) {
          const s = crew[id].snapshot;
          if (!s.visible) continue;
          expect(Math.hypot(s.position[0] - me[0], s.position[2] - me[2]), id).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it("아침 PT 중엔 청중 넷이 회의실 의자에 앉아 듣는다", () => {
    const crew = crewAt(at(DAYS[0], 9, 2), { kind: "seated" }, "morningPT");
    for (const id of ["director", "manager", "kwajang", "daeri"] as const) {
      expect(crew[id].snapshot.pose).toBe("sitListen");
      expect(crew[id].snapshot.position[0]).toBeLessThan(-3);
    }
    expect(crew.me.snapshot.pose).toBe("present");
  });
});

describe("나", () => {
  const t = at(DAYS[0], 10, 30);
  it("출근 전엔 가방을 메고 문 밖에 서 있다", () => {
    const me = meAt(at(DAYS[0], 8, 55), { kind: "beforeCheckIn" }, "beforeCheckIn");
    expect(me.snapshot.holding.bag).toBe("worn");
    expect(me.snapshot.position[2]).toBeGreaterThan(5);
    expect(me.desk.bagAtDesk).toBe(false);
  });
  it("커피 사유로 자리를 비우면 자기 머그를 들고 커피 자리에 있고 책상 머그는 사라진다", () => {
    const me = meAt(t, { kind: "away", reason: "커피 한 잔" }, "working");
    expect(me.snapshot.holding.cup).toBe("mug");
    expect(me.desk.mugOnDesk).toBe(false);
  });
  it("물 사유면 정수기 종이컵, 책상 머그는 그대로", () => {
    const me = meAt(t, { kind: "away", reason: "물 가지러 자리 비웁니다" }, "working");
    expect(me.snapshot.holding.cup).toBe("paper");
    expect(me.desk.mugOnDesk).toBe(true);
  });
  it("점심 중엔 보이지 않고 가방은 의자 옆에 남는다", () => {
    const me = meAt(t, { kind: "lunch" }, "working");
    expect(me.snapshot.visible).toBe(false);
    expect(me.desk.bagAtDesk).toBe(true);
  });
});
