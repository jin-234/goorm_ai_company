"use client";
/** 업무 체크리스트. 내 책상·퇴근 점검·추가근무에서 같이 쓴다. 결과물 칸은 입력을 마칠 때 한 번 보낸다. */
import { useEffect, useState } from "react";
import { Clock } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { LevelBadge } from "../ui";

type Task = OfficeView["state"]["day"]["tasks"][number];

export function TaskList({
  office,
  tasks,
  editable,
}: {
  office: OfficeHandle;
  tasks: Task[];
  editable: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} office={office} editable={editable} />
      ))}
    </div>
  );
}

function TaskRow({ task, office, editable }: { task: Task; office: OfficeHandle; editable: boolean }) {
  const [deliverable, setDeliverable] = useState(task.deliverable ?? "");
  useEffect(() => setDeliverable(task.deliverable ?? ""), [task.deliverable]);
  const done = task.status === "done";
  const carried = task.status === "carried";

  return (
    <div className="card" style={{ background: done ? "var(--green-soft)" : "var(--paper)", gap: 8, padding: 12 }}>
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <input
          type="checkbox"
          aria-label={`${task.title} 완료`}
          checked={done}
          disabled={!editable || carried || office.busy}
          onChange={(e) => office.act("setTaskDone", { id: task.id, done: e.target.checked })}
          style={{ width: 24, height: 24, marginTop: 2, accentColor: "var(--green)", flex: "none" }}
        />
        <div style={{ minWidth: 0 }}>
          <div className="row">
            <LevelBadge level={task.level} />
            {task.carryCount > 0 ? <span className="badge tag">이월 {task.carryCount}회</span> : null}
            {carried ? <span className="badge tag">다음 근무일로 이월됨</span> : null}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              marginTop: 4,
              textDecoration: done ? "line-through" : undefined,
            }}
          >
            {task.title}
          </div>
          <div className="small muted">
            마감 {Clock.hm(task.due)} · 완료 기준: {task.doneCriteria}
          </div>
        </div>
      </div>
      {editable && !carried ? (
        <input
          className="field"
          aria-label={`${task.title} 결과물`}
          placeholder="결과물 (메모, 링크, 파일 이름)"
          value={deliverable}
          onChange={(e) => setDeliverable(e.target.value)}
          onBlur={() => deliverable !== (task.deliverable ?? "") && office.save("setDeliverable", { id: task.id, text: deliverable })}
        />
      ) : task.deliverable ? (
        <div className="small">결과물: {task.deliverable}</div>
      ) : null}
    </div>
  );
}
