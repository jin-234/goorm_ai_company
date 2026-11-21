"use client";
/**
 * 내 책상 · 수행과 결과물 제출(개정 기획서 3.1).
 * 확정한 과제마다 시작 → 결과물 남기기 → 제출 완료(또는 오늘은 못 끝냄). 다 되면 회의실에서 타 부서에 발표한다.
 */
import { Clock, hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader, type PlaceId } from "../ui";
import { AttendanceCard, LowerTodayButton } from "./Enforcement";
import { TaskWork } from "./TaskList";

export function Desk({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const { tasks } = view.day;
  const phase = view.phase.value;
  const submitted = tasks.filter((t) => t.status === "submitted").length;
  const handled = tasks.filter((t) => t.status === "submitted" || t.status === "incomplete").length;

  const blockedBy = view.can.earlyLeaveBlockedBy;

  /** 보통·엄격에서 마감 시각 전에 넘어갈 때: 한 번 확인(보통) 또는 사유(엄격). 넘어가지 않으면 null. */
  const earlyReason = (): string | null => {
    if (!view.can.earlyLeave) return "";
    if (view.can.earlyLeaveNeedsReason) {
      const reason = window.prompt(`마감 시각(${Clock.hm(view.profile.activityEnd)}) 전에 마감하는 사유를 적어 주세요.`);
      return reason && reason.trim() ? reason.trim() : null;
    }
    return window.confirm(`아직 마감 시각(${Clock.hm(view.profile.activityEnd)}) 전입니다.\n지금 넘어가면 퇴근 점검 없이 오늘을 정리합니다. 넘어갈까요?`) ? "" : null;
  };

  const skipSharing = async () => {
    if (!view.can.earlyLeave && !window.confirm("오늘은 회의실 발표 없이 하루 마감으로 갈까요?")) return;
    const early = earlyReason();
    if (early == null) return;
    if ((await office.act("endSharing", { reason: "userStopped", earlyReason: early })) != null) office.notify("공유를 건너뛰었습니다.\n하루 마감을 해 주세요.");
  };

  const startSharing = async () => {
    const early = earlyReason();
    if (early == null) return;
    if ((await office.act("startSharing", { earlyReason: early })) != null) onGo("share");
  };

  return (
    <div className="panel">
      <PanelHeader place="내 책상" title="오늘 할 일" detail={view.phase.headline} />

      {phase === "beforeCheckIn" ? (
        <Notice kind="info" title="활동을 시작하면 여기서 과제를 합니다">
          출입문에서 사원증을 찍고 출근해 주세요.
        </Notice>
      ) : phase === "morningPT" ? (
        <Notice kind="info" title="아직 오늘 범위를 정하지 않았습니다">
          회의실에서 AI 팀장과 오늘 끝낼 범위를 정해 주세요.
          <div style={{ marginTop: 8 }}>
            <button className="btn secondary small" onClick={() => onGo("meeting")}>
              회의실로 가기
            </button>
          </div>
        </Notice>
      ) : null}

      {view.overtime.checkoutAt != null && phase === "working" ? (
        <Notice kind="ok" title={view.overtime.outcome ? "추가근무를 마쳤습니다" : "퇴근 점검을 마쳤습니다"}>
          회의실 발표와 하루 마감으로 이어 가 주세요.
        </Notice>
      ) : null}
      {phase === "working" ? <AttendanceCard office={office} view={view} /> : null}

      {tasks.length > 0 ? (
        <Card title="과제" aside={<span className="chip">{`제출 ${submitted} / ${tasks.length}`}</span>}>
          {view.day.checkInAt != null ? <div className="small muted">활동 시작 {hm(view.day.checkInAt)}</div> : null}
          <p className="small muted pre" style={{ margin: 0 }}>
            {"비밀키·고객 정보·비공개 회사 코드는 남기지 마세요.\n남긴 결과물은 회의실 발표 때 AI 동료에게 전송될 수 있습니다."}
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {tasks.map((t) => (
              <TaskWork key={t.id} task={t} view={view} office={office} />
            ))}
          </div>
        </Card>
      ) : null}

      {phase === "working" ? (
        <Card title="다 했으면 회의실에서 발표하기">
          <p className="muted pre" style={{ margin: 0 }}>
            {handled === tasks.length
              ? "모든 과제를 제출했거나 못 끝낸 것으로 정했습니다.\nAI 기획자에게 오늘 한 일을 설명해 주세요."
              : `아직 진행 중인 과제가 ${tasks.length - handled}건 있습니다.\n그래도 지금 공유를 시작할 수 있습니다.`}
          </p>
          {blockedBy.length > 0 ? (
            <Notice kind="warning" title="마감 시각 전에는 마감할 수 없습니다">
              {`2·3단계 과제가 남아 있습니다.\n${blockedBy.map((t) => `· ${t}`).join("\n")}\n제출하거나 ${Clock.hm(view.profile.activityEnd)} 퇴근 점검을 기다려 주세요.`}
            </Notice>
          ) : view.can.earlyLeaveNeedsReason ? (
            <p className="small muted" style={{ margin: 0 }}>
              마감 시각 전에 넘어가려면 사유를 적습니다.
            </p>
          ) : null}
          <div className="row">
            <button className="btn" onClick={startSharing} disabled={office.busy || !view.can.startSharing || blockedBy.length > 0}>
              회의실에서 발표하기
            </button>
            <button
              className="btn plain"
              onClick={skipSharing}
              disabled={office.busy || !view.can.endSharing || blockedBy.length > 0}
              title="공유가 맞지 않는 학습이었다면 공유 없이 하루 마감으로 갑니다."
            >
              공유 없이 바로 마감
            </button>
            {blockedBy.length > 0 ? <LowerTodayButton office={office} view={view} small /> : null}
          </div>
        </Card>
      ) : phase === "sharing" ? (
        <Notice kind="info" title="회의실에서 발표하는 중입니다">
          <button className="btn secondary small" onClick={() => onGo("share")}>
            회의실로 가기
          </button>
        </Notice>
      ) : null}
    </div>
  );
}
