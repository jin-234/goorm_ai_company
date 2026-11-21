"use client";
/**
 * 회의실 · 아침보고(개정 기획서 3.1, 4.3 C).
 * 오늘 목표를 적는다 → AI 팀장이 작은 범위·완료 기준·공유 형태를 제안한다 → 사용자가 고치거나 거절하고 확정한다.
 * AI가 연결되지 않으면 적은 목표를 그대로 한 과제 초안으로 옮기고, AI가 답한 것처럼 표시하지 않는다.
 * 초안은 서버에 따로 저장하지 않으므로, 새로고침에 대비해 브라우저에만 잠시 보관한다.
 * 목표는 말로 해도 된다(OpenAI 음성 인식, 선택). 녹음이 안 돼도 글로 끝까지 할 수 있다.
 */
import { useEffect, useState } from "react";
import { type AiSource, api, isSample, type OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, ManualMark, Notice, PanelHeader, SampleMark, StatusBadge } from "../ui";
import { VoiceInput } from "../voice/VoiceInput";

type Row = { key: string; title: string; completionCriteria: string; shareForm: string };

const SHARE_FORMS = ["화면 캡처와 한 줄 설명", "코드 일부와 설명", "배운 내용 요약", "링크와 사용 방법"];
const GOAL_EXAMPLE = "API 요청을 배우고 도시별 날씨 조회 화면을 만들고 싶습니다. 오늘은 3시간 정도 쓸 수 있습니다.";

const newKey = () => Math.random().toString(36).slice(2);
const emptyRow = (): Row => ({ key: newKey(), title: "", completionCriteria: "", shareForm: "" });
const storeKey = (view: OfficeView) => `vision.morning.${view.clock.date}`;

interface Saved {
  rows: Row[];
  source: AiSource | null;
  question: string | null;
}

