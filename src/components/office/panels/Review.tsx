"use client";
/**
 * 18:00 퇴근 점검 → (2·3단계가 남으면) 저녁시간·추가근무 → 22:00 종료 → 하루 마무리.
 * 야근·이월이 생길 때는 이유와 고를 수 있는 행동을 함께 보여 준다(현직자 피드백).
 */
import { useState } from "react";
import { Clock, hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, LevelBadge, Notice, PanelHeader, type PlaceId } from "../ui";
import { AttendanceRequests, SeatCard } from "./Desk";
import { TaskList } from "./TaskList";

type Task = OfficeView["state"]["day"]["tasks"][number];
type Reports = Record<string, { reason: string; plan: string }>;

const CHECKOUT_RESULT: Record<string, (r: { count?: number; carried?: number }) => string> = {
  offAllDone: () => "오늘 업무를 모두 끝냈습니다.\n퇴근을 확인했습니다.",
  offWithCarry: (r) => `1단계 ${r.count}건을 다음 근무일로 이월했습니다.\n퇴근을 확인했습니다.`,
  offNoTasks: () => "오늘은 확정한 업무가 없어\n아침 PT 미진행으로 기록했습니다.",
  overtimeAssigned: (r) => `2·3단계 ${r.count}건이 추가근무에 배정됐습니다.\n19:00까지 저녁시간입니다.`,
};

const byIds = (tasks: Task[], ids: string[]) => tasks.filter((t) => ids.includes(t.id));

export function Checkout({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const tasks = view.state.day.tasks;
  const carryTargets = byIds(tasks, view.checkout.carryReportTargetIds);
  const heavy = byIds(tasks, view.checkout.overtimeTargetIds);
  const [reports, setReports] = useState<Reports>({});
  const ready = view.phase.value === "checkoutReview";
  const complete = carryTargets.every((t) => reports[t.id]?.reason.trim() && reports[t.id]?.plan.trim());
  const set = (id: string, key: "reason" | "plan", value: string) =>
    setReports((r) => ({ ...r, [id]: { ...(r[id] ?? { reason: "", plan: "" }), [key]: value } }));

  const submit = async () => {
    const res = await office.act<{ checkout: { kind: string; count?: number; carried?: number } }>("submitCheckout", {
      carryReports: reports,
    });
    if (res?.checkout) office.notify(CHECKOUT_RESULT[res.checkout.kind]?.(res.checkout) ?? "퇴근 점검을 제출했습니다.");
  };

  const label = heavy.length > 0 ? "점검 제출 · 추가근무 배정 받기" : carryTargets.length > 0 ? "이월 보고하고 퇴근" : "퇴근하기";
  return (
    <div className="panel">
      <PanelHeader place="내 책상" title="18:00 퇴근 점검" detail="결과물을 올리고 미완료 업무를 확인합니다." />
      {heavy.length > 0 ? (
        <Notice kind="warning" title={`2·3단계 업무 ${heavy.length}건이 남았습니다`}>
          {"지금 끝내면 바로 퇴근할 수 있습니다.\n그대로 제출하면 18:00~19:00 저녁시간 뒤\n19:00~22:00 추가근무에 배정합니다. 3단계부터 진행합니다."}
        </Notice>
      ) : null}
      {!ready ? <Notice kind="info" title="퇴근 점검은 18:00에 합니다" /> : null}
      <Card title="오늘 업무">
        {tasks.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            오늘은 확정한 업무가 없습니다.
          </p>
        ) : (
          <TaskList office={office} tasks={tasks} editable={view.can.editTasks} />
        )}
      </Card>
      {carryTargets.length > 0 ? (
        <Card title="1단계 이월 보고">
          <p className="muted small" style={{ margin: 0 }}>
            미뤄도 되는 일이지만, 이유와 다음 근무일 계획을 남기면 팀장에게 메일로 보고하고 이월합니다.
          </p>
          {carryTargets.map((t) => (
            <div key={t.id} className="card" style={{ background: "var(--paper)", gap: 8, padding: 12 }}>
              <div className="row">
                <LevelBadge level={t.level} />
                <span style={{ fontWeight: 600 }}>{t.title}</span>
              </div>
              <label className="stack">
                미완료 이유
                <input className="field" value={reports[t.id]?.reason ?? ""} onChange={(e) => set(t.id, "reason", e.target.value)} />
              </label>
              <label className="stack">
                다음 근무일 완료 계획
                <input className="field" value={reports[t.id]?.plan ?? ""} onChange={(e) => set(t.id, "plan", e.target.value)} />
              </label>
            </div>
          ))}
        </Card>
      ) : null}
      <button className="btn" onClick={submit} disabled={office.busy || !ready || !complete}>
        {label}
      </button>
      {ready && !complete ? <div className="small muted">이월 보고의 이유와 계획을 모두 적어 주세요.</div> : null}
    </div>
  );
}

