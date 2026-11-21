import { describe, expect, it } from "vitest";
import { ABSENT_AFTER_SECONDS, presenceFromCamera } from "./presence";

describe("근무 중 착석 확인: 카메라 판정 → 자리 상태", () => {
  it("얼굴이 확인되면 자리에 있음", () => {
    expect(presenceFromCamera({ state: "seated", noFaceSeconds: 0 }, null)).toBe("present");
    expect(presenceFromCamera({ state: "seated", noFaceSeconds: 0 }, "absent")).toBe("present");
  });

  it(`얼굴이 ${ABSENT_AFTER_SECONDS}초 넘게 안 보여야 자리 비움, 그 전에는 앞 상태를 유지한다`, () => {
    expect(presenceFromCamera({ state: "noFace", noFaceSeconds: ABSENT_AFTER_SECONDS - 1 }, "present")).toBe("present");
    expect(presenceFromCamera({ state: "noFace", noFaceSeconds: 3 }, null)).toBeNull();
    expect(presenceFromCamera({ state: "noFace", noFaceSeconds: ABSENT_AFTER_SECONDS }, "present")).toBe("absent");
  });

  it("권한 거부·카메라 없음은 카메라 꺼짐(자리 비움이 아니다)", () => {
    expect(presenceFromCamera({ state: "denied", noFaceSeconds: 0 }, "present")).toBe("cameraOff");
    expect(presenceFromCamera({ state: "unavailable", noFaceSeconds: 0 }, null)).toBe("cameraOff");
  });

  it("카메라를 켜는 중에는 아직 보내지 않는다", () => {
    expect(presenceFromCamera({ state: "idle", noFaceSeconds: 0 }, "present")).toBeNull();
    expect(presenceFromCamera({ state: "asking", noFaceSeconds: 0 }, null)).toBeNull();
  });
});
