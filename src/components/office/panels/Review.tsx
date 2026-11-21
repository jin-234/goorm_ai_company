"use client";
/**
 * 하루 마감 → 마감 완료.
 * 마감 요약은 기록(과제·제출물·공유 설명)에서 사실만 옮긴 초안으로 시작하고 사용자가 고쳐 확정한다.
 * 읽지 않은 링크나 실행하지 않은 결과를 '확인함'으로 쓰지 않는다.
 * 제출하지 못한 과제는 범위 조정·다음 활동일 이월·오늘 종료 중 하나를 고르고, 사유는 선택이다.
 */
import { useEffect, useRef, useState } from "react";
import { TASK_OUTCOME_LABEL, TASK_OUTCOMES, type Review as ReviewData, type TaskOutcome } from "@/lib/office/models";
import { hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader, StatusBadge, type PlaceId } from "../ui";
import { TaskList } from "./TaskList";

const TEXT_FIELDS: [keyof ReviewData, string, string][] = [
  ["reported_work", "오늘 한 일", "확정한 과제와 실제로 한 일"],
  ["explained_learning", "설명한 내용·배운 점", "공유에서 설명한 내용, 배운 점"],
  ["artifact_observations", "결과물", "제출한 결과물과 그 안에서 확인한 것"],
  ["shared_scope_and_limits", "확인 범위와 한계", "읽지 않은 링크, 실행해 보지 않은 부분 등"],
  ["job_connection", "희망 직무와의 연결", "오늘 한 일이 희망 직무에 어떻게 이어지는지"],
  ["next_action", "다음 행동", "다음 활동일에 이어서 할 일"],
];

const LIST_FIELDS: [keyof ReviewData, string][] = [["open_questions", "남은 질문 (한 줄에 하나)"]];

type Choice = { outcome: TaskOutcome | ""; reason: string };

/** 기록에서 사실만 옮긴 수동 초안. AI가 쓴 것이 아니다. */
function manualDraft(view: OfficeView): ReviewData {
  const { tasks, submissions, share } = view.day;
  const titleOf = (id: string) => tasks.find((t) => t.id === id)?.title ?? "과제";
  const links = submissions.filter((s) => s.readScope === "notRead");
  const said = share.turns.filter((t) => t.role === "user").map((t) => t.text ?? "");
  return {
    reported_work: tasks.map((t) => `· ${t.title} (${t.statusLabel})`).join("\n"),
    explained_learning: said.join("\n"),
    artifact_observations: submissions
      .map((s) => `· ${titleOf(s.taskId)}: ${{ text: "글", code: "코드", link: "링크" }[s.kind]} 제출 ${hm(s.at)}`)
      .join("\n"),
    shared_scope_and_limits: [
      links.length > 0 ? `링크 ${links.length}건은 주소만 남겼고 본문은 읽지 않았습니다.` : "",
      submissions.length === 0 ? "오늘 제출한 결과물이 없습니다." : "",
      share.endedBy === "skipped" ? "기획팀 공유는 건너뛰었습니다." : "",
    ]
      .filter(Boolean)
      .join("\n"),
    open_questions: [...share.openQuestions],
    job_connection: view.profile.targetRole ? `희망 직무: ${view.profile.targetRole}` : "",
    next_action: "",
    evidence_refs: submissions.map((s) => s.id),
  };
}

