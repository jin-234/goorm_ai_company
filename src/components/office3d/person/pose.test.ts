import { describe, expect, it } from "vitest";
import {
  bodyFor, blinkAt, handAt, HAND_ABOVE_SURFACE, mouseShare, reach, REACH_MAX, SEATED_ROOT_Y,
  type PoseContext, type Vec3,
} from "./pose";

/**
 * 섬 책상(깊이 0.75, 상판 윗면 0.775)에 앉은 사람 기준 키보드·마우스 위치.
 * 책상 가운데는 사람 앞 0.55m, 키보드는 책상 앞 가장자리에서 0.095 안쪽, 마우스는 키보드 +0.32.
 * 사람 원점은 앉은 높이(SEATED_ROOT_Y)라 그만큼 뺀다.
 */
const deskFront = -0.55 + 0.375;
const keyboard: Vec3 = [-0.06, 0.74 + 0.061 - SEATED_ROOT_Y, deskFront - 0.095];
const mouse: Vec3 = [-0.06 + 0.32, 0.74 + 0.07 - SEATED_ROOT_Y, deskFront - 0.085];

const ctx = (phase = 0): PoseContext => ({
  rate: 1, phase, holding: {}, desk: { keyboard, mouse },
  gait: { cycle: 0, amount: 0 }, carriesHandBag: false, sincePoseStart: 5,
});

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("손 닿기", () => {
  it("구한 팔 각도로 손이 목표점에 정확히 간다", () => {
    for (const target of [[0.1, 0.4, -0.2], [-0.2, 0.55, -0.18], [0.25, 0.62, -0.22]] as Vec3[]) {
      for (const side of [-1, 1] as const) {
        const { arm, length } = reach(target, side, -0.2);
        expect(distance(handAt(arm, side, -0.2, length), target)).toBeLessThan(1e-6);
      }
    }
  });

  it("마우스는 팔이 닿는 거리 안에 있다", () => {
    const target: Vec3 = [mouse[0], mouse[1] + HAND_ABOVE_SURFACE, mouse[2]];
    expect(reach(target, 1, -0.2).length).toBeLessThanOrEqual(REACH_MAX);
  });
});

describe("앉아 타자", () => {
  it("양손 타자 때 두 손이 키보드 위 1cm 안에 있다", () => {
    // 오른손이 키보드에 있는 순간을 고른다.
    let t = 0;
    while (mouseShare(t, 0) > 0) t += 0.05;
    const body = bodyFor("sitType", t, ctx());
    const left = handAt(body.left, -1, body.torsoPitch, body.reachL);
    const right = handAt(body.right, 1, body.torsoPitch, body.reachR);
    const top = keyboard[1] + HAND_ABOVE_SURFACE;
    for (const hand of [left, right]) {
      expect(Math.abs(hand[2] - keyboard[2])).toBeLessThan(0.02);
      expect(hand[1] - top).toBeGreaterThan(-0.005);
      expect(hand[1] - top).toBeLessThan(0.02);
      // 키보드 가로 0.46 안
      expect(Math.abs(hand[0] - keyboard[0])).toBeLessThan(0.23);
    }
    expect(left[0]).toBeLessThan(keyboard[0]);
    expect(right[0]).toBeGreaterThan(keyboard[0]);
  });

  it("마우스를 쓰는 동안 오른손은 마우스 위, 왼손은 키보드 위에 있다", () => {
    let t = 0;
    while (mouseShare(t, 0) < 1) t += 0.05;
    const body = bodyFor("sitType", t, ctx());
    const right = handAt(body.right, 1, body.torsoPitch, body.reachR);
    const left = handAt(body.left, -1, body.torsoPitch, body.reachL);
    expect(distance(right, [mouse[0], mouse[1] + HAND_ABOVE_SURFACE, mouse[2]])).toBeLessThan(0.02);
    expect(Math.abs(left[0] - keyboard[0])).toBeLessThan(0.23);
    expect(Math.abs(left[2] - keyboard[2])).toBeLessThan(0.02);
  });

  it("사람마다 마우스를 잡는 때가 다르다", () => {
    const times = Array.from({ length: 200 }, (_, i) => i * 0.1);
    const a = times.map((t) => mouseShare(t, 0));
    const b = times.map((t) => mouseShare(t, 3.1));
    expect(a.some((v, i) => Math.abs(v - b[i]) > 0.5)).toBe(true);
  });

  it("머그를 든 동안 왼손만 키보드 위에 있다", () => {
    const body = bodyFor("sitMug", 1, ctx());
    const left = handAt(body.left, -1, body.torsoPitch, body.reachL);
    expect(Math.abs(left[2] - keyboard[2])).toBeLessThan(0.02);
    const right = handAt(body.right, 1, body.torsoPitch, body.reachR);
    expect(right[1]).toBeGreaterThan(keyboard[1] + 0.05);
  });
});

describe("걷기", () => {
  it("멈춰 있으면 다리를 흔들지 않는다", () => {
    const body = bodyFor("walk", 3, { ...ctx(), gait: { cycle: 1.2, amount: 0 } });
    expect(body.legL).toBe(0);
    expect(body.bounce).toBe(0);
  });
});

describe("눈 깜빡임", () => {
  it("10초 안에 두 번 이상 감고 대부분은 뜨고 있다", () => {
    const samples = Array.from({ length: 1000 }, (_, i) => blinkAt(i * 0.01, 1.7));
    let blinks = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i] > 0.9 && samples[i - 1] <= 0.9) blinks++;
    expect(blinks).toBeGreaterThanOrEqual(2);
    expect(samples.filter((v) => v === 0).length).toBeGreaterThan(900);
  });
});
