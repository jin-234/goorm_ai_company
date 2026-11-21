"use client";
/**
 * 근무 중 착석 확인 카메라(보통·엄격, 사용자 결정 2026-11-21).
 * 서버가 착석을 확인하는 동안(view.attendance.monitoring: 수행·추가근무 중이고 점심·자리 비움 등록 시간이 아님)
 * 화면 구석에 작은 카메라 창을 띄우고, 얼굴이 보이는지에 따라 자리 상태를 서버에 알린다(observePresence).
 * - 영상은 이 브라우저 안에서만 쓰고 저장·전송하지 않는다. 서버에는 present·absent·cameraOff 값만 간다.
 * - 상태가 바뀔 때만 보낸다. 카메라를 끄거나 쓸 수 없으면 cameraOff(자리 비움으로 세지 않음).
 * - 어느 화면에 있든 돌도록 OfficeApp에 한 번 둔다.
 */
import { useEffect, useRef, useState } from "react";
import type { OfficeView } from "../api";
import { loadMonitorPref, saveMonitorPref } from "../panels/cameraPref";
import type { OfficeHandle } from "../useOffice";
import { ABSENT_AFTER_SECONDS, type Presence, presenceFromCamera } from "./presence";
import { MONITOR_INTERVAL_MS } from "./seatCamera";
import { useSeatCamera } from "./useSeatCamera";

const FAILED_TEXT: Record<"denied" | "unavailable", string> = {
  denied: "카메라 권한이 없어 착석을 확인하지 못합니다.\n주소창 옆 카메라 아이콘에서 허용해 주세요.",
  unavailable: "카메라를 켜지 못했습니다.\n다른 앱이 쓰고 있으면 닫고 다시 켜 주세요.",
};

export function SeatMonitor({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const watching = view.enforcement.rules.seatCheck && view.attendance.monitoring;
  const [on, setOn] = useState(true);
  useEffect(() => setOn(loadMonitorPref()), []);
  const cam = useSeatCamera(watching && on, undefined, MONITOR_INTERVAL_MS);

  const serverPresence = view.attendance.presence;
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

  if (!watching) return null;

  const toggle = () => {
    const next = !on;
    setOn(next);
    saveMonitorPref(next);
    lastSent.current = null;
  };
  const failed = cam.state === "denied" || cam.state === "unavailable";
  const status = !on
    ? "카메라 꺼짐 · 자리 비움으로 세지 않음"
    : failed
      ? "카메라를 쓸 수 없음"
      : cam.state === "seated"
        ? "자리에 있음"
        : cam.state === "noFace"
          ? cam.noFaceSeconds >= ABSENT_AFTER_SECONDS
            ? "자리 비움"
            : "얼굴을 찾는 중"
          : "카메라 켜는 중";

  return (
    <aside className="seat-monitor" aria-label="착석 확인 카메라">
      {on && !failed ? (
        <video ref={cam.videoRef} autoPlay muted playsInline aria-label="착석 확인 카메라 미리보기" />
      ) : null}
      <div className="seat-monitor-body">
        <div className="row" style={{ gap: 6, justifyContent: "space-between" }}>
          <span role="status" className={`chip ${on && cam.state === "seated" ? "" : "warn"}`}>
            {status}
          </span>
          <button className="btn plain small" onClick={toggle}>
            {on ? "끄기" : "켜기"}
          </button>
        </div>
        {on && failed ? (
          <div className="small pre">
            {FAILED_TEXT[cam.state as "denied" | "unavailable"]}
            <div style={{ marginTop: 4 }}>
              <button className="btn secondary small" onClick={cam.retry}>
                다시 켜기
              </button>
            </div>
          </div>
        ) : null}
        <div className="small muted">영상은 이 기기 안에서만 씁니다. 서버에는 자리 상태만 갑니다.</div>
      </div>
    </aside>
  );
}
