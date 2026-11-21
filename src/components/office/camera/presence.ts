/**
 * 근무 중 착석 확인: 카메라 판정 → 서버에 알릴 자리 상태(observePresence). 화면과 무관한 순수 로직이라 그대로 시험한다.
 * - 얼굴이 확인되면(seated) present
 * - 얼굴이 ABSENT_AFTER_SECONDS 넘게 안 보이면 absent. 그 전에는 앞 상태를 유지한다(고개를 돌리거나 잠깐 일어난 것은 세지 않는다)
 * - 권한 거부·카메라 없음이면 cameraOff(서버는 자리 비움으로 세지 않는다)
 * - 카메라를 켜는 중(idle·asking)에는 아직 모른다(null)
 * 영상은 기기 안에서만 쓰고, 서버에는 이 상태 값만 간다.
 */
import type { SeatCameraSnapshot } from "./seatCamera";

export type Presence = "present" | "absent" | "cameraOff";

/** 얼굴이 이만큼(초) 이어서 안 보이면 자리 비움으로 알린다. */
export const ABSENT_AFTER_SECONDS = 20;

export function presenceFromCamera(cam: Pick<SeatCameraSnapshot, "state" | "noFaceSeconds">, previous: Presence | null): Presence | null {
  switch (cam.state) {
    case "seated":
      return "present";
    case "noFace":
      return cam.noFaceSeconds >= ABSENT_AFTER_SECONDS ? "absent" : previous;
    case "denied":
    case "unavailable":
      return "cameraOff";
    default:
      return null;
  }
}
