"use client";
/**
 * 3D 사무실 확인 페이지(개발용). 서버 없이 가짜 officeView로 그린다.
 * 주소 예: /lab/office3d?t=08:40&speed=0&seat=beforeCheckIn&focus=door
 *  - t: 시각(HH:MM 또는 HH:MM:SS), day: 날짜(YYYY-MM-DD, 기본 2026-11-16 월요일)
 *  - seat: 내 착석 상태(view.seat.kind), reason: 자리 비움 사유, phase: 단계(view.phase.value)
 *  - speed: 시계 빠르기(0 멈춤, 1 실제, 60이면 1초에 1분), focus: overview|door|desk|manager|director|meeting|pantry|restroom
 */
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import type { Focus } from "@/components/office3d/Office3D";
import type { OfficeView } from "@/lib/server/view";

const Office3D = dynamic(() => import("@/components/office3d/Office3D").then((m) => m.Office3D), { ssr: false });

const SEATS = ["beforeCheckIn", "seated", "away", "lunch", "dinner", "unauthorizedAway", "cameraOff", "off"] as const;
const PHASES = ["beforeCheckIn", "morningPT", "working", "overtime", "dayEnded"] as const;
const FOCUSES: Focus[] = ["overview", "door", "desk", "manager", "director", "meeting", "pantry", "restroom"];

function toInstant(day: string, time: string) {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi, s = 0] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d) - 9 * 3600_000 + ((h * 60 + mi) * 60 + s) * 1000;
}

function Lab() {
  const q = useSearchParams();
  const [day] = useState(q.get("day") ?? "2026-11-16");
  const [time, setTime] = useState(q.get("t") ?? "09:30");
  const [seat, setSeat] = useState(q.get("seat") ?? "seated");
  const [reason, setReason] = useState(q.get("reason") ?? "커피 한 잔");
  const [phase, setPhase] = useState(q.get("phase") ?? "working");
  const [speed, setSpeed] = useState(Number(q.get("speed") ?? 1));
  const [focus, setFocus] = useState<Focus>((q.get("focus") as Focus) ?? "overview");
  const [placed, setPlaced] = useState("없음");

  const view = useMemo(
    () => ({ state: { now: toInstant(day, time) }, seat: { kind: seat, reason }, phase: { value: phase } }) as unknown as OfficeView,
    [day, time, seat, reason, phase],
  );

  return (
    <main style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", margin: 0, background: "#F4ECDB", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "10px 16px", fontSize: 15, color: "#2C3032" }}>
        <strong style={{ fontSize: 18 }}>3D 사무실 확인</strong>
        <label>시각 <input type="time" step={1} value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label>빠르기 <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {[0, 1, 10, 60, 300].map((s) => <option key={s} value={s}>{s === 0 ? "멈춤" : `×${s}`}</option>)}
        </select></label>
        <label>내 상태 <select value={seat} onChange={(e) => setSeat(e.target.value)}>{SEATS.map((s) => <option key={s}>{s}</option>)}</select></label>
        {seat === "away" && <label>사유 <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 140 }} /></label>}
        <label>단계 <select value={phase} onChange={(e) => setPhase(e.target.value)}>{PHASES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>구도 <select value={focus} onChange={(e) => setFocus(e.target.value as Focus)}>{FOCUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <span data-testid="placed">누른 곳: {placed}</span>
      </div>
      <div style={{ minHeight: 0 }}>
        <Office3D view={view} speed={speed} focus={focus} onPlace={(p) => setPlaced(p)} />
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
