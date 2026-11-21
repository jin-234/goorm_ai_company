"use client";
/**
 * 하루 마감(개정 기획서 3.1, 4.3 E)과 마감 뒤 기록.
 * - 근거를 구분한 요약 초안을 받아 사용자가 고쳐 확정한다. AI 원본 초안(서버 day.review.draft)과
 *   사용자가 고친 칸을 구분해 보여 주고, 고친 내용은 확정할 때 보낸다.
 * - 제출하지 않은 과제마다 범위 조정·다음 활동일 이월·오늘 종료 중 하나를 고른다(사유는 선택).
 * - AI 미연결이면 빈 수동 양식을 주고 AI가 쓴 것처럼 표시하지 않는다.
 */
import { useEffect, useState } from "react";
import { api, type CloseChoice, isManual, isSample, type OfficeView, type Review } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, CHOICE_NAME, ManualMark, Notice, PanelHeader, type PlaceId, SampleMark, StatusBadge } from "../ui";

const EMPTY: Review = {
  reported_work: "",
  explained_learning: "",
  artifact_observations: "",
  shared_scope_and_limits: "",
  open_questions: [],
  job_connection: "",
  next_action: "",
  evidence_refs: [],
};

type TextField = Exclude<keyof Review, "open_questions" | "evidence_refs">;

const FIELDS: { key: TextField | "open_questions"; label: string; hint: string }[] = [
  { key: "reported_work", label: "오늘 한 일", hint: "내가 했다고 설명한 활동" },
  { key: "explained_learning", label: "설명한 개념·배운 내용", hint: "공유 대화에서 설명한 것" },
  { key: "artifact_observations", label: "결과물에서 확인한 것", hint: "실제로 읽은 결과물(글·코드)에서 본 것만. 링크는 읽지 않았습니다." },
  { key: "shared_scope_and_limits", label: "발표 때 전한 가능 범위와 제약", hint: "지금 되는 것과 아직 안 되는 것" },
  { key: "open_questions", label: "아직 남은 질문", hint: "한 줄에 하나씩" },
  { key: "job_connection", label: "희망 직무와의 연결", hint: "이번 활동이 직무에서 어떤 연습이었는지. 등급·점수는 적지 않습니다." },
  { key: "next_action", label: "다음 행동 하나", hint: "다음 활동일에 가장 먼저 할 일" },
];

const valueOf = (r: Review, key: TextField | "open_questions") => (key === "open_questions" ? r.open_questions.join("\n") : r[key]);
const storeKey = (view: OfficeView) => `vision.review.${view.clock.date}`;

