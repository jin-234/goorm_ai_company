"use client";
/**
 * 회의실 · 아침 PT.
 * 전사문(녹음 → OpenAI 음성 인식, 안 되면 글 입력) → 업무 초안 만들기(Solar, 실패하면 서버 규칙 초안) → 칸 고치기 → 확정.
 * 칸은 입력을 마칠 때(blur) 한 번만 서버에 보낸다. 빈 칸은 '확인 필요'로 보인다.
 */
import { useEffect, useState } from "react";
import { Clock } from "@/lib/office/time";
import { api, type OfficeView, type SolarErrorInfo } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, LEVEL_NAME, LevelBadge, Notice, PanelHeader } from "../ui";
import { VoiceInput } from "../voice/VoiceInput";

type Draft = OfficeView["morningPT"]["drafts"][number];

export const SAMPLE_PT = `3단계 필수 업무는 지원서 최종 검토입니다. 오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다.
2단계 당일 업무는 포트폴리오 한 문단 초안입니다. 오후 5시까지 문단을 쓰겠습니다.
1단계 이월 가능 업무는 관심 기업 세 곳 저장입니다. 퇴근 전까지 링크를 모으겠습니다.`;

const FORM_GUIDE: [1 | 2 | 3, string][] = [
  [3, "3단계 필수 업무는 ○○입니다. 오후 3시까지 ○○하겠습니다."],
  [2, "2단계 당일 업무는 ○○입니다. 오후 5시까지 ○○하겠습니다."],
  [1, "1단계 이월 가능 업무는 ○○입니다. 퇴근 전까지 ○○하겠습니다."],
];

export function MorningPT({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const phase = view.phase.value;
  const header = (
    <PanelHeader
      place="회의실"
      title="아침 PT"
      detail={"오늘 할 일을 3단계부터 1단계 순서로 말해 주세요.\n확정한 업무로 퇴근 점검을 합니다."}
    />
  );

  if (phase === "beforeCheckIn") {
    return (
      <div className="panel">
        {header}
        <Notice kind="info" title="출근한 뒤 아침 PT를 합니다">
          출입문에서 출근 버튼을 먼저 눌러 주세요.
        </Notice>
      </div>
    );
  }
  if (phase !== "morningPT") {
    return (
      <div className="panel">
        {header}
        <Notice kind="ok" title="오늘 업무를 이미 확정했습니다" />
        <Card title="확정한 업무">
          {view.state.day.tasks.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              확정한 업무가 없습니다.
            </p>
          ) : (
            view.state.day.tasks.map((t) => (
              <div key={t.id} className="row">
                <LevelBadge level={t.level} />
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                <span className="small muted">마감 {Clock.hm(t.due)}</span>
              </div>
            ))
          )}
        </Card>
      </div>
    );
  }
  return <MorningPTEditor office={office} view={view} header={header} />;
}

function MorningPTEditor({ office, view, header }: { office: OfficeHandle; view: OfficeView; header: React.ReactNode }) {
  const pt = view.morningPT;
  const [transcript, setTranscript] = useState(view.state.day.transcript);
  const [drafting, setDrafting] = useState(false);
  const [solarError, setSolarError] = useState<SolarErrorInfo | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);

  const saveTranscript = async () => {
    if (transcript !== view.state.day.transcript) await office.save("setTranscript", { transcript });
  };

  // 인식된 글은 적어 둔 전사문 뒤에 덧붙이고 바로 저장한다(직접 적은 글을 지우지 않는다).
  const addSpoken = (text: string) => {
    const next = transcript.trim() ? `${transcript.trimEnd()}\n${text}` : text;
    setTranscript(next);
    void office.save("setTranscript", { transcript: next });
  };

  const makeDraft = async () => {
    if (!transcript.trim()) {
      office.notify("전사문이 비어 있습니다.\n직접 적거나 '예시 넣기'를 눌러 주세요.");
      return;
    }
    if (pt.drafts.some((d) => !d.isCarried) && !window.confirm("초안을 새로 만들까요?\n지금 고친 초안은 바뀝니다.")) return;
    setDrafting(true);
    const res = await office.run(() => api.draft(transcript));
    setDrafting(false);
    if (res) {
      setSolarError(res.result.solarError);
      setSeconds(res.result.seconds);
    }
  };

  const confirm = async () => {
    if ((await office.act("confirmTasks")) != null) office.notify("업무를 확정했습니다.\n근무를 시작합니다.");
  };

  return (
    <div className="panel">
      {header}

      <Card title="발표 양식">
        {FORM_GUIDE.map(([level, example]) => (
          <div key={level} className="row" style={{ alignItems: "flex-start" }}>
            <LevelBadge level={level} />
            <span className="muted">{example}</span>
          </div>
        ))}
      </Card>

      <Card
        title="전사문"
        aside={
          <button className="btn plain small" onClick={() => setTranscript(SAMPLE_PT)}>
            예시 넣기
          </button>
        }
      >
        <VoiceInput onText={addSpoken} disabled={office.busy || drafting} />
        <textarea
          className="field"
          aria-label="전사문"
          rows={6}
          value={transcript}
          placeholder={"녹음하면 여기에 글이 들어옵니다.\n직접 적어도 됩니다."}
          onChange={(e) => setTranscript(e.target.value)}
          onBlur={saveTranscript}
        />
        <button className="btn" onClick={makeDraft} disabled={office.busy || drafting}>
          {drafting ? "업무 초안을 만드는 중" : "업무 초안 만들기"}
        </button>
        {solarError ? (
          <Notice kind="warning" title={solarError.title}>
            {`${solarError.guidance}\n아래는 서버 규칙으로 정리한 초안입니다.`}
            <div className="row" style={{ marginTop: 8 }}>
              {solarError.canRetry ? (
                <button className="btn secondary small" onClick={makeDraft} disabled={drafting}>
                  Solar로 다시 시도
                </button>
              ) : null}
            </div>
          </Notice>
        ) : null}
      </Card>

      <Card
        title="업무 체크리스트"
        aside={pt.draftSourceLabel ? <span className="badge tag">{pt.draftSourceLabel}</span> : undefined}
      >
        {seconds != null ? <div className="small muted">초안까지 {seconds}초</div> : null}
        {pt.drafts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            아직 업무가 없습니다. 초안을 만들거나 직접 추가해 주세요.
          </p>
        ) : (
          pt.drafts.map((d) => <DraftRow key={d.id} draft={d} office={office} workEnd={view.state.profile.workEnd} />)
        )}
        <button className="btn secondary" onClick={() => office.act("addDraft")} disabled={office.busy}>
          업무 직접 추가
        </button>
      </Card>

      {pt.blocker && pt.drafts.length > 0 ? (
        <Notice kind="warning" title="확인이 필요합니다">
          {pt.blocker.message}
        </Notice>
      ) : null}

      <button className="btn" onClick={confirm} disabled={office.busy || !view.can.confirmTasks}>
        확정하고 근무 시작
      </button>
    </div>
  );
}

