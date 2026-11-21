"use client";
/**
 * 근무 중 착석 확인 카메라(보통·엄격, 사용자 결정 2026-11-21).
 * 서버가 착석을 확인하는 동안(view.attendance.monitoring: 수행·추가근무 중이고 점심·자리 비움 등록 시간이 아님)
 * 얼굴이 보이는지에 따라 자리 상태를 서버에 알린다(observePresence, 바뀔 때만).
 * - SeatMonitorProvider: OfficeApp 전체를 감싸, 어느 화면에 있든 판정이 이어진다(판정용 영상은 보이지 않게 둔다).
 * - SeatCameraPreview: 착석 확인 카드 안의 작은 카메라 화면과 인식 상태(같은 스트림을 하나 더 보여 준다).
 * 영상은 이 브라우저 안에서만 쓰고 저장·전송하지 않는다. 서버에는 present·absent·cameraOff 값만 간다.
 * 카메라를 끄거나 쓸 수 없으면 cameraOff(자리 비움으로 세지 않음).
 */
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { OfficeView } from "../api";
import { loadMonitorPref, saveMonitorPref } from "../panels/cameraPref";
import type { OfficeHandle } from "../useOffice";
import { ABSENT_AFTER_SECONDS, type Presence, presenceFromCamera } from "./presence";
import { MONITOR_INTERVAL_MS, type SeatCameraSnapshot } from "./seatCamera";
import { useSeatCamera } from "./useSeatCamera";

interface SeatMonitorValue {
  watching: boolean;
  on: boolean;
  toggle: () => void;
  cam: SeatCameraSnapshot & { stream: MediaStream | null; retry: () => void };
}

const SeatMonitorContext = createContext<SeatMonitorValue | null>(null);

export function SeatMonitorProvider({ office, view, children }: { office: OfficeHandle; view: OfficeView | null; children: ReactNode }) {
  const watching = !!view && view.onboarded && view.enforcement.rules.seatCheck && view.attendance.monitoring;
  const [on, setOn] = useState(true);
  useEffect(() => setOn(loadMonitorPref()), []);
  const cam = useSeatCamera(watching && on, undefined, MONITOR_INTERVAL_MS);

  const serverPresence = view?.attendance.presence ?? "unknown";
  const lastSent = useRef<Presence | null>(null);
  const { save } = office;

  // 감시가 끝나면(점심·마감 등) 다음에 다시 켤 때 처음부터 보낸다.
  useEffect(() => {
    if (!watching) lastSent.current = null;
  }, [watching]);

  useEffect(() => {
    if (!watching) return;
    const previous = serverPresence === "unknown" ? null : (serverPresence as Presence);
    const next = on ? presenceFromCamera({ state: cam.state, noFaceSeconds: cam.noFaceSeconds }, previous) : "cameraOff";
    if (next == null || next === serverPresence || next === lastSent.current) return;
    lastSent.current = next;
    void save("observePresence", { state: next });
  }, [watching, on, cam.state, cam.noFaceSeconds, serverPresence, save]);

  const toggle = () => {
    const next = !on;
    setOn(next);
    saveMonitorPref(next);
    lastSent.current = null;
  };

  return (
    <SeatMonitorContext.Provider value={{ watching, on, toggle, cam }}>
      {children}
      {watching && on ? (
        // 판정용 영상. 화면에는 보이지 않지만 재생은 이어져야 해서 display:none 대신 아주 작게 투명하게 둔다.
        <video ref={cam.videoRef} autoPlay muted playsInline aria-hidden tabIndex={-1} className="seat-detect-video" />
      ) : null}
    </SeatMonitorContext.Provider>
  );
}

const FAILED_TEXT: Record<"denied" | "unavailable", string> = {
  denied: "카메라 권한이 없어 착석을 확인하지 못합니다.\n주소창 옆 카메라 아이콘에서 허용해 주세요.",
  unavailable: "카메라를 켜지 못했습니다.\n다른 앱이 쓰고 있으면 닫고 다시 켜 주세요.",
};

/** 착석 확인 카드 안의 작은 카메라 화면과 지금 인식 상태. */
export function SeatCameraPreview() {
  const m = useContext(SeatMonitorContext);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stream = m?.cam.stream ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (stream) void video.play?.()?.catch?.(() => {});
  }, [stream]);

  if (!m || !m.watching) return null;
  const { on, cam, toggle } = m;
  const failed = cam.state === "denied" || cam.state === "unavailable";
  const status = !on
    ? { text: "카메라 꺼짐", detail: "자리 비움으로 세지 않습니다.", ok: false }
    : failed
      ? { text: "카메라를 쓸 수 없음", detail: FAILED_TEXT[cam.state as "denied" | "unavailable"], ok: false }
      : cam.state === "seated"
        ? { text: "인식 중 · 자리에 있음", detail: "얼굴이 보입니다.", ok: true }
        : cam.state === "noFace"
          ? cam.noFaceSeconds >= ABSENT_AFTER_SECONDS
            ? { text: "인식 중 · 자리 비움", detail: `얼굴이 ${cam.noFaceSeconds}초째 보이지 않습니다.`, ok: false }
            : { text: "인식 중 · 얼굴 찾는 중", detail: `${ABSENT_AFTER_SECONDS}초 넘게 안 보이면 자리 비움으로 알립니다.`, ok: false }
          : { text: "카메라 켜는 중", detail: "브라우저가 카메라 권한을 물으면 허용해 주세요.", ok: false };

  return (
    <div className="seat-preview">
      <div className={`seat-preview-frame ${status.ok ? "ok" : ""}`}>
        {on && !failed ? <video ref={videoRef} autoPlay muted playsInline aria-label="착석 확인 카메라 미리보기" /> : <span aria-hidden>카메라 꺼짐</span>}
        {on && !failed && (cam.state === "seated" || cam.state === "noFace") ? <span className="seat-preview-rec" aria-hidden /> : null}
      </div>
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <span role="status" className={`chip ${status.ok ? "" : "warn"}`} style={{ justifySelf: "start" }}>
          {status.text}
        </span>
        <div className="small muted pre">{status.detail}</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn secondary small" onClick={toggle}>
            {on ? "카메라 끄기" : "카메라 켜기"}
          </button>
          {on && failed ? (
            <button className="btn plain small" onClick={cam.retry}>
              다시 켜기
            </button>
          ) : null}
        </div>
        <div className="small muted">영상은 이 기기 안에서만 씁니다. 서버에는 자리 상태만 갑니다.</div>
      </div>
    </div>
  );
}
