"use client";
/**
 * 회의실 · 아침보고.
 * 오늘 목표(말하기 → OpenAI 음성 인식, 안 되면 글 입력) → AI 팀장 과제 초안(Solar, 실패하면 서버 규칙) → 칸 고치기 → 확정.
 * 과제 초안은 화면이 들고 있고(이 브라우저에도 잠깐 보관), 서버에는 확정한 과제만 저장한다.
 * 이월된 과제는 원본을 보존한 채 목록 앞에 붙고 빼지 않는다.
 */
import { useEffect, useRef, useState } from "react";
import { TASK_LEVEL_LABEL, TASK_LEVELS, type TaskLevel } from "@/lib/office/models";
import { api, type OfficeView, type SolarErrorInfo } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader, StatusBadge } from "../ui";
import { VoiceInput } from "../voice/VoiceInput";

interface Row {
  key: string;
  title: string;
  completionCriteria: string;
  shareForm: string;
  /** 중요도(보통·엄격). 직접 고른다. */
  level?: TaskLevel | null;
  /** 이월 과제면 pendingCarry의 ID. */
  carryId?: string;
  carryCount?: number;
}

export const SAMPLE_GOAL = `API 요청을 배우고 도시별 날씨 조회 화면 만들기.
도시를 입력하면 현재 기온과 날씨를 보여 주는 화면까지 오늘 끝내겠습니다.
남는 시간에는 실패했을 때 보여 줄 안내 문구를 정리하겠습니다.`;

const SHARE_EXAMPLES = ["화면 캡처와 3줄 설명", "코드 링크와 동작 설명", "배운 점 3가지"];

const emptyRow = (): Row => ({ key: crypto.randomUUID(), title: "", completionCriteria: "", shareForm: "" });

const draftKey = (date: string) => `vision.ptDraft.${date}`;

function loadRows(date: string): Row[] | null {
  try {
    const raw = localStorage.getItem(draftKey(date));
    return raw ? (JSON.parse(raw) as Row[]) : null;
  } catch {
    return null;
  }
}

function storeRows(date: string, rows: Row[] | null) {
  try {
    if (rows) localStorage.setItem(draftKey(date), JSON.stringify(rows));
    else localStorage.removeItem(draftKey(date));
  } catch {
    // 보관하지 못해도 이번 화면에서는 계속 쓴다.
  }
}