function DraftRow({ draft, office, workEnd }: { draft: Draft; office: OfficeHandle; workEnd: number }) {
  const [title, setTitle] = useState(draft.title ?? "");
  const [due, setDue] = useState(draft.due != null ? Clock.hm(draft.due) : "");
  const [criteria, setCriteria] = useState(draft.doneCriteria ?? "");
  const [dueError, setDueError] = useState(false);

  // 초안을 새로 만들면(서버 값이 바뀌면) 칸도 새 값으로.
  useEffect(() => setTitle(draft.title ?? ""), [draft.title]);
  useEffect(() => setDue(draft.due != null ? Clock.hm(draft.due) : ""), [draft.due]);
  useEffect(() => setCriteria(draft.doneCriteria ?? ""), [draft.doneCriteria]);

  const update = (patch: Record<string, unknown>) => office.save("updateDraft", { id: draft.id, ...patch });
  const missing = new Set(draft.missingFields);
  const need = (field: string, label: string) => (missing.has(field) ? `확인 필요 · ${label}` : label);

  const saveDue = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setDueError(false);
      if (draft.due != null) void update({ due: null });
      return;
    }
    const minutes = Clock.minutesFromHM(trimmed);
    setDueError(minutes == null);
    if (minutes != null && minutes !== draft.due) void update({ due: minutes });
  };

  return (
    <div className="card" style={{ background: "var(--paper)", gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <LevelBadge level={draft.level} />
          {draft.isCarried ? <span className="badge tag">이월 {draft.carryCount}회</span> : null}
        </div>
        {draft.isCarried ? (
          <span className="small muted">이월 업무는 뺄 수 없습니다</span>
        ) : (
          <button className="btn plain small" onClick={() => office.act("removeDraft", { id: draft.id })}>
            이 업무 빼기
          </button>
        )}
      </div>
      <label className="stack">
        {need("업무명", "업무명")}
        <input
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== (draft.title ?? "") && update({ title: title.trim() || null })}
        />
      </label>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{need("중요도", "중요도")}</div>
        <div className="row" role="group" aria-label="중요도">
          {([3, 2, 1] as const).map((level) => (
            <button
              key={level}
              className={`btn small ${draft.level === level ? "" : "secondary"}`}
              aria-pressed={draft.level === level}
              onClick={() => update({ level })}
            >
              {level}단계 · {LEVEL_NAME[level]}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="stack" style={{ width: 130 }}>
          {need("마감", "마감")}
          <input
            className="field"
            value={due}
            placeholder="HH:MM"
            inputMode="numeric"
            onChange={(e) => setDue(e.target.value)}
            onBlur={() => saveDue(due)}
          />
        </label>
        <button
          className="btn plain small"
          onClick={() => {
            setDue(Clock.hm(workEnd));
            saveDue(Clock.hm(workEnd));
          }}
        >
          퇴근 전
        </button>
        {dueError ? <span className="small" style={{ color: "var(--warn)" }}>! HH:MM 형식으로 적어 주세요</span> : null}
      </div>
      <label className="stack">
        {need("완료 기준", "완료 기준")}
        <input
          className="field"
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          onBlur={() => criteria !== (draft.doneCriteria ?? "") && update({ doneCriteria: criteria.trim() || null })}
        />
      </label>
    </div>
  );
}