export function DayClose({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const { review } = view.day;
  // 서버가 정한 '처리를 골라야 할 과제'(제출하지 않은 과제)를 그대로 쓴다.
  const open = view.day.tasks.filter((t) => view.day.unsubmittedTaskIds.includes(t.id));
  const [edit, setEdit] = useState<Review>(review.draft ?? EMPTY);
  const [choices, setChoices] = useState<Record<string, CloseChoice>>(review.choices ?? {});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState(false);

  // 고치던 내용은 새로고침해도 남게 브라우저에 보관한다.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey(view));
      if (raw) {
        const saved = JSON.parse(raw) as { edit: Review; choices: Record<string, CloseChoice>; reasons: Record<string, string> };
        setEdit(saved.edit);
        setChoices(saved.choices);
        setReasons(saved.reasons);
      }
    } catch {
      // 없으면 서버 초안으로 시작한다.
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      localStorage.setItem(storeKey(view), JSON.stringify({ edit, choices, reasons }));
    } catch {
      // 저장하지 못해도 이번 화면에서는 계속 쓸 수 있다.
    }
  }, [edit, choices, reasons]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeDraft = async () => {
    const touched = FIELDS.some((f) => valueOf(edit, f.key).trim());
    if (touched && !window.confirm("지금 고친 내용을 새 초안으로 바꿀까요?")) return;
    setDrafting(true);
    // 서버가 초안을 day.review.draft에 저장하고 상태를 돌려준다.
    const res = await office.run(async () => {
      const r = await api.reviewDraft();
      return { ...r, office: r.office ?? view };
    });
    setDrafting(false);
    if (res) setEdit(res.review);
  };

  const setField = (key: TextField | "open_questions", value: string) =>
    setEdit((r) =>
      key === "open_questions"
        ? { ...r, open_questions: value.split("\n").map((s) => s.trim()).filter(Boolean) }
        : { ...r, [key]: value },
    );

  const missingChoice = open.filter((t) => !choices[t.id]);
  const ready = view.can.confirmReview && edit.reported_work.trim() && edit.next_action.trim() && missingChoice.length === 0;

  const confirm = async () => {
    const cleanReasons = Object.fromEntries(Object.entries(reasons).filter(([, v]) => v.trim()));
    if ((await office.act("confirmReview", { review: edit, choices, reasons: cleanReasons })) == null) return;
    try {
      localStorage.removeItem(storeKey(view));
    } catch {
      // 다음 날 키가 달라 문제없다.
    }
    office.notify("하루 마감을 확정했습니다.\n오늘도 수고 많았습니다.");
  };

  const draft = review.draft;
  const manualDraft = isManual(review.draftSource);
  // '내가 고침'은 AI 원본 초안(aiDraft)과 비교한다. AI 원본이 없으면 표시하지 않는다.
  const original = review.aiDraft;
  const edited = (key: TextField | "open_questions") => original != null && valueOf(edit, key).trim() !== valueOf(original, key).trim();

  return (
    <div className="panel">
      <PanelHeader
        place="내 책상"
        title="하루 마감"
        detail={"오늘 한 일과 다음 행동을 확인하고 확정합니다.\n못 끝낸 일은 어떻게 할지 고르기만 하면 됩니다."}
      />

      {open.length > 0 ? (
        <Card title={`제출하지 않은 과제 ${open.length}건`}>
          <p className="small muted" style={{ margin: 0 }}>
            괜찮습니다. 과제마다 하나를 골라 주세요. 사유는 적지 않아도 됩니다.
          </p>
          {open.map((t) => (
            <div key={t.id} className="card" style={{ background: "var(--paper)", gap: 8, padding: 12 }}>
              <div className="row">
                <StatusBadge status={t.status} />
                <strong>{t.title}</strong>
              </div>
              <div className="row" role="radiogroup" aria-label={`${t.title} 처리`}>
                {(Object.keys(CHOICE_NAME) as CloseChoice[]).map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={choices[t.id] === c}
                    className={`btn small ${choices[t.id] === c ? "" : "secondary"}`}
                    title={CHOICE_NAME[c].detail}
                    onClick={() => setChoices((cs) => ({ ...cs, [t.id]: c }))}
                  >
                    {CHOICE_NAME[c].label}
                  </button>
                ))}
              </div>
              {choices[t.id] ? <div className="small muted">{CHOICE_NAME[choices[t.id]].detail}</div> : null}
              <input
                className="field"
                aria-label={`${t.title} 사유(선택)`}
                placeholder="사유 (선택)"
                value={reasons[t.id] ?? ""}
                onChange={(e) => setReasons((rs) => ({ ...rs, [t.id]: e.target.value }))}
              />
            </div>
          ))}
        </Card>
      ) : null}

      <Card
        title="마감 요약"
        aside={
          draft ? (
            manualDraft ? (
              <ManualMark />
            ) : (
              <span className="row" style={{ gap: 6 }}>
                <span className="badge tag">AI 초안 · 고칠 수 있음</span>
                {isSample(review.draftSource) ? <SampleMark /> : null}
              </span>
            )
          ) : undefined
        }
      >
        <div className="row">
          <button className="btn secondary" onClick={makeDraft} disabled={office.busy || drafting}>
            {drafting ? "초안을 만드는 중" : draft ? "요약 초안 다시 받기" : "요약 초안 받기"}
          </button>
          <span className="small muted">초안 없이 직접 적어도 됩니다.</span>
        </div>
        {draft && manualDraft ? (
          <Notice kind="info" title="AI 요약에 연결하지 못했습니다">
            빈 양식입니다. 오늘 한 일과 다음 행동만 적어도 마감할 수 있습니다.
          </Notice>
        ) : null}
        {FIELDS.map((f) => (
          <label key={f.key} className="stack">
            <span>
              {f.label}
              {f.key === "reported_work" || f.key === "next_action" ? " *" : ""}
              {edited(f.key) ? <span className="badge tag" style={{ marginLeft: 6 }}>내가 고침</span> : null}
            </span>
            <span className="small muted" style={{ fontWeight: 400 }}>
              {f.hint}
            </span>
            <textarea
              className="field"
              rows={f.key === "next_action" ? 2 : 3}
              value={valueOf(edit, f.key)}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          </label>
        ))}
        {edit.evidence_refs.length > 0 ? (
          <div className="small muted">근거: {edit.evidence_refs.join(", ")}</div>
        ) : null}
        <p className="small muted pre" style={{ margin: 0 }}>
          {"요약은 내가 설명한 것과 실제로 읽은 결과물을 구분합니다.\n실행해 보지 않은 것은 '확인했다'고 적지 않습니다."}
        </p>
      </Card>

      {missingChoice.length > 0 ? (
        <Notice kind="warning" title="처리 방법을 고르지 않은 과제가 있습니다">
          {missingChoice.map((t) => `· ${t.title}`).join("\n")}
        </Notice>
      ) : null}

      {/* 확정 버튼은 패널 아래에 붙여 두고, 꺼져 있으면 왜 꺼졌는지 바로 위에 적는다(아침보고와 같은 방식). */}
      <div className="sticky-cta stack" style={{ gap: 8 }}>
        {!edit.reported_work.trim() || !edit.next_action.trim() ? (
          <div className="small muted">'오늘 한 일'과 '다음 행동 하나'는 적어야 확정할 수 있습니다.</div>
        ) : null}
        <button className="btn" onClick={confirm} disabled={office.busy || !ready}>
          이대로 하루 마감 확정
        </button>
      </div>
      <button className="btn plain small" onClick={() => onGo("share")}>
        회의실 발표 다시 보기
      </button>
    </div>
  );
}

