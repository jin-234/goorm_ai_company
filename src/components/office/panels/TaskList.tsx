"use client";
/**
 * 과제 하나의 수행·제출 카드(개정 기획서 3.1 수행·결과물 제출, 4.4).
 * 제출(submitWork)과 '제출 완료'(setTaskStatus submitted)는 따로다. 제출과 완료를 같은 것으로 보지 않는다.
 * 링크는 서버가 본문을 읽지 않으므로 '읽지 않음'으로 표시한다.
 */
import { useState } from "react";
import { dayKeyOf, hm } from "@/lib/office/time";
import type { OfficeView, Submission, Task } from "../api";
import type { OfficeHandle } from "../useOffice";
import { StatusBadge } from "../ui";

const KIND_NAME: Record<Submission["kind"], string> = { text: "글", link: "링크", code: "코드" };
const PLACEHOLDER: Record<Submission["kind"], string> = {
  text: "무엇을 했고 어디까지 됐는지 적어 주세요.",
  link: "https:// 로 시작하는 주소",
  code: "핵심 부분만 붙여 넣어 주세요(비밀키는 빼고).",
};

export function SubmissionLine({ s }: { s: Submission }) {
  const d = dayKeyOf(s.at);
  return (
    <div className="small" style={{ borderLeft: "3px solid var(--line)", paddingLeft: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="badge tag">{KIND_NAME[s.kind]}</span>
        <span className="muted">
          {d.month}/{d.day} {hm(s.at)}
        </span>
        {s.readScope === "notRead" ? (
          <span className="badge none" title="주소만 저장했고 내용은 읽지 않았습니다. AI 동료는 설명을 기준으로 이야기합니다.">
            읽지 않음 · 설명 기준
          </span>
        ) : null}
      </div>
      <div className={s.kind === "code" ? "pre" : "pre"} style={s.kind === "code" ? { fontFamily: "ui-monospace, monospace", fontSize: 13 } : undefined}>
        {s.content}
      </div>
    </div>
  );
}

export function TaskWork({ task, view, office }: { task: Task; view: OfficeView; office: OfficeHandle }) {
  const [kind, setKind] = useState<Submission["kind"]>("text");
  const [content, setContent] = useState("");
  const subs = view.day.submissions.filter((s) => s.taskId === task.id);
  const editable = view.can.editTasks;
  const done = task.status === "submitted" || task.status === "reviewed";

  const setStatus = (status: "in_progress" | "submitted" | "incomplete") => office.act("setTaskStatus", { taskId: task.id, status });
  const submit = async () => {
    if ((await office.act("submitWork", { taskId: task.id, kind, content: content.trim() })) != null) {
      setContent("");
      office.notify("결과물을 남겼습니다.\n다 됐으면 '제출 완료'를 눌러 주세요.");
    }
  };

  return (
    <div className="card" style={{ background: done ? "var(--green-soft)" : "var(--paper)", gap: 10, padding: 12 }}>
      <div className="row">
        <StatusBadge status={task.status} />
        {view.enforcement.rules.taskLevels ? (
          <span className={`badge ${task.level === 1 ? "tag" : `l${task.level}`}`} title={task.levelLabel}>
            {task.level}단계
          </span>
        ) : null}
        {task.carryCount > 0 ? <span className="badge tag">넘어온 {task.carryCount}회</span> : null}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{task.title}</div>
      <div className="small muted">
        완료 기준: {task.completionCriteria}
        <br />
        공유 형태: {task.shareForm}
      </div>

      {subs.length > 0 ? <div style={{ display: "grid", gap: 6 }}>{subs.map((s) => <SubmissionLine key={s.id} s={s} />)}</div> : null}

      {editable && !done ? (
        <>
          {task.status === "confirmed" ? (
            <button className="btn secondary" onClick={() => setStatus("in_progress")} disabled={office.busy}>
              시작하기
            </button>
          ) : null}
          <div className="row" role="group" aria-label="결과물 형식">
            {(["text", "link", "code"] as const).map((k) => (
              <button key={k} className={`btn small ${kind === k ? "" : "secondary"}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_NAME[k]}
              </button>
            ))}
          </div>
          <textarea
            className="field"
            aria-label={`${task.title} 결과물`}
            rows={kind === "link" ? 1 : 3}
            value={content}
            placeholder={PLACEHOLDER[kind]}
            onChange={(e) => setContent(e.target.value)}
            style={kind === "code" ? { fontFamily: "ui-monospace, monospace", fontSize: 13 } : undefined}
          />
          {kind === "link" ? (
            <div className="small muted">링크는 주소만 저장하고 내용은 읽지 않습니다. 회의실 발표 때 무엇이 담겼는지 설명해 주세요.</div>
          ) : null}
          <div className="row">
            <button className="btn secondary" onClick={submit} disabled={office.busy || !content.trim()}>
              결과물 남기기
            </button>
            <button
              className="btn"
              onClick={() => setStatus("submitted")}
              disabled={office.busy || subs.length === 0}
              title={subs.length === 0 ? "결과물을 하나 이상 남긴 뒤 누를 수 있습니다." : undefined}
            >
              제출 완료
            </button>
            {task.status !== "incomplete" ? (
              <button className="btn plain" onClick={() => setStatus("incomplete")} disabled={office.busy}>
                오늘은 못 끝냄
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {editable && (task.status === "submitted" || task.status === "incomplete") ? (
        <button className="btn plain small" onClick={() => setStatus("in_progress")} disabled={office.busy}>
          다시 하는 중으로 바꾸기
        </button>
      ) : null}
    </div>
  );
}
