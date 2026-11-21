"use client";
/**
 * 관리 강도 화면 부품.
 * - EnforcementPicker: 입사·설정에서 가볍게·보통·엄격을 고른다.
 * - LowerTodayButton: 오늘만 한 단계 낮추기.
 * - AttendanceCard: 보통·엄격의 착석 확인(지금은 버튼)·점심·자리 비움·이번 달 근태.
 * - OvertimePanel: 퇴근 점검 → 저녁시간 → 추가근무 → 추가근무 점검.
 * 규칙은 다시 계산하지 않고 서버가 준 view.enforcement·attendance·overtime·can만 읽는다.
 */
import { useState } from "react";
import type { EnforcementLevel } from "@/lib/office/rules";
import { Clock, hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";
import { TaskWork } from "./TaskList";

type Option = OfficeView["enforcement"]["options"][number];

/** 강도마다 무엇이 기록되는지 짧은 줄로. */
function detailLines(o: Option, start: string, end: string): string[] {
  if (!o.attendance) return ["출근 버튼만 누릅니다", "지각·착석 확인·추가근무 없음", "언제든 마감"];
  return [
    `${start}보다 늦으면 지각, ${end}까지 안 오면 결근 후보`,
    "지각비 예상액 계산(시연용, 청구 안 함)",
    o.strictAway ? "등록하지 않은 자리 비움은 짧아도 경고" : "등록하지 않은 자리 비움이 15분을 넘으면 기록",
    "점심 1시간·자리 비움 15분 등록",
    `${end} 퇴근 점검, 2·3단계가 남으면 추가근무 3시간`,
    ...(o.earlyLeaveReason ? ["마감 시각 전 마감은 사유 필요"] : []),
  ];
}

export function EnforcementPicker({
  options,
  value,
  onChange,
  start,
  end,
  disabled,
}: {
  options: Option[];
  value: EnforcementLevel;
  onChange: (level: EnforcementLevel) => void;
  start: number;
  end: number;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="관리 강도" style={{ display: "grid", gap: 8 }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className="card"
            style={{
              textAlign: "left",
              cursor: disabled ? "default" : "pointer",
              gap: 4,
              padding: 12,
              border: on ? "2px solid var(--green)" : "1px solid var(--line, #ddd)",
              background: on ? "var(--green-soft)" : "var(--paper)",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {on ? "● " : "○ "}
                {o.label}
              </span>
              {o.id === "standard" ? <span className="badge tag">기본</span> : null}
            </div>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {detailLines(o, Clock.hm(start), Clock.hm(end)).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}

export function LowerTodayButton({ office, view, small }: { office: OfficeHandle; view: OfficeView; small?: boolean }) {
  if (!view.can.lowerToday) return null;
  const lower = async () => {
    const next = view.enforcement.chosen === "strict" && view.enforcement.level === "strict" ? "보통" : "가볍게";
    const what = next === "가볍게" ? "오늘은 지각·착석 확인·추가근무 없이 지냅니다." : "오늘은 보통 강도로 지냅니다.";
    if (!window.confirm(`오늘만 관리 강도를 ${next}로 낮출까요?\n${what}\n이미 남은 기록은 그대로이고, 다음 활동일에는 원래 강도로 돌아갑니다.`)) return;
    if ((await office.act("lowerToday")) != null) office.notify(`오늘은 ${next}로 지냅니다.\n무리하지 않아도 괜찮습니다.`);
  };
  return (
    <button className={`btn secondary ${small ? "small" : ""}`} onClick={lower} disabled={office.busy} title="오늘만 관리 강도를 한 단계 낮춥니다.">
      오늘만 한 단계 낮추기
    </button>
  );
}

/** 이번 달 근태 한 줄. 보통·엄격에서만. */
export function MonthLine({ view }: { view: OfficeView }) {
  if (!view.enforcement.rules.lateFee && view.attendance.month.points === 0) return null;
  const m = view.attendance.month;
  return (
    <div className="small muted">
      이번 달 지각 {m.late}회 · 결근 후보 {m.absent}회{m.recovered ? ` · 연속 출근으로 ${m.recovered}점 덜어 냄` : ""} · 누적 {m.points}점 · 지각비 예상{" "}
      {m.estimatedFee.toLocaleString("ko-KR")}원 (시연용, 청구 안 함)
    </div>
  );
}

const PRESENCE_BUTTONS: [OfficeView["attendance"]["presence"], string][] = [
  ["present", "자리에 있음"],
  ["absent", "자리 비움"],
  ["cameraOff", "카메라 꺼짐"],
];

/** 보통·엄격 근무 중 착석 확인과 점심·자리 비움. */
export function AttendanceCard({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const [reason, setReason] = useState("");
  const a = view.attendance;
  const rules = view.enforcement.rules;
  if (!rules.seatCheck) return null;
  const allowance = a.activeAllowance;
  const presence = (state: string) => office.act("observePresence", { state });
  const lunch = async () => {
    if ((await office.act("requestLunch")) != null) office.notify("점심을 승인받았습니다.\n그동안 착석 확인을 쉽니다.");
  };
  const away = async () => {
    if ((await office.act("registerAway", { reason })) != null) {
      setReason("");
      office.notify("자리 비움을 등록했습니다.\n15분 동안 착석 확인을 쉽니다.");
    }
  };

  return (
    <Card title="착석 확인" aside={<span className={`chip ${view.seat.isWarning ? "warn" : ""}`}>{view.seat.title}</span>}>
      {view.seat.isWarning ? (
        <Notice kind="warning" title={view.seat.title}>
          {view.seat.detail}
        </Notice>
      ) : (
        <p className="small muted pre" style={{ margin: 0 }}>
          {view.seat.detail}
        </p>
      )}
      {allowance && allowance.kind !== "dinner" ? (
        <div className="row">
          <span>
            {allowance.kind === "lunch" ? "점심" : `자리 비움 · ${allowance.reason}`} {hm(allowance.start)}~{hm(allowance.end)}
          </span>
          <button className="btn secondary small" onClick={() => office.act("returnFromAllowance")} disabled={office.busy || !view.can.returnFromAllowance}>
            지금 복귀
          </button>
        </div>
      ) : a.monitoring ? (
        <>
          <div className="row" role="group" aria-label="지금 자리 상태 알리기">
            {PRESENCE_BUTTONS.map(([state, label]) => (
              <button
                key={state}
                className={`btn small ${a.presence === state ? "" : "secondary"}`}
                aria-pressed={a.presence === state}
                onClick={() => presence(state)}
                disabled={office.busy}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="small muted">
            지금은 버튼으로 자리 상태를 알립니다. 카메라 판정이 붙어도 영상은 브라우저 안에서만 보고, 서버에는 이 상태 값만 남습니다.
          </div>
        </>
      ) : null}
      {view.can.requestLunch || view.can.registerAway ? (
        <div className="row">
          {view.can.requestLunch ? (
            <button className="btn secondary small" onClick={lunch} disabled={office.busy}>
              점심 요청 (1시간)
            </button>
          ) : null}
          {view.can.registerAway ? (
            <>
              <input className="field" style={{ maxWidth: 200 }} placeholder="자리 비움 사유" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn secondary small" onClick={away} disabled={office.busy || !reason.trim()}>
                자리 비움 등록 (15분)
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {a.unauthorizedAwayMinutes > 0 ? <div className="small muted">오늘 등록하지 않은 자리 비움 {Clock.duration(a.unauthorizedAwayMinutes)}</div> : null}
      <MonthLine view={view} />
    </Card>
  );
}

/** 퇴근 점검·저녁시간·추가근무·추가근무 점검. */
export function OvertimePanel({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const phase = view.phase.value;
  const ot = view.overtime;
  const targets = view.day.tasks.filter((t) => ot.targetIds.includes(t.id));
  const assigned = view.day.tasks.filter((t) => ot.assignedIds.includes(t.id));

  const checkout = async () => {
    const res = await office.act<{ checkout: { kind: string; count?: number } }>("submitCheckout");
    if (!res) return;
    office.notify(
      res.checkout.kind === "overtime"
        ? `2·3단계 과제 ${res.checkout.count}건이 남아 추가근무를 배정했습니다.\n저녁시간 ${ot.dinnerHM} 뒤 ${ot.overtimeHM} 추가근무입니다.`
        : "퇴근 점검을 마쳤습니다.\n회의실 발표와 하루 마감으로 이어 가세요.",
    );
  };
  const end = async () => {
    const early = phase !== "overtimeReview" && assigned.some((t) => ot.targetIds.includes(t.id));
    if (early && !window.confirm("추가근무를 지금 끝낼까요?\n남은 과제가 있어 보충근무 미이행으로 기록됩니다.\n힘든 날이면 '오늘만 한 단계 낮추기'를 쓰면 기록 없이 끝낼 수 있습니다.")) return;
    const res = await office.act<{ overtime: string }>("endOvertime");
    if (res) office.notify(res.overtime === "completed" ? "추가근무를 마쳤습니다.\n회의실 발표와 하루 마감으로 가세요." : "추가근무를 끝냈습니다.\n남은 과제는 하루 마감에서 처리를 고릅니다.");
  };

  const title = { checkout: "퇴근 점검", dinner: "저녁시간", overtime: "추가근무", overtimeReview: "추가근무 점검" }[phase as "checkout"];
  return (
    <div className="panel">
      <PanelHeader place="내 책상" title={title} detail={view.phase.headline} />
      {phase === "checkout" ? (
        <Card title="남은 과제 확인">
          {targets.length > 0 ? (
            <Notice kind="warning" title={`제출하지 않은 2·3단계 과제 ${targets.length}건`}>
              {`퇴근 점검을 제출하면 저녁시간 ${ot.dinnerHM} 뒤 ${ot.overtimeHM} 추가근무를 합니다.\n3단계 과제부터 진행합니다.`}
            </Notice>
          ) : (
            <Notice kind="ok" title="추가근무 대상이 없습니다">
              1단계 과제가 남았다면 하루 마감에서 처리를 고릅니다.
            </Notice>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            지금 결과물을 더 제출한 뒤 점검을 제출해도 됩니다.
          </p>
          <button className="btn" onClick={checkout} disabled={office.busy || !view.can.submitCheckout}>
            퇴근 점검 제출
          </button>
        </Card>
      ) : (
        <Card title={phase === "dinner" ? `저녁시간 ${ot.dinnerHM}` : `추가근무 ${ot.overtimeHM}`}>
          <p className="muted pre" style={{ margin: 0 }}>
            {phase === "dinner"
              ? `${hm(ot.dinnerEnd)}에 추가근무를 시작합니다.\n쉬는 동안 착석 확인을 하지 않습니다.`
              : phase === "overtime"
                ? "배정된 과제를 3단계부터 진행하고 결과물을 제출하세요.\n다 냈으면 추가근무를 마칩니다."
                : "추가근무 시간이 끝났습니다.\n남은 과제는 하루 마감에서 처리를 고릅니다."}
          </p>
          <button className="btn" onClick={end} disabled={office.busy || !view.can.endOvertime}>
            {phase === "overtimeReview" ? "추가근무 점검 제출" : "추가근무 마치기"}
          </button>
        </Card>
      )}
      <div className="row">
        <LowerTodayButton office={office} view={view} />
      </div>
      <Card title={phase === "checkout" ? "오늘 과제" : "추가근무 과제"}>
        <div style={{ display: "grid", gap: 10 }}>
          {(phase === "checkout" ? view.day.tasks : assigned).map((t) => (
            <TaskWork key={t.id} task={t} view={view} office={office} />
          ))}
        </div>
      </Card>
      {phase === "overtime" ? <AttendanceCard office={office} view={view} /> : null}
    </div>
  );
}