/** 마감을 확정한 뒤: 해낸 일과 다음 활동일 계획을 나란히(현직자 피드백). */
export function DayEnd({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const confirmed = view.day.review.confirmed;
  const done = view.day.tasks.filter((t) => t.status === "submitted" || t.status === "reviewed" || t.outcome === "adjust");
  const next = view.pendingCarry;
  return (
    <div className="panel">
      <PanelHeader place="내 책상" title="오늘 활동을 마쳤습니다" detail={view.clock.dateLong} />
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <Card title={`해낸 일 ${done.length}건`}>
          {done.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              오늘 제출한 과제는 없습니다. 기록은 그대로 남았습니다.
            </p>
          ) : (
            done.map((t) => (
              <div key={t.id}>
                <strong>{t.title}</strong>
                <div className="small muted">{t.outcome === "adjust" ? "범위를 줄여 마침" : "제출함"}</div>
              </div>
            ))
          )}
        </Card>
        <Card title="다음 활동일 계획">
          {confirmed?.next_action ? (
            <div>
              <div className="small muted">다음 행동</div>
              <strong className="pre">{confirmed.next_action}</strong>
            </div>
          ) : null}
          {next.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              넘긴 과제는 없습니다.
            </p>
          ) : (
            next.map((t) => (
              <div key={t.id} className="small">
                · {t.title} <span className="badge tag">넘어감</span>
              </div>
            ))
          )}
        </Card>
      </div>
      {confirmed ? (
        <Card title="확정한 요약">
          {FIELDS.filter((f) => valueOf(confirmed, f.key).trim()).map((f) => (
            <div key={f.key}>
              <div style={{ fontWeight: 700 }}>{f.label}</div>
              <div className="pre muted">{valueOf(confirmed, f.key)}</div>
            </div>
          ))}
        </Card>
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