export function Overtime({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const isDinner = view.phase.value === "dinner";
  const tasks = byIds(view.state.day.tasks, view.overtimeTaskIds);
  const remaining = tasks.filter((t) => t.status === "open").length;
  const [confirming, setConfirming] = useState(false);
  const end = async () => {
    const res = await office.act<{ overtime: string }>("endOvertimeEarly");
    setConfirming(false);
    if (res) office.notify(remaining === 0 ? "추가근무를 마쳤습니다.\n퇴근을 확인했습니다." : "보충근무 미이행으로 기록하고\n남은 업무를 이월했습니다.");
  };
  return (
    <div className="panel">
      <PanelHeader
        place="내 책상"
        title={isDinner ? "저녁시간" : "추가근무"}
        detail={isDinner ? "19:00에 추가근무를 시작합니다.\n3단계 업무부터 진행합니다." : "22:00까지 3단계부터 진행합니다."}
      />
      <SeatCard office={office} view={view} />
      <Card title="추가근무 업무" aside={<span className="chip">{`남은 업무 ${remaining}건`}</span>}>
        <TaskList office={office} tasks={tasks} editable={view.can.editTasks} />
      </Card>
      {!isDinner ? <AttendanceRequests office={office} view={view} /> : null}
      {remaining === 0 ? (
        <button className="btn" onClick={end} disabled={office.busy}>
          모두 끝냈습니다 · 추가근무 종료
        </button>
      ) : confirming ? (
        <Notice kind="warning" title="먼저 종료할까요?">
          {`남은 업무 ${remaining}건은 다음 근무일로 이월하고\n보충근무 미이행으로 기록합니다.`}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn danger small" onClick={end} disabled={office.busy}>
              보충근무 미이행으로 기록하고 종료
            </button>
            <button className="btn plain small" onClick={() => setConfirming(false)}>
              계속 하기
            </button>
          </div>
        </Notice>
      ) : (
        <button className="btn plain" onClick={() => setConfirming(true)}>
          남은 업무를 두고 먼저 종료
        </button>
      )}
    </div>
  );
}

export function OvertimeEnd({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const tasks = byIds(view.state.day.tasks, view.overtimeTaskIds);
  const finish = async () => {
    if ((await office.act("submitOvertimeReview")) != null) office.notify("추가근무를 마쳤습니다.\n퇴근을 확인했습니다.");
  };
  return (
    <div className="panel">
      <PanelHeader
        place="내 책상"
        title="22:00 추가근무 종료"
        detail={"완료한 결과물을 올립니다.\n남은 업무는 다음 근무일로 이월합니다."}
      />
      <Card title="추가근무 업무">
        <TaskList office={office} tasks={tasks} editable={view.can.editTasks} />
      </Card>
      <button className="btn" onClick={finish} disabled={office.busy}>
        결과물 올리고 마치기
      </button>
    </div>
  );
}

/** 하루 마무리. 미완료만 강조하지 않고, 완료한 일과 다음 날 계획을 나란히 보여 준다. */
export function DayEnd({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const day = view.state.day;
  const done = day.tasks.filter((t) => t.status === "done");
  const next = view.state.pendingCarry;
  const rows: [string, string, boolean][] = [
    ["출근", day.checkInAt != null ? `${hm(day.checkInAt)} · ${day.isLate ? "지각" : "정시"}` : day.absentCandidate ? "결근 후보" : "기록 없음", day.isLate || day.absentCandidate],
    ["퇴근", day.checkoutAt != null ? hm(day.checkoutAt) : "-", false],
  ];
  if (day.overtime) rows.push(["추가근무", { completed: "완료", ranToEnd: "22:00까지 근무", abandoned: "보충근무 미이행" }[day.overtime], day.overtime === "abandoned"]);
  if (view.attendance.unauthorizedAwayMinutes > 0) rows.push(["근무 중 자리 비움", `${view.attendance.unauthorizedAwayMinutes}분`, true]);
  if (view.attendance.cameraOffMinutes > 0) rows.push(["카메라 꺼짐 (확인 필요)", `${view.attendance.cameraOffMinutes}분`, true]);

  return (
    <div className="panel">
      <PanelHeader place="내 책상" title={day.absentCandidate ? "오늘은 출근 기록이 없습니다" : "오늘 근무를 마쳤습니다"} detail={view.clock.dateLong} />
      <Card title="오늘 기록">
        {rows.map(([k, v, warn]) => (
          <div key={k} className="row" style={{ justifyContent: "space-between", color: warn ? "var(--warn)" : undefined }}>
            <span>{warn ? `! ${k}` : k}</span>
            <span style={{ fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </Card>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <Card title={`해낸 일 ${done.length}건`}>
          {done.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              오늘 완료한 업무가 없습니다.
            </p>
          ) : (
            done.map((t) => (
              <div key={t.id}>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                {t.deliverable ? <div className="small muted">결과물: {t.deliverable}</div> : null}
              </div>
            ))
          )}
        </Card>
        <Card title={`다음 근무일 계획 ${next.length}건`}>
          {next.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              이월한 업무가 없습니다. 내일 아침 PT에서 새로 정합니다.
            </p>
          ) : (
            next.map((t) => (
              <div key={t.id} className="row">
                <LevelBadge level={t.level} />
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                <span className="small muted">마감 {Clock.hm(t.due)}</span>
              </div>
            ))
          )}
        </Card>
      </div>
      {view.can.submitWeekly ? (
        <Notice kind="info" title="오늘은 금요일입니다">
          주간보고서를 직접 써서 올려 주세요.
          <div style={{ marginTop: 8 }}>
            <button className="btn secondary small" onClick={() => onGo("weekly")}>
              주간보고서 쓰기
            </button>
          </div>
        </Notice>
      ) : null}
      <button
        className="btn"
        onClick={async () => {
          if ((await office.act("startNextWorkday")) != null) onGo("door");
        }}
        disabled={office.busy || !view.can.startNextWorkday}
      >
        다음 근무일 시작
      </button>
    </div>
  );
}