export function Checkout({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const review = view.day.review;
  const pending = view.day.tasks.filter((t) => view.day.unsubmittedTaskIds.includes(t.id));
  const [draft, setDraft] = useState<ReviewData>(() => review.draft ?? manualDraft(view));
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(pending.map((t) => [t.id, { outcome: (review.choices[t.id] as TaskOutcome) ?? "", reason: "" }])),
  );
  const saved = useRef(JSON.stringify(review.draft));

  // 서버 초안이 바뀌면(AI 초안 도착 등) 그 값으로.
  useEffect(() => {
    const next = JSON.stringify(review.draft);
    if (review.draft && next !== saved.current) {
      saved.current = next;
      setDraft(review.draft);
    }
  }, [review.draft]);

  const saveDraft = (value: ReviewData = draft) => {
    const next = JSON.stringify(value);
    if (next === saved.current) return;
    saved.current = next;
    void office.save("saveReviewDraft", { review: value });
  };

  const setText = (key: keyof ReviewData, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const saveList = (key: keyof ReviewData, value: string) => {
    const next = { ...draft, [key]: value.split("\n").map((l) => l.trim()).filter(Boolean) };
    setDraft(next);
    saveDraft(next);
  };
  const setChoice = (id: string, fields: Partial<Choice>) =>
    setChoices((c) => ({ ...c, [id]: { ...(c[id] ?? { outcome: "", reason: "" }), ...fields } }));

  const unchosen = pending.filter((t) => !choices[t.id]?.outcome);

  const confirm = async () => {
    const outcomes = Object.fromEntries(Object.entries(choices).filter(([, c]) => c.outcome).map(([id, c]) => [id, c.outcome]));
    const reasons = Object.fromEntries(Object.entries(choices).map(([id, c]) => [id, c.reason]));
    const res = await office.act<{ close: { submitted: number; adjusted: number; carried: number; ended: number } }>("confirmReview", {
      review: draft,
      choices: outcomes,
      reasons,
    });
    if (res?.close) {
      const c = res.close;
      const parts = [c.submitted && `제출 ${c.submitted}건`, c.adjusted && `범위 조정 ${c.adjusted}건`, c.carried && `이월 ${c.carried}건`, c.ended && `오늘 종료 ${c.ended}건`].filter(Boolean);
      office.notify(`하루 마감을 확정했습니다.\n${parts.join(" · ") || "확정한 과제가 없었습니다."}`);
    }
  };

  const sourceLabel =
    review.draftSource === "solar" ? (review.editedByUser ? "AI 초안 · 내가 고침" : "AI 초안") : "기록에서 옮긴 초안";

  return (
    <div className="panel">
      <PanelHeader place="내 책상" title="하루 마감" detail={"기록을 바탕으로 오늘을 정리합니다.\n고친 뒤 확정하면 오늘 활동이 마감됩니다."} />

      <Card title="오늘 과제">
        {view.day.tasks.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            오늘은 확정한 과제가 없습니다.
          </p>
        ) : (
          <TaskList office={office} view={view} />
        )}
      </Card>

      {pending.length > 0 ? (
        <Card title={`제출하지 못한 과제 ${pending.length}건`}>
          <p className="muted small" style={{ margin: 0 }}>
            처리를 하나씩 골라 주세요. 사유는 적지 않아도 됩니다.
          </p>
          {pending.map((t) => (
            <div key={t.id} className="card" style={{ background: "var(--paper)", gap: 8, padding: 12 }}>
              <div className="row">
                <StatusBadge status={t.status} label={t.statusLabel} />
                <span style={{ fontWeight: 600 }}>{t.title}</span>
              </div>
              <div className="row" role="radiogroup" aria-label={`${t.title} 처리`}>
                {TASK_OUTCOMES.map((o) => (
                  <button
                    key={o}
                    role="radio"
                    aria-checked={choices[t.id]?.outcome === o}
                    className={`btn small ${choices[t.id]?.outcome === o ? "" : "secondary"}`}
                    onClick={() => setChoice(t.id, { outcome: o })}
                  >
                    {TASK_OUTCOME_LABEL[o]}
                  </button>
                ))}
              </div>
              <input
                className="field"
                aria-label={`${t.title} 사유`}
                placeholder="사유 (선택)"
                value={choices[t.id]?.reason ?? ""}
                onChange={(e) => setChoice(t.id, { reason: e.target.value })}
              />
            </div>
          ))}
        </Card>
      ) : null}

      <Card title="마감 요약" aside={<span className="badge tag">{sourceLabel}</span>}>
        {TEXT_FIELDS.map(([key, label, hint]) => (
          <label key={key} className="stack">
            {label}
            <textarea
              className="field"
              rows={3}
              placeholder={hint}
              value={draft[key] as string}
              onChange={(e) => setText(key, e.target.value)}
              onBlur={() => saveDraft()}
            />
          </label>
        ))}
        {LIST_FIELDS.map(([key, label]) => (
          <label key={key} className="stack">
            {label}
            <textarea
              className="field"
              rows={2}
              defaultValue={(draft[key] as string[]).join("\n")}
              onBlur={(e) => saveList(key, e.target.value)}
            />
          </label>
        ))}
      </Card>

      {unchosen.length > 0 ? <div className="small muted">처리를 고르지 않은 과제: {unchosen.map((t) => t.title).join(", ")}</div> : null}
      <button className="btn" onClick={confirm} disabled={office.busy || !view.can.confirmReview || unchosen.length > 0}>
        하루 마감 확정
      </button>
    </div>
  );
}

/** 마감 완료. 해낸 일·남긴 기록·다음 활동일 과제를 나란히 보여 준다. */
export function DayEnd({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const day = view.day;
  const confirmed = day.review.confirmed;
  const next = view.pendingCarry;
  const closed = view.phase.value === "off";

  return (
    <div className="panel">
      <PanelHeader
        place="내 책상"
        title={closed ? "오늘 활동을 마감했습니다" : "오늘은 활동하지 않았습니다"}
        detail={view.clock.dateLong}
      />
      {closed ? (
        <Card title="오늘 과제">
          <TaskList office={office} view={view} editable={false} />
        </Card>
      ) : (
        <Notice kind="info" title="쉬는 날로 남깁니다">
          활동하지 않은 날은 불이익 없이 기록하지 않습니다.
        </Notice>
      )}
      {confirmed ? (
        <Card title="마감 요약">
          {TEXT_FIELDS.filter(([k]) => (confirmed[k] as string).trim()).map(([k, label]) => (
            <div key={k}>
              <div style={{ fontWeight: 700 }}>{label}</div>
              <div className="pre muted">{confirmed[k] as string}</div>
            </div>
          ))}
          {confirmed.open_questions.length > 0 ? (
            <div>
              <div style={{ fontWeight: 700 }}>남은 질문</div>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                {confirmed.open_questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
      <Card title={`다음 활동일로 이월 ${next.length}건`}>
        {next.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            이월한 과제가 없습니다. 다음 아침보고에서 새로 정합니다.
          </p>
        ) : (
          next.map((t) => (
            <div key={t.id} className="row">
              <span className="badge tag">이월 {t.carryCount}회</span>
              <span style={{ fontWeight: 600 }}>{t.title}</span>
            </div>
          ))
        )}
      </Card>
      {view.can.submitWeekly ? (
        <Notice kind="info" title="오늘은 금요일입니다">
          이번 주를 돌아보는 주간보고서를 써 주세요.
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
        다음 활동일 시작
      </button>
    </div>
  );
}
