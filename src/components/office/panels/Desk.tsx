"use client";
/**
 * 내 책상 · 수행과 결과물 제출(개정 기획서 3.1).
 * 확정한 과제마다 시작 → 결과물 남기기 → 제출 완료(또는 오늘은 못 끝냄). 다 되면 기획팀 공유로 넘어간다.
 */
import { hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader, type PlaceId } from "../ui";
import { TaskWork } from "./TaskList";

export function Desk({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const { tasks } = view.day;
  const phase = view.phase.value;
  const submitted = tasks.filter((t) => t.status === "submitted").length;
  const handled = tasks.filter((t) => t.status === "submitted" || t.status === "incomplete").length;

  const startSharing = async () => {
    if ((await office.act("startSharing")) != null) onGo("share");
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

      {tasks.length > 0 ? (
        <Card title="과제" aside={<span className="chip">{`제출 ${submitted} / ${tasks.length}`}</span>}>
          {view.day.checkInAt != null ? <div className="small muted">활동 시작 {hm(view.day.checkInAt)}</div> : null}
          <p className="small muted pre" style={{ margin: 0 }}>
            {"비밀키·고객 정보·비공개 회사 코드는 남기지 마세요.\n남긴 결과물은 기획팀 공유 때 AI 기획자에게 전송될 수 있습니다."}
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {tasks.map((t) => (
              <TaskWork key={t.id} task={t} view={view} office={office} />
            ))}
          </div>
        </Card>
      ) : null}

      {phase === "working" ? (
        <Card title="다 했으면 기획팀에 공유하기">
          <p className="muted pre" style={{ margin: 0 }}>
            {handled === tasks.length
              ? "모든 과제를 제출했거나 못 끝낸 것으로 정했습니다.\nAI 기획자에게 오늘 한 일을 설명해 주세요."
              : `아직 진행 중인 과제가 ${tasks.length - handled}건 있습니다.\n그래도 지금 공유를 시작할 수 있습니다.`}
          </p>
          <button className="btn" onClick={startSharing} disabled={office.busy || !view.can.startSharing}>
            기획팀에 공유하러 가기
          </button>
        </Card>
      ) : phase === "sharing" ? (
        <Notice kind="info" title="기획팀과 공유하는 중입니다">
          <button className="btn secondary small" onClick={() => onGo("share")}>
            기획팀으로 가기
          </button>
        </Notice>
      ) : null}
    </div>
  );
}
