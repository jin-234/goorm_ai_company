"use client";
/**
 * 3D 사무실 확인 페이지(개발용). 서버 없이 가짜 officeView로 그린다.
 * 주소 예: /lab/office3d?t=08:40&speed=0&phase=beforeCheckIn
 *  - t: 시각(HH:MM 또는 HH:MM:SS), day: 날짜(YYYY-MM-DD, 기본 2026-11-16 월요일)
 *  - phase: 단계(view.phase.value). 화면용 새 모양(view.clock.now·view.profile·view.day)으로 넘긴다.
 *  - speed: 시계 빠르기(0 멈춤, 1 실제, 60이면 1초에 1분), focus: overview|door|desk|manager|director|meeting|share|pantry|restroom
 *  - start, end: 사용자가 정한 활동 시작·마감(HH:MM, 기본 09:00·18:00)
 *  - bare=1: 위 도구 막대를 숨긴다(맥 앱 그림과 같은 크기로 비교할 때).
 *  - phase=beforeCheckIn이면 문 앞 클로즈업. '출근' 버튼을 누르면 입장 연출이 나온다.
 */
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import type { Focus, Office3DView } from "@/components/office3d/Office3D";

const Office3D = dynamic(() => import("@/components/office3d/Office3D").then((m) => m.Office3D), { ssr: false });

const PHASES = ["beforeCheckIn", "morningPT", "working", "sharing", "checkoutReview", "off"] as const;
const FOCUSES: Focus[] = ["overview", "door", "desk", "manager", "director", "meeting", "share", "pantry", "restroom"];

function toInstant(day: string, time: string) {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi, s = 0] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d) - 9 * 3600_000 + ((h * 60 + mi) * 60 + s) * 1000;
}

function Lab() {
  const q = useSearchParams();
  const [day] = useState(q.get("day") ?? "2026-11-16");
  const [time, setTime] = useState(q.get("t") ?? "09:30");
  const [phase, setPhase] = useState(q.get("phase") ?? "working");
  const [speed, setSpeed] = useState(Number(q.get("speed") ?? 1));
  const [focus, setFocus] = useState<Focus>((q.get("focus") as Focus) ?? "overview");
  const [placed, setPlaced] = useState("없음");
  const [entered, setEntered] = useState("아직");
  const [left, setLeft] = useState("아직");
  const [start] = useState(q.get("start") ?? "09:00");
  const [end] = useState(q.get("end") ?? "18:00");
  const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

  const view = useMemo(
    () => ({
      clock: { now: toInstant(day, time) },
      profile: { name: "김서울", activityStart: toMin(start), activityEnd: toMin(end) },
      day: {
        checkInAt: phase === "beforeCheckIn" ? null : toInstant(day, time),
        tasks: q.get("notasks") ? [] : [
          { title: "로그인 화면 오류 메시지 정리", status: "submitted" },
          { title: "회원가입 폼 검증 붙이기", status: "in_progress" },
          { title: "README 실행 방법 보강", status: "confirmed" },
        ],
      },
      phase: { value: phase },
    }) satisfies Office3DView,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day, time, phase, start, end],
  );

  return (
    <main style={{ display: "grid", gridTemplateRows: q.get("bare") ? "1fr" : "auto 1fr", height: "100vh", margin: 0, background: "#F4ECDB", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: q.get("bare") ? "none" : "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "10px 16px", fontSize: 15, color: "#2C3032" }}>
        <strong style={{ fontSize: 18 }}>3D 사무실 확인</strong>
        <label>시각 <input type="time" step={1} value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label>빠르기 <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {[0, 1, 10, 60, 300].map((s) => <option key={s} value={s}>{s === 0 ? "멈춤" : `×${s}`}</option>)}
        </select></label>
        <label>단계 <select value={phase} onChange={(e) => setPhase(e.target.value)}>{PHASES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>구도 <select value={focus} onChange={(e) => setFocus(e.target.value as Focus)}>{FOCUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        {phase === "beforeCheckIn" && (
          <button type="button" data-testid="checkin" onClick={() => { setPhase("morningPT"); setEntered("연출 중"); }}>출근(사원증 찍기)</button>
        )}
        {phase === "checkoutReview" && (
          <button type="button" data-testid="leave" onClick={() => { setPhase("off"); setLeft("연출 중"); }}>하루 마감 확정</button>
        )}
        <span data-testid="left">퇴근 연출: {left}</span>
        <span data-testid="placed">누른 곳: {placed}</span>
        <span data-testid="entered">입장 연출: {entered}</span>
      </div>
      <div style={{ minHeight: 0 }}>
        <Office3D view={view} speed={speed} focus={focus} onPlace={(p) => setPlaced(p)} onEntranceEnd={() => setEntered("끝남")} onLeaveEnd={() => setLeft("끝남")} />
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Lab />
    </Suspense>
  );
}
