"use client";
/**
 * 출입문 패널의 출근 카메라. 사원증을 찍기 전에 자리에 앉은 얼굴이 보이는지 확인한다(사용자 결정 2026-11-21).
 * 카메라가 없거나 거부하면 reason을 보여 주고 '카메라 없이 출근'으로 넘어갈 수 있다(불이익 없음, 개정 기획서 5장).
 *
 * const cam = useSeatCamera(enabled)
 *   state: idle | asking | denied | unavailable | noFace | seated
 *   videoRef: <video ref>에 붙인다(좌우 반전은 화면 CSS)
 *   reason: denied·unavailable일 때 한국어 이유
 *   noFaceSeconds: 얼굴이 안 보인 채 이어진 초
 *   stream: 켜진 카메라 스트림(미리보기를 하나 더 띄울 때) · retry(): 권한을 다시 요청 / stop(): 카메라를 끈다(출근 버튼을 누를 때)
 * enabled가 false면 카메라를 켜지 않고 idle을 유지한다. 언마운트하면 스트림을 정리한다.
 * intervalMs: 검출 간격(근무 중 착석 확인은 MONITOR_INTERVAL_MS).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { browserDeps, DETECT_INTERVAL_MS, IDLE, SeatCameraController, type SeatCameraDeps, type SeatCameraSnapshot } from "./seatCamera";
import type { SeatCameraState } from "./seatJudge";

export type { SeatCameraState };

export function useSeatCamera(enabled: boolean, deps?: SeatCameraDeps, intervalMs: number = DETECT_INTERVAL_MS) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controller = useRef<SeatCameraController | null>(null);
  const [snapshot, setSnapshot] = useState<SeatCameraSnapshot>(IDLE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(IDLE);
      return;
    }
    const c = new SeatCameraController(deps ?? browserDeps(), () => videoRef.current, setSnapshot, intervalMs);
    controller.current = c;
    void c.start();
    return () => {
      c.stop();
      if (controller.current === c) controller.current = null;
    };
    // deps는 시험용 주입이라 바뀌지 않는다고 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const stop = useCallback(() => controller.current?.stop(), []);

  // 검출이 돌기 시작하면(noFace·seated) 스트림이 있다. 상태가 바뀔 때마다 다시 그리므로 여기서 읽는다.
  const live = snapshot.state === "noFace" || snapshot.state === "seated";
  const stream = live ? (controller.current?.mediaStream ?? null) : null;

  return { ...snapshot, stream, videoRef, retry, stop };
}