export function MorningPT({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const phase = view.phase.value;
  const header = (
    <PanelHeader
      place="회의실"
      title="아침보고"
      detail={"오늘 할 일과 가능한 범위를 말해 주세요.\nAI 팀장이 결과물과 완료 기준을 제안하고, 확정은 직접 합니다."}
    />
  );

  if (phase === "beforeCheckIn") {
    return (
      <div className="panel">
        {header}
        <Notice kind="info" title="출근한 뒤 아침보고를 합니다">
          출입문에서 출근 버튼을 먼저 눌러 주세요.
        </Notice>
      </div>
    );
  }
  if (phase !== "morningPT") {
    return (
      <div className="panel">
        {header}
        <Notice kind="ok" title="오늘 과제를 이미 확정했습니다" />
        {view.day.goal ? (
          <Card title="오늘 목표">
            <div className="pre">{view.day.goal}</div>
          </Card>
        ) : null}
        <Card title="확정한 과제">
          {view.day.tasks.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              확정한 과제가 없습니다.
            </p>
          ) : (
            view.day.tasks.map((t) => (
              <div key={t.id} className="row">
                <StatusBadge status={t.status} label={t.statusLabel} />
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                <span className="small muted">완료 기준: {t.completionCriteria}</span>
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
  const date = view.clock.date;
  const carried: Row[] = view.pendingCarry.map((t) => ({
    key: t.id,
    title: t.title,
    completionCriteria: t.completionCriteria,
    shareForm: t.shareForm,
    level: t.level,
    carryId: t.id,
    carryCount: t.carryCount,
  }));
  const needLevel = view.enforcement.rules.taskLevels;
  const [goal, setGoal] = useState(view.day.goal);
  const [rows, setRows] = useState<Row[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [solarError, setSolarError] = useState<SolarErrorInfo | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const loaded = useRef(false);

  // 처음 열 때: 이 브라우저에 보관한 초안이 있으면 되살리고, 없으면 이월 과제로 시작한다.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const saved = loadRows(date);
    const savedCarry = new Map((saved ?? []).filter((r) => r.carryId).map((r) => [r.carryId!, r]));
    const fresh = (saved ?? []).filter((r) => !r.carryId);
    setRows([...carried.map((c) => savedCarry.get(c.carryId!) ?? c), ...fresh]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: Row[]) => {
    setRows(next);
    storeRows(date, next);
  };
  const patch = (key: string, fields: Partial<Row>) => update(rows.map((r) => (r.key === key ? { ...r, ...fields } : r)));

  const saveGoal = async () => {
    if (goal !== view.day.goal) await office.save("saveGoal", { goal });
  };

  // 인식된 글은 적어 둔 목표 뒤에 덧붙이고 바로 저장한다(직접 적은 글을 지우지 않는다).
  const addSpoken = (text: string) => {
    const next = goal.trim() ? `${goal.trimEnd()}\n${text}` : text;
    setGoal(next);
    void office.save("saveGoal", { goal: next });
  };

  const makeDraft = async () => {
    if (!goal.trim()) {
      office.notify("오늘 목표가 비어 있습니다.\n말하거나 직접 적어 주세요.");
      return;
    }
    if (rows.some((r) => !r.carryId) && !window.confirm("초안을 새로 받을까요?\n지금 고친 과제는 바뀝니다.")) return;
    setDrafting(true);
    const res = await office.run(() => api.draft(goal));
    setDrafting(false);
    if (!res) return;
    const { tasks, solarError: err, source, seconds: s } = res.result;
    setSolarError(err);
    setSeconds(s);
    setSourceLabel(source === "solar" ? "AI 팀장 제안" : "서버 규칙 초안");
    update([...rows.filter((r) => r.carryId), ...tasks.map((t) => ({ ...t, key: crypto.randomUUID() }))]);
  };

  const confirm = async () => {
    const tasks = rows.map(({ title, completionCriteria, shareForm, level, carryId }) => ({
      title,
      completionCriteria,
      shareForm,
      level: needLevel ? (level ?? null) : null,
      ...(carryId ? { carryId } : {}),
    }));
    if ((await office.act("confirmTasks", { goal, tasks })) != null) {
      storeRows(date, null);
      office.notify("오늘 과제를 확정했습니다.\n내 책상에서 수행하고 결과물을 제출하세요.");
    }
  };

  const missing = rows.some((r) => !r.title.trim() || !r.completionCriteria.trim() || (needLevel && r.level == null));

  return (
    <div className="panel">
      {header}

      <Card
        title="오늘 목표"
        aside={
          <button className="btn plain small" onClick={() => setGoal(SAMPLE_GOAL)}>
            예시 넣기
          </button>
        }
      >
        <VoiceInput onText={addSpoken} disabled={office.busy || drafting} />
        <textarea
          className="field"
          aria-label="오늘 목표"
          rows={5}
          value={goal}
          placeholder={"오늘 할 일과 가능한 범위를 적어 주세요.\n말하기를 누르면 여기에 글이 들어옵니다."}
          onChange={(e) => setGoal(e.target.value)}
          onBlur={saveGoal}
        />
        <button className="btn" onClick={makeDraft} disabled={office.busy || drafting}>
          {drafting ? "AI 팀장이 과제를 정리하는 중" : "AI 팀장에게 과제 제안 받기"}
        </button>
        {solarError ? (
          <Notice kind="warning" title={solarError.title}>
            {`${solarError.guidance}\n아래는 서버 규칙으로 정리한 초안입니다. 칸을 직접 고쳐 주세요.`}
            {solarError.canRetry ? (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn secondary small" onClick={makeDraft} disabled={drafting}>
                  다시 시도
                </button>
              </div>
            ) : null}
          </Notice>
        ) : null}
      </Card>

      <Card title="오늘 과제" aside={sourceLabel ? <span className="badge tag">{sourceLabel}</span> : undefined}>
        {seconds != null ? <div className="small muted">초안까지 {seconds}초</div> : null}
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            아직 과제가 없습니다. 제안을 받거나 직접 추가해 주세요.
          </p>
        ) : (
          rows.map((r, i) => (
            <TaskRow
              key={r.key}
              row={r}
              index={i}
              needLevel={needLevel}
              onChange={(f) => patch(r.key, f)}
              onRemove={() => update(rows.filter((x) => x.key !== r.key))}
            />
          ))
        )}
        <button className="btn secondary" onClick={() => update([...rows, emptyRow()])} disabled={office.busy}>
          과제 직접 추가
        </button>
      </Card>

      {missing ? (
        <Notice kind="warning" title="확인이 필요한 칸이 있습니다">
          {needLevel ? "과제마다 과제명·완료 기준·중요도를 채워 주세요." : "과제마다 과제명과 완료 기준을 채워 주세요."}
        </Notice>
      ) : null}

      <button className="btn" onClick={confirm} disabled={office.busy || !view.can.confirmTasks || rows.length === 0 || missing}>
        확정하고 수행 시작
      </button>
    </div>
  );
}

function TaskRow({
  row,
  index,
  needLevel,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  needLevel: boolean;
  onChange: (fields: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const need = (value: string, label: string) => (value.trim() ? label : `확인 필요 · ${label}`);
  return (
    <div className="card" style={{ background: "var(--paper)", gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <span style={{ fontWeight: 700 }}>{index + 1}</span>
          {row.carryId ? <span className="badge tag">이월 {row.carryCount}회</span> : null}
        </div>
        {row.carryId ? (
          <span className="small muted">이월 과제는 뺄 수 없습니다 · 마감 때 처리를 고릅니다</span>
        ) : (
          <button className="btn plain small" onClick={onRemove}>
            이 과제 빼기
          </button>
        )}
      </div>
      <label className="stack">
        {need(row.title, "과제명")}
        <input className="field" value={row.title} onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      <label className="stack">
        {need(row.completionCriteria, "완료 기준 (무엇이 되면 끝인지)")}
        <input
          className="field"
          value={row.completionCriteria}
          placeholder="예: 도시를 입력하면 기온이 화면에 나온다"
          onChange={(e) => onChange({ completionCriteria: e.target.value })}
        />
      </label>
      {needLevel ? (
        <div className="stack">
          <span>{row.level == null ? "확인 필요 · 중요도" : "중요도"}</span>
          <div className="row" role="radiogroup" aria-label={`${row.title || `${index + 1}번째 과제`} 중요도`}>
            {TASK_LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                role="radio"
                aria-checked={row.level === lv}
                className={`btn small ${row.level === lv ? "" : "secondary"}`}
                onClick={() => onChange({ level: lv })}
              >
                {TASK_LEVEL_LABEL[lv]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <label className="stack">
        공유 형태 (선택)
        <input
          className="field"
          value={row.shareForm}
          placeholder="예: 화면 캡처와 3줄 설명"
          onChange={(e) => onChange({ shareForm: e.target.value })}
        />
      </label>
      {!row.shareForm ? (
        <div className="row">
          {SHARE_EXAMPLES.map((ex) => (
            <button key={ex} className="btn plain small" onClick={() => onChange({ shareForm: ex })}>
              {ex}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