function load(view: OfficeView): Saved | null {
  try {
    const raw = localStorage.getItem(storeKey(view));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function MorningPT({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const phase = view.phase.value;
  const header = (
    <PanelHeader
      place="회의실"
      title="아침보고"
      detail={"오늘 하고 싶은 일과 쓸 수 있는 시간을 적어 주세요.\nAI 팀장이 오늘 끝낼 작은 범위를 함께 정해 줍니다."}
    />
  );

  if (phase === "beforeCheckIn") {
    return (
      <div className="panel">
        {header}
        <Notice kind="info" title="활동을 시작한 뒤 아침보고를 합니다">
          출입문에서 사원증을 찍고 출근해 주세요.
        </Notice>
      </div>
    );
  }
  if (phase !== "morningPT") {
    return (
      <div className="panel">
        {header}
        <Notice kind="ok" title="오늘 범위를 이미 정했습니다" />
        {view.day.goal ? (
          <Card title="오늘 목표">
            <p className="pre" style={{ margin: 0 }}>
              {view.day.goal}
            </p>
          </Card>
        ) : null}
        <Card title="확정한 과제">
          {view.day.tasks.map((t) => (
            <div key={t.id}>
              <div className="row">
                <StatusBadge status={t.status} />
                <strong>{t.title}</strong>
              </div>
              <div className="small muted">
                완료 기준: {t.completionCriteria} · 공유 형태: {t.shareForm}
              </div>
            </div>
          ))}
        </Card>
      </div>
    );
  }
  return <MorningEditor office={office} view={view} header={header} />;
}

function MorningEditor({ office, view, header }: { office: OfficeHandle; view: OfficeView; header: React.ReactNode }) {
  const [goal, setGoal] = useState(view.day.goal);
  const [minutes, setMinutes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<AiSource | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  // 새로고침해도 초안이 남게: 처음 그릴 때 불러오고, 바뀔 때마다 저장한다.
  useEffect(() => {
    const saved = load(view);
    if (saved) {
      setRows(saved.rows);
      setSource(saved.source);
      setQuestion(saved.question);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      localStorage.setItem(storeKey(view), JSON.stringify({ rows, source, question } satisfies Saved));
    } catch {
      // 저장하지 못해도 이번 화면에서는 계속 쓸 수 있다.
    }
  }, [rows, source, question]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveGoal = () => {
    if (goal !== view.day.goal) void office.save("saveGoal", { goal });
  };

  // 말로 한 내용은 적어 둔 목표 뒤에 덧붙이고 바로 저장한다(직접 적은 글을 지우지 않는다).
  const addSpoken = (text: string) => {
    const next = goal.trim() ? `${goal.trimEnd()}\n${text}` : text;
    setGoal(next);
    void office.save("saveGoal", { goal: next });
  };

  const ask = async () => {
    if (!goal.trim()) {
      office.notify("오늘 하고 싶은 일을 먼저 적어 주세요.");
      return;
    }
    if (rows.some((r) => r.title.trim()) && !window.confirm("지금 고친 초안을 새 제안으로 바꿀까요?")) return;
    saveGoal();
    setAsking(true);
    const mins = Number(minutes);
    const res = await office.run(async () => {
      const r = await api.leader(goal.trim(), Number.isFinite(mins) && mins > 0 ? mins : undefined);
      return { ...r, office: r.office ?? view };
    });
    setAsking(false);
    if (!res) return;
    setSource(res.source);
    setQuestion(res.proposal.question?.trim() || null);
    setRows(
      res.proposal.tasks.length
        ? res.proposal.tasks.map((t) => ({ key: newKey(), ...t }))
        : [{ ...emptyRow(), title: goal.trim() }],
    );
  };

  /** 제안 거절: 제안을 지우고 내가 적은 목표를 그대로 한 과제로 시작한다. */
  const reject = () => {
    setRows([{ ...emptyRow(), title: goal.trim() }]);
    setSource(null);
    setQuestion(null);
    office.notify("제안을 쓰지 않기로 했습니다.\n과제를 직접 적어 주세요.");
  };

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const missing = rows.flatMap((r, i) => {
    const m = [!r.title.trim() && "과제", !r.completionCriteria.trim() && "완료 기준", !r.shareForm.trim() && "공유 형태"].filter(Boolean);
    return m.length ? [`· ${r.title.trim() || `${i + 1}번째 과제`}: ${m.join(", ")}`] : [];
  });
  const canConfirm = view.can.confirmTasks && (rows.length > 0 || view.pendingCarry.length > 0) && missing.length === 0;

  const confirm = async () => {
    const tasks = rows.map(({ title, completionCriteria, shareForm }) => ({
      title: title.trim(),
      completionCriteria: completionCriteria.trim(),
      shareForm: shareForm.trim(),
    }));
    if ((await office.act("confirmTasks", { goal: goal.trim(), tasks })) == null) return;
    try {
      localStorage.removeItem(storeKey(view));
    } catch {
      // 지우지 못해도 다음 날 키가 달라 문제없다.
    }
    office.notify("오늘 범위를 확정했습니다.\n내 책상에서 시작해 주세요.");
  };

  return (
    <div className="panel">
      {header}

      {view.pendingCarry.length > 0 ? (
        <Card title={`지난 활동일에서 넘어온 일 ${view.pendingCarry.length}건`}>
          <p className="small muted" style={{ margin: 0 }}>
            확정하면 오늘 목록 앞에 그대로 붙습니다.
          </p>
          {view.pendingCarry.map((t) => (
            <div key={t.id}>
              <strong>{t.title}</strong> <span className="badge tag">넘어온 {t.carryCount}회</span>
              <div className="small muted">완료 기준: {t.completionCriteria}</div>
            </div>
          ))}
        </Card>
      ) : null}

      <Card
        title="오늘 하고 싶은 일"
        aside={
          <button className="btn plain small" onClick={() => setGoal(GOAL_EXAMPLE)}>
            예시 넣기
          </button>
        }
      >
        <VoiceInput onText={addSpoken} disabled={office.busy || asking} />
        <textarea
          className="field"
          aria-label="오늘 하고 싶은 일"
          rows={4}
          value={goal}
          placeholder="예: React 상태 관리를 배우고 할 일 목록에 적용해 보고 싶습니다."
          onChange={(e) => setGoal(e.target.value)}
          onBlur={saveGoal}
        />
        <label className="stack" style={{ maxWidth: 220 }}>
          쓸 수 있는 시간(분, 선택)
          <input className="field" inputMode="numeric" value={minutes} placeholder="예: 180" onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} />
        </label>
        <button className="btn" onClick={ask} disabled={office.busy || asking}>
          {asking ? "AI 팀장이 생각하는 중" : "AI 팀장에게 범위 제안 받기"}
        </button>
        <button className="btn plain small" onClick={() => setRows((rs) => [...rs, { ...emptyRow(), title: rs.length ? "" : goal.trim() }])}>
          제안 없이 직접 적기
        </button>
      </Card>

      {rows.length > 0 ? (
        <Card
          title="오늘 끝낼 범위"
          aside={
            source === "solar" || isSample(source) ? (
              <span className="row" style={{ gap: 6 }}>
                <span className="badge tag">AI 팀장 제안 · 고칠 수 있음</span>
                {isSample(source) ? <SampleMark /> : null}
              </span>
            ) : source === "manual" ? (
              <ManualMark />
            ) : (
              <span className="badge tag">직접 작성</span>
            )
          }
        >
          {source === "manual" ? (
            <Notice kind="info" title="AI 팀장에 연결하지 못했습니다">
              {"적은 목표를 그대로 한 과제로 옮겼습니다.\n완료 기준과 공유 형태를 직접 정해 주세요."}
            </Notice>
          ) : null}
          {(source === "solar" || isSample(source)) && question ? (
            <Notice kind="info" title="AI 팀장의 확인 질문">
              {question}
            </Notice>
          ) : null}
          {rows.map((r, i) => (
            <div key={r.key} className="card" style={{ background: "var(--paper)", gap: 8, padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>과제 {i + 1}</strong>
                <button className="btn plain small" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  이 과제 빼기
                </button>
              </div>
              <label className="stack">
                {r.title.trim() ? "과제" : "확인 필요 · 과제"}
                <input className="field" value={r.title} onChange={(e) => update(r.key, { title: e.target.value })} />
              </label>
              <label className="stack">
                {r.completionCriteria.trim() ? "완료 기준" : "확인 필요 · 완료 기준"}
                <input
                  className="field"
                  value={r.completionCriteria}
                  placeholder="예: 도시를 입력하면 기온이 화면에 보인다"
                  onChange={(e) => update(r.key, { completionCriteria: e.target.value })}
                />
              </label>
              <label className="stack">
                {r.shareForm.trim() ? "회의실에서 발표할 형태" : "확인 필요 · 회의실에서 발표할 형태"}
                <input className="field" value={r.shareForm} onChange={(e) => update(r.key, { shareForm: e.target.value })} />
              </label>
              <div className="row">
                {SHARE_FORMS.map((f) => (
                  <button key={f} className="btn plain small" onClick={() => update(r.key, { shareForm: f })}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="row">
            <button className="btn secondary" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
              과제 추가
            </button>
            {source === "solar" || isSample(source) ? (
              <button className="btn plain" onClick={reject}>
                이 제안 쓰지 않기
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {rows.length > 0 && missing.length > 0 ? (
        <Notice kind="warning" title="확인이 필요합니다">
          {missing.join("\n")}
        </Notice>
      ) : null}

      <button className="btn" onClick={confirm} disabled={office.busy || !canConfirm}>
        이 범위로 확정하고 시작
      </button>
    </div>
  );
}
