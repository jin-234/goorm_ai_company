"use client";
/**
 * 내 책상 · 수행. 확정한 과제를 하나씩 수행하고 결과물(글·코드·링크)을 제출한다.
 * 다 했으면 기획팀 공유로 넘어가고, 공유가 맞지 않는 날은 건너뛰고 하루 마감으로 간다.
 */
import { hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader, type PlaceId } from "../ui";
import { TaskList } from "./TaskList";

export function TodayLog({ view }: { view: OfficeView }) {
  const events = view.day.events.slice(-8).reverse();
  if (events.length === 0) return null;
  return (
    <Card title="오늘 기록">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {events.map((e) => (
          <li key={e.id} className="row" style={{ flexWrap: "nowrap" }}>
            <span className="small muted" style={{ fontVariantNumeric: "tabular-nums", width: 44, flex: "none" }}>
              {hm(e.at)}
            </span>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Desk({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const tasks = view.day.tasks;
  const submitted = tasks.filter((t) => t.status === "submitted").length;
  const phase = view.phase.value;

  const startSharing = async () => {
    if ((await office.act("startSharing")) != null) office.notify("기획팀 공유를 시작합니다.\n오늘 한 일을 설명해 주세요.");
  };
  const skipSharing = async () => {
    if (!window.confirm("기획팀 공유를 건너뛰고 하루 마감으로 갈까요?\n건너뛴 것으로 기록합니다.")) return;
    if ((await office.act("endSharing")) != null) office.notify("공유를 건너뛰었습니다.\n하루 마감을 작성해 주세요.");
  };

  return (
    <div className="panel">
      <PanelHeader place="내 책상" title="오늘 과제 수행" detail={view.phase.headline} />
      {view.pastActivityEnd ? (
        <Notice kind="info" title="정해 둔 마감 시각이 지났습니다">
          {"강제로 넘어가지 않습니다.\n정리가 되면 기획팀 공유와 하루 마감으로 넘어가 주세요."}
        </Notice>
      ) : null}
      <Card title="과제" aside={tasks.length ? <span className="chip">{`제출 ${submitted} / ${tasks.length}`}</span> : undefined}>
        {tasks.length === 0 ? (
          <>
            <p className="muted pre" style={{ margin: 0 }}>
              {phase === "beforeCheckIn"
                ? "출근한 뒤 아침보고에서 오늘 과제를 정합니다."
                : "아직 확정한 과제가 없습니다.\n회의실에서 아침보고를 진행해 주세요."}
            </p>
            {phase === "morningPT" ? (
              <button className="btn secondary" onClick={() => onGo("meeting")}>
                회의실로 가기
              </button>
            ) : null}
          </>
        ) : (
          <TaskList office={office} view={view} />
        )}
      </Card>
      {phase === "working" ? (
        <Card title="다 했으면">
          <p className="muted pre" style={{ margin: 0 }}>
            {"기획팀 윤기획(AI)에게 오늘 한 일을 설명합니다.\n제출하지 못한 과제는 하루 마감에서 처리를 고릅니다."}
          </p>
          <div className="row">
            <button className="btn" onClick={startSharing} disabled={office.busy || !view.can.startSharing}>
              기획팀 공유 시작
            </button>
            <button className="btn plain" onClick={skipSharing} disabled={office.busy || !view.can.endSharing}>
              공유 건너뛰고 마감하기
            </button>
          </div>
        </Card>
      ) : null}
      <TodayLog view={view} />
    </div>
  );
}
