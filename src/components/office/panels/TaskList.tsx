"use client";
/**
 * 확정한 과제 목록. 과제마다 완료 기준·공유 형태·제출물을 보여 주고,
 * 수행 중에는 결과물(글·코드·링크)을 제출하고 진행 상태를 바꾼다.
 * 제출과 완료는 다르다: 제출한 과제는 하루 마감을 확정할 때 '마감 확인'이 된다.
 */
import { useState } from "react";
import { hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { StatusBadge } from "../ui";

type Task = OfficeView["day"]["tasks"][number];
type Submission = OfficeView["day"]["submissions"][number];
type Kind = Submission["kind"];

const KINDS: [Kind, string, string][] = [
  ["text", "글", "한 일·배운 점·결과를 적어 주세요."],
  ["code", "코드", "코드를 붙여 넣어 주세요."],
  ["link", "링크", "https://로 시작하는 주소 하나"],
];

const KIND_LABEL: Record<Kind, string> = { text: "글", code: "코드", link: "링크" };

export function TaskList({
  office,
  view,
  tasks = view.day.tasks,
  editable = view.can.editTasks,
}: {
  office: OfficeHandle;
  view: OfficeView;
  tasks?: Task[];
  editable?: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          submissions={view.day.submissions.filter((s) => s.taskId === t.id)}
          office={office}
          editable={editable}
        />
      ))}
    </div>
  );
}

function TaskCard({
  task,
  submissions,
  office,
  editable,
}: {
  task: Task;
  submissions: Submission[];
  office: OfficeHandle;
  editable: boolean;
}) {
  const [kind, setKind] = useState<Kind>("text");
  const [content, setContent] = useState("");
  const [open, setOpen] = useState(false);
  const closed = task.status === "reviewed" || (task.status === "incomplete" && task.outcome != null);
  const canEdit = editable && !closed;

  const submit = async () => {
    if ((await office.act("submitWork", { taskId: task.id, kind, content })) != null) {
      setContent("");
      setOpen(false);
      office.notify(kind === "link" ? "링크를 남겼습니다.\n링크 본문은 읽지 않은 것으로 기록합니다." : "결과물을 제출했습니다.");
    }
  };
  const setStatus = (status: "in_progress" | "submitted" | "incomplete") =>
    office.act("setTaskStatus", { taskId: task.id, status });

  return (
    <div
      className="card"
      style={{ background: task.status === "submitted" || task.status === "reviewed" ? "var(--green-soft)" : "var(--paper)", gap: 8, padding: 12 }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="row">
            <StatusBadge status={task.status} label={task.statusLabel} />
            {task.carryCount > 0 ? <span className="badge tag">이월 {task.carryCount}회</span> : null}
            {task.outcomeLabel ? <span className="badge tag">{task.outcomeLabel}</span> : null}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{task.title}</div>
          <div className="small muted">완료 기준: {task.completionCriteria}</div>
          {task.shareForm ? <div className="small muted">공유 형태: {task.shareForm}</div> : null}
          {task.outcomeReason ? <div className="small muted">사유: {task.outcomeReason}</div> : null}
        </div>
      </div>

      {submissions.length > 0 ? (
        <div style={{ display: "grid", gap: 4 }}>
          {submissions.map((s) => (
            <div key={s.id} className="small" style={{ borderLeft: "3px solid var(--green-soft)", paddingLeft: 8 }}>
              <span className="muted">
                {hm(s.at)} · {KIND_LABEL[s.kind]}
                {s.readScope === "notRead" ? " · 본문은 읽지 않음" : ""}
              </span>
              <div
                className="pre"
                style={{
                  fontFamily: s.kind === "code" ? "ui-monospace, Menlo, monospace" : undefined,
                  maxHeight: 120,
                  overflow: "auto",
                  wordBreak: "break-all",
                }}
              >
                {s.content}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {canEdit ? (
        open ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" role="group" aria-label={`${task.title} 제출 형식`}>
              {KINDS.map(([k, label]) => (
                <button key={k} className={`btn small ${kind === k ? "" : "secondary"}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
            {kind === "link" ? (
              <input
                className="field"
                aria-label={`${task.title} 결과물`}
                placeholder={KINDS[2][2]}
                value={content}
                inputMode="url"
                onChange={(e) => setContent(e.target.value)}
              />
            ) : (
              <textarea
                className="field"
                aria-label={`${task.title} 결과물`}
                rows={kind === "code" ? 8 : 4}
                placeholder={KINDS.find(([k]) => k === kind)![2]}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                style={kind === "code" ? { fontFamily: "ui-monospace, Menlo, monospace" } : undefined}
              />
            )}
            {kind === "link" ? (
              <div className="small muted">링크는 주소만 남깁니다. AI 동료는 링크 안의 내용을 읽지 않습니다.</div>
            ) : null}
            <div className="row">
              <button className="btn small" onClick={submit} disabled={office.busy || !content.trim()}>
                제출
              </button>
              <button className="btn plain small" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="btn secondary small" onClick={() => setOpen(true)} disabled={office.busy}>
              결과물 제출
            </button>
            {task.status === "confirmed" ? (
              <button className="btn plain small" onClick={() => setStatus("in_progress")} disabled={office.busy}>
                시작
              </button>
            ) : null}
            {submissions.length > 0 && task.status !== "submitted" ? (
              <button className="btn plain small" onClick={() => setStatus("submitted")} disabled={office.busy}>
                제출 완료로 표시
              </button>
            ) : null}
            {task.status === "submitted" || task.status === "incomplete" ? (
              <button className="btn plain small" onClick={() => setStatus("in_progress")} disabled={office.busy}>
                다시 진행 중으로
              </button>
            ) : (
              <button className="btn plain small" onClick={() => setStatus("incomplete")} disabled={office.busy}>
                미완료로 표시
              </button>
            )}
          </div>
        )
      ) : null}
    </div>
  );
}
