"use client";
/**
 * 내 책상: 착석 상태, 오늘의 체크리스트, 근태 요청(점심·자리 비움), 오늘 기록.
 * 카메라 판정은 AI 담당 작업이라, 지금은 시연용으로 자리 상태를 직접 바꾼다.
 */
import { useState } from "react";
import { hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";
import { TaskList } from "./TaskList";

const AWAY_EXAMPLES = ["물 가지러 자리 비웁니다", "화장실 다녀오겠습니다", "택배 받으러 나갑니다"];

const WARNING_EVENTS = new Set(["late", "absentCandidate", "unauthorizedAwayStart", "cameraOff", "supplementMissed"]);

export function SeatCard({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const allowance = view.activeAllowance;
  const presence = view.state.presence;
  const canObserve = ["working", "overtime"].includes(view.phase.value) && !allowance;
  return (
    <Card title="자리 상태">
      <Notice kind={view.seat.isWarning ? "warning" : "info"} title={view.seat.title}>
        {view.seat.detail}
      </Notice>
      {allowance && allowance.kind !== "dinner" ? (
        <button className="btn secondary" onClick={() => office.act("returnFromAllowance")} disabled={office.busy}>
          {allowance.kind === "lunch" ? "점심 마치고 복귀" : "자리로 복귀"}
        </button>
      ) : null}
      {canObserve ? (
        <>
          <div className="small muted">카메라 없이 시연 중 · 자리 상태를 직접 바꿉니다</div>
          <div className="row" role="group" aria-label="자리 상태 바꾸기">
            {(
              [
                ["present", "자리에 있음"],
                ["absent", "자리 비움"],
                ["cameraOff", "카메라 꺼짐"],
              ] as const
            ).map(([state, label]) => (
              <button
                key={state}
                className={`btn small ${presence === state ? "" : "secondary"}`}
                aria-pressed={presence === state}
                onClick={() => office.act("observePresence", { state })}
                disabled={office.busy}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

export function AttendanceRequests({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const [reason, setReason] = useState("");
  const lunch = async () => {
    if ((await office.act("requestLunch")) != null) office.notify("점심 요청을 보냈습니다.\n1시간 동안 착석 확인을 쉽니다.");
  };
  const away = async () => {
    if ((await office.act("registerAway", { reason })) != null) {
      setReason("");
      office.notify("자리 비움을 등록했습니다.\n15분 동안 착석 확인을 쉽니다.");
    }
  };
  if (!view.can.requestLunch && !view.can.registerAway && view.phase.value !== "working") return null;
  return (
    <Card title="근태 요청">
      {view.phase.value === "working" ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">
            {view.state.day.lunchUsed ? "오늘 점심은 사용했습니다." : "사내 메일로 요청하면 1시간을 받습니다."}
          </span>
          <button className="btn secondary" onClick={lunch} disabled={office.busy || !view.can.requestLunch}>
            점심 요청 메일
          </button>
        </div>
      ) : null}
      <label className="stack">
        자리 비움 사유
        <input
          className="field"
          value={reason}
          placeholder="사유 예: 물 가지러 자리 비웁니다"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="row">
        {AWAY_EXAMPLES.map((ex) => (
          <button key={ex} className="btn plain small" onClick={() => setReason(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <button className="btn secondary" onClick={away} disabled={office.busy || !view.can.registerAway || !reason.trim()}>
        15분 자리 비움 등록
      </button>
      <p className="small muted pre" style={{ margin: 0 }}>
        {"허용 시간 안에는 착석 확인을 쉬고,\n끝난 뒤에도 자리가 비면 근무 중 자리 비움으로 기록합니다."}
      </p>
    </Card>
  );
}

export function TodayLog({ view }: { view: OfficeView }) {
  const events = view.state.day.events.slice(-8).reverse();
  if (events.length === 0) return null;
  return (
    <Card title="오늘 기록">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {events.map((e) => {
          const warn = WARNING_EVENTS.has(e.kind);
          return (
            <li key={e.id} className="row" style={{ flexWrap: "nowrap", color: warn ? "var(--warn)" : undefined }}>
              <span className="small muted" style={{ fontVariantNumeric: "tabular-nums", width: 44, flex: "none" }}>
                {hm(e.at)}
              </span>
              <span>
                {warn ? "! " : ""}
                {e.text}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function Desk({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: "meeting") => void }) {
  const tasks = view.state.day.tasks;
  const done = tasks.filter((t) => t.status === "done").length;
  const phase = view.phase.value;
  return (
    <div className="panel">
      <PanelHeader place="내 책상" title="오늘의 체크리스트" detail={view.phase.headline} />
      {phase !== "beforeCheckIn" ? <SeatCard office={office} view={view} /> : null}
      <Card title="체크리스트" aside={tasks.length ? <span className="chip">{`${done} / ${tasks.length} 완료`}</span> : undefined}>
        {tasks.length === 0 ? (
          <>
            <p className="muted pre" style={{ margin: 0 }}>
              {phase === "beforeCheckIn"
                ? "출근한 뒤 아침 PT에서 오늘 업무를 정합니다."
                : "아직 확정한 업무가 없습니다.\n회의실에서 아침 PT를 진행해 주세요."}
            </p>
            {phase === "morningPT" ? (
              <button className="btn secondary" onClick={() => onGo("meeting")}>
                회의실로 가기
              </button>
            ) : null}
          </>
        ) : (
          <TaskList office={office} tasks={tasks} editable={view.can.editTasks} />
        )}
      </Card>
      <AttendanceRequests office={office} view={view} />
      <TodayLog view={view} />
    </div>
  );
}
