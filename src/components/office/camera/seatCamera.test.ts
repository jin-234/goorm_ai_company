import { describe, expect, it } from "vitest";
import { DETECT_INTERVAL_MS, type FaceDetectorLike, SeatCameraController, type SeatCameraDeps, type SeatCameraSnapshot } from "./seatCamera";
import { cameraFailure, HOLD_MS, SeatJudge } from "./seatJudge";

describe("자리 판정(SeatJudge)", () => {
  it("두 번 연속 보여야 seated", () => {
    const j = new SeatJudge(0);
    expect(j.observe(true, 250)).toBe("noFace");
    expect(j.observe(false, 500)).toBe("noFace");
    expect(j.observe(true, 750)).toBe("noFace");
    expect(j.observe(true, 1000)).toBe("seated");
  });

  it("seated에서 잠깐 놓쳐도 1.5초 동안 유지하고, 넘으면 noFace", () => {
    const j = new SeatJudge(0);
    j.observe(true, 0);
    j.observe(true, 250);
    expect(j.observe(false, 500)).toBe("seated");
    expect(j.observe(false, 250 + HOLD_MS - 1)).toBe("seated");
    expect(j.observe(true, 1800)).toBe("seated"); // 다시 보이면 이어진다
    expect(j.observe(false, 1800 + HOLD_MS)).toBe("noFace");
  });

  it("앉은 얼굴이 확인되지 않은 시간을 세고, 한 번 스친 오검출로는 다시 세지 않는다", () => {
    const j = new SeatJudge(0);
    j.observe(false, 4000);
    expect(j.noFaceSeconds(10_500)).toBe(10);
    j.observe(true, 11_000); // 한 번만 보임(가짜 카메라 무늬에서 실제로 나온 오검출)
    j.observe(false, 11_250);
    expect(j.noFaceSeconds(11_250)).toBe(11);
    j.observe(true, 12_000);
    j.observe(true, 12_250); // 두 번 연속 → seated
    expect(j.noFaceSeconds(12_250)).toBe(0);
    j.observe(false, 12_250 + HOLD_MS); // 1.5초 지나 풀림 → 그때부터 센다
    expect(j.noFaceSeconds(12_250 + HOLD_MS + 3000)).toBe(3);
  });
});

describe("카메라를 켜지 못한 이유", () => {
  it("권한 거부는 denied, 카메라 없음·사용 중·검출기 없음은 unavailable", () => {
    expect(cameraFailure({ name: "NotAllowedError" }).state).toBe("denied");
    expect(cameraFailure({ name: "NotFoundError" }).state).toBe("unavailable");
    expect(cameraFailure({ name: "NotReadableError" }).reason).toContain("다른 앱");
    expect(cameraFailure({ name: "DetectorUnavailable" }).reason).toContain("카메라 없이 출근");
  });
});

// MARK: - 제어(가짜 카메라·가짜 검출기)

function setup(opts: { getUserMedia?: SeatCameraDeps["getUserMedia"]; faces?: boolean[]; detectorFails?: boolean } = {}) {
  let now = 0;
  const stopped: string[] = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push("video") }] } as unknown as MediaStream;
  const video = { srcObject: null as unknown, muted: false, readyState: 4, play: async () => {} } as unknown as HTMLVideoElement;
  const faces = [...(opts.faces ?? [])];
  let closed = false;
  const detector: FaceDetectorLike = { hasFace: () => faces.shift() ?? false, close: () => (closed = true) };
  const intervals: unknown[] = [];
  const deps: SeatCameraDeps = {
    getUserMedia: opts.getUserMedia === undefined ? async () => stream : opts.getUserMedia,
    loadDetector: async () => {
      if (opts.detectorFails) throw Object.assign(new Error("x"), { name: "DetectorUnavailable" });
      return detector;
    },
    now: () => now,
    setInterval: () => intervals.push("timer"),
    clearInterval: () => intervals.pop(),
  };
  const seen: SeatCameraSnapshot[] = [];
  const c = new SeatCameraController(deps, () => video, (s) => seen.push(s));
  const step = async () => {
    now += DETECT_INTERVAL_MS;
    await c.tick();
  };
  return { c, step, seen, video, stream, stopped, intervals, isClosed: () => closed };
}

describe("출근 카메라 제어", () => {
  it("asking → noFace → 두 번 연속 보이면 seated, 영상은 video에만 붙인다", async () => {
    const t = setup({ faces: [false, true, true] });
    await t.c.start();
    expect(t.seen.map((s) => s.state)).toEqual(["asking", "noFace"]);
    await t.step();
    await t.step();
    expect(t.c.current.state).toBe("noFace");
    await t.step();
    expect(t.c.current.state).toBe("seated");
    expect(t.video.srcObject).toBe(t.stream);
  });

  it("권한을 거부하면 denied와 한국어 이유", async () => {
    const t = setup({ getUserMedia: async () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })) });
    await t.c.start();
    expect(t.c.current).toMatchObject({ state: "denied", reason: expect.stringContaining("권한") });
  });

  it("카메라 API가 없거나 검출기를 못 쓰면 unavailable이고 카메라를 끈다", async () => {
    const none = setup({ getUserMedia: null });
    await none.c.start();
    expect(none.c.current.state).toBe("unavailable");

    const t = setup({ detectorFails: true });
    await t.c.start();
    expect(t.c.current.state).toBe("unavailable");
    expect(t.stopped).toEqual(["video"]);
  });

  it("stop하면 트랙·검출기·타이머를 정리하고 idle, 늦게 온 검출 결과는 무시한다", async () => {
    const t = setup({ faces: [true, true] });
    await t.c.start();
    await t.step();
    t.c.stop();
    await t.step();
    expect(t.c.current.state).toBe("idle");
    expect(t.stopped).toEqual(["video"]);
    expect(t.isClosed()).toBe(true);
    expect(t.intervals).toHaveLength(0);
    expect(t.video.srcObject).toBeNull();
  });

  it("얼굴이 계속 안 보이면 noFaceSeconds가 늘어난다(10초 넘으면 화면이 '카메라 없이 출근'을 띄움)", async () => {
    const t = setup({ faces: Array(48).fill(false) });
    await t.c.start();
    for (let i = 0; i < 44; i++) await t.step();
    expect(t.c.current.state).toBe("noFace");
    expect(t.c.current.noFaceSeconds).toBeGreaterThanOrEqual(10);
  });
});
