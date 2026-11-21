"use client";
/**
 * 내 책상 · 수행과 결과물 제출(개정 기획서 3.1).
 * 확정한 과제마다 시작 → 결과물 남기기 → 제출 완료(또는 오늘은 못 끝냄). 다 되면 회의실에서 타 부서에 발표한다.
 */
import { useState } from "react";
import { Clock, hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader, type PlaceId } from "../ui";
import { AttendanceCard } from "./Enforcement";
import { TaskWork } from "./TaskList";

export function Desk({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const { tasks } = view.day;
  const phase = view.phase.value;
  const submitted = tasks.filter((t) => t.status === "submitted").length;
  const handled = tasks.filter((t) => t.status === "submitted" || t.status === "incomplete").length;

  const blockedBy = view.can.earlyLeaveBlockedBy;

  // 넘어가기 전 확인은 브라우저 기본 창(confirm·prompt) 대신 이 패널 안 카드로 묻는다.
  // start = 회의실 발표 시작(마감 시각 전일 때만 묻는다), skip = 발표 없이 하루 마감(늘 묻는다).
  const [asking, setAsking] = useState<"start" | "skip" | null>(null);
  const [reason, setReason] = useState("");
  const needsReason = view.can.earlyLeave && view.can.earlyLeaveNeedsReason;
  const endHM = Clock.hm(view.profile.activityEnd);

  const run = async (kind: "start" | "skip") => {
    const early = view.can.earlyLeave ? reason.trim() : "";
    if (kind === "start") {
      if ((await office.act("startSharing", { earlyReason: early })) != null) {
        setAsking(null);
        onGo("share");
      }
    } else if ((await office.act("endSharing", { reason: "userStopped", earlyReason: early })) != null) {
      setAsking(null);
      office.notify("공유를 건너뛰었습니다.\n하루 마감을 해 주세요.");
    }
  };

  const startSharing = () => {
    if (!view.can.earlyLeave) void run("start");
    else setAsking("start");
  };
  const skipSharing = () => setAsking("skip");

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
        <Card title="다 했으면 타 부서에 공유하기">
          <p className="muted pre" style={{ margin: 0 }}>
            {handled === tasks.length
              ? "모든 과제를 제출했거나 못 끝낸 것으로 정했습니다.\n회의실에서 기획·디자인·운영 담당자에게 오늘 한 일을 설명해 주세요."
              : `아직 진행 중인 과제가 ${tasks.length - handled}건 있습니다.\n그래도 지금 공유를 시작할 수 있습니다.`}
          </p>
          {blockedBy.length > 0 ? (
            <Notice kind="warning" title="마감 시각 전에는 마감할 수 없습니다">
              {`2·3단계 과제가 남아 있습니다.\n${blockedBy.map((t) => `· ${t}`).join("\n")}\n제출하거나 ${Clock.hm(view.profile.activityEnd)} 퇴근 점검을 기다려 주세요.`}
            </Notice>
          ) : null}
          {asking ? (
            <Notice
              kind={view.can.earlyLeave ? "warning" : "info"}
              title={asking === "start" ? `마감 시각(${endHM}) 전에 발표할까요?` : "발표 없이 하루 마감으로 갈까요?"}
            >
              {asking === "start"
                ? "발표를 마치면 퇴근 점검 없이 바로 하루 마감으로 이어집니다."
                : view.can.earlyLeave
                  ? `마감 시각(${endHM}) 전입니다. 회의실 발표 없이 지금 하루 마감으로 갑니다.`
                  : "회의실 발표 없이 하루 마감으로 갑니다."}
              {needsReason ? (
                <label className="stack" style={{ marginTop: 8 }}>
                  마감 시각 전에 넘어가는 사유
                  <input className="field" value={reason} maxLength={200} placeholder="예: 오늘 할 일을 일찍 끝냈습니다" onChange={(e) => setReason(e.target.value)} autoFocus />
                </label>
              ) : null}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => void run(asking)} disabled={office.busy || (needsReason && !reason.trim())}>
                  {asking === "start" ? "발표 시작" : "하루 마감으로"}
                </button>
                <button className="btn plain small" onClick={() => setAsking(null)}>
                  취소
                </button>
              </div>
            </Notice>
          ) : null}
          <div className="row">
            <button className="btn" onClick={startSharing} disabled={office.busy || !view.can.startSharing || blockedBy.length > 0}>
              공유 시작 · 팀장 사전 보고부터
            </button>
            <button
              className="btn plain"
              onClick={skipSharing}
              disabled={office.busy || !view.can.endSharing || blockedBy.length > 0}
              title="공유가 맞지 않는 학습이었다면 공유 없이 하루 마감으로 갑니다."
            >
              공유 없이 바로 마감
            </button>
          </div>
        </Card>
      ) : phase === "sharing" ? (
        <Notice kind="info" title="공유하는 중입니다(팀장 사전 보고 → 부서 회의)">
          <button className="btn secondary small" onClick={() => onGo("share")}>
            회의실로 가기
          </button>
        </Notice>
      ) : null}
    </div>
  );
}
