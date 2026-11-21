/**
 * 출근 카메라의 자리 판정(맥 앱 SeatKit과 같은 규칙). 화면·카메라와 무관한 순수 로직이라 그대로 시험한다.
 * - 얼굴이 두 번 연속 보이면 seated
 * - seated에서 얼굴을 잠깐 놓쳐도 HOLD_MS 동안은 seated를 유지한다(깜빡임 방지)
 * - 카메라가 켜진 뒤 얼굴이 안 보인 시간(noFaceSeconds)을 센다. 화면은 10초가 넘으면 '카메라 없이 출근'을 띄운다.
 * 영상은 기기 안에서만 쓰고 저장·전송하지 않는다(개정 기획서 5장).
 */

export type SeatCameraState = "idle" | "asking" | "denied" | "unavailable" | "noFace" | "seated";

/** 연속으로 보여야 하는 횟수. */
export const SEEN_TO_SEAT = 2;
/** seated에서 얼굴을 놓쳐도 유지하는 시간. */
export const HOLD_MS = 1500;

export class SeatJudge {
  state: "noFace" | "seated" = "noFace";
  private seenInRow = 0;
  private lastSeenAt: number | null = null;
  /** 얼굴이 안 보이기 시작한 시각. 보이는 동안은 null. 처음에는 카메라를 켠 시각부터 센다. */
  private missSince: number | null;

  constructor(startedAt: number) {
    this.missSince = startedAt;
  }

  /** 검출 결과 하나를 넣고 지금 상태를 돌려준다. */
  observe(faceSeen: boolean, now: number): "noFace" | "seated" {
    if (faceSeen) {
      this.seenInRow += 1;
      this.lastSeenAt = now;
      this.missSince = null;
      if (this.seenInRow >= SEEN_TO_SEAT) this.state = "seated";
    } else {
      this.seenInRow = 0;
      if (this.missSince == null) this.missSince = now;
      if (this.state === "seated" && now - (this.lastSeenAt ?? now) >= HOLD_MS) this.state = "noFace";
    }
    return this.state;
  }

  /** 얼굴이 안 보인 채 이어진 초. seated이거나 지금 보이면 0. */
  noFaceSeconds(now: number): number {
    if (this.state === "seated" || this.missSince == null) return 0;
    return Math.max(0, Math.floor((now - this.missSince) / 1000));
  }
}

/** 카메라를 켜지 못한 이유를 한국어로. getUserMedia 오류 이름 기준. */
export function cameraFailure(error: unknown): { state: "denied" | "unavailable"; reason: string } {
  const name = (error as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { state: "denied", reason: "브라우저에서 카메라 권한을 거부했습니다.\n주소창 옆 카메라 아이콘에서 허용하거나, 카메라 없이 출근할 수 있습니다." };
    case "NotFoundError":
    case "OverconstrainedError":
      return { state: "unavailable", reason: "연결된 카메라를 찾지 못했습니다.\n카메라 없이 출근할 수 있습니다." };
    case "NotReadableError":
    case "AbortError":
      return { state: "unavailable", reason: "다른 앱이 카메라를 쓰고 있어 켜지 못했습니다.\n그 앱을 닫고 다시 시도하거나, 카메라 없이 출근할 수 있습니다." };
    case "DetectorUnavailable":
      return { state: "unavailable", reason: "이 브라우저에서는 얼굴 확인을 쓸 수 없습니다.\n카메라 없이 출근할 수 있습니다." };
    default:
      return { state: "unavailable", reason: "카메라를 켜지 못했습니다.\n카메라 없이 출근할 수 있습니다." };
  }
}
