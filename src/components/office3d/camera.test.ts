import { describe, expect, it } from "vitest";
import { fitShot, projectedBounds } from "./camera";

const OVERVIEW = { target: [0.35, 0.2, 0.25] as [number, number, number], yaw: -33, pitch: 34, distance: 42, fov: 20 };

describe("전체 구도 맞추기", () => {
  // 패널이 열린 캔버스(952×812), 무대 그대로(1440×900), 맥 앱 기준(1600×1000), 아주 넓은 화면, 세로로 긴 화면
  for (const [w, h] of [[952, 812], [1440, 900], [1600, 1000], [2560, 900], [700, 900], [600, 1000]]) {
    it(`${w}×${h}에서 사무실 전체(바닥 테두리·출입문 계단)가 화면 안에 들어오고 가운데 놓인다`, () => {
      const shot = fitShot(OVERVIEW, w / h);
      const b = projectedBounds(shot, w / h);
      expect(b.minX).toBeGreaterThan(-0.95);
      expect(b.maxX).toBeLessThan(0.95);
      expect(b.minY).toBeGreaterThan(-0.95);
      expect(b.maxY).toBeLessThan(0.95);
      // 한쪽은 화면을 꽉 채운다(너무 멀리 물러나지 않음)
      expect(Math.max(b.maxX - b.minX, b.maxY - b.minY)).toBeGreaterThan(1.7);
      expect(Math.abs((b.minX + b.maxX) / 2)).toBeLessThan(0.03);
      expect(shot.yaw).toBe(OVERVIEW.yaw);
      expect(shot.pitch).toBe(OVERVIEW.pitch);
    });
  }
  it("맞추기 전 구도는 패널이 열린 좁은 캔버스에서 잘린다(고치기 전 문제 재현)", () => {
    const b = projectedBounds(OVERVIEW, 952 / 812);
    expect(Math.min(b.minX, -b.maxX)).toBeLessThan(-1);
  });
});
