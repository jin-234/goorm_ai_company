"use client";
/**
 * 주간보고(금요일). 세 칸을 직접 쓰고(입력을 마치면 초안 저장) 제출하면 팀장 답장을 받는다.
 * Solar가 실패하면 '다시 시도'·'기본 답장 받기'를 고른다. 초안은 지우지 않는다.
 */
import { useEffect, useState } from "react";
import { hm, koreanShort, dayKeyOf } from "@/lib/office/time";
import { api, type OfficeView, type SolarErrorInfo } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader, type PlaceId } from "../ui";

const FIELDS = [
  ["completed", "1. 이번 주 완료한 업무와 결과물"],
  ["incomplete", "2. 미완료 업무와 이유"],
  ["nextGoals", "3. 다음 주 목표"],
] as const;

type FieldKey = (typeof FIELDS)[number][0];

export function Weekly({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const draft = view.weekly.draft;
  const [values, setValues] = useState<Record<FieldKey, string>>({
    completed: draft.completed,
    incomplete: draft.incomplete,
    nextGoals: draft.nextGoals,
  });
  const [replying, setReplying] = useState(false);
  const [solarError, setSolarError] = useState<SolarErrorInfo | null>(null);

  // 다른 주로 넘어가면(금요일 장면 등) 서버 초안으로 다시 채운다.
  useEffect(() => {
    setValues({ completed: draft.completed, incomplete: draft.incomplete, nextGoals: draft.nextGoals });
  }, [draft.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 서버가 이번 주에 제출한 보고서만 lastSubmitted로 준다.
  const thisWeek = view.weekly.lastSubmitted;
  const submittedThisWeek = thisWeek != null;
  const missing = FIELDS.filter(([k]) => !values[k].trim()).map(([, label]) => label.slice(3));

  const save = (key: FieldKey) => {
    if (values[key] !== draft[key]) void office.save("saveWeeklyDraft", { [key]: values[key] });
  };

  const askReply = async (fallback: boolean) => {
    setReplying(true);
    const res = await office.run(() => api.weeklyFeedback(fallback));
    setReplying(false);
    if (!res) return;
    setSolarError(res.result.solarError);
    if (!res.result.solarError) office.notify("팀장의 주간 피드백이 도착했습니다.\n메일함에서 확인해 주세요.");
  };

  const submit = async () => {
    if ((await office.act("submitWeeklyReport", values)) == null) return;
    await askReply(false);
  };

  const header = <PanelHeader place="주간보고" title="주간보고서" detail={`${view.clock.weekLabel} · 양식에 맞춰 직접 씁니다.`} />;

  if (submittedThisWeek && thisWeek) {
    return (
      <div className="panel">
        {header}
        <Notice kind="ok" title="주간보고서를 제출했습니다">
          {`제출 시각 ${koreanShort(dayKeyOf(thisWeek.submittedAt!))} ${hm(thisWeek.submittedAt!)}`}
        </Notice>
        {thisWeek.replyMailId ? (
          <button className="btn" onClick={() => onGo("manager")}>
            팀장 답장 읽기
          </button>
        ) : replying ? (
          <Notice kind="info" title="팀장이 답장을 쓰고 있습니다." />
        ) : (
          <Notice kind={solarError ? "warning" : "info"} title={solarError ? solarError.title : "아직 답장을 받지 못했습니다"}>
            {solarError ? solarError.guidance : "다시 시도하거나 기본 답장을 받을 수 있습니다."}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn secondary small" onClick={() => askReply(false)} disabled={office.busy}>
                다시 시도
              </button>
              <button className="btn secondary small" onClick={() => askReply(true)} disabled={office.busy}>
                기본 답장 받기
              </button>
              <button className="btn plain small" onClick={() => onGo("settings")}>
                설정
              </button>
            </div>
          </Notice>
        )}
        <Card title="제출한 보고서">
          {FIELDS.map(([k, label]) => (
            <div key={k}>
              <div style={{ fontWeight: 700 }}>{label}</div>
              <div className="pre muted">{thisWeek[k]}</div>
            </div>
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div className="panel">
      {header}
      {!view.clock.isFriday ? (
        <Notice kind="info" title="주간보고서는 금요일에 제출합니다">
          {"미리 써 두면 초안으로 저장됩니다.\n위 막대의 '금요일 장면'으로 금요일 아침으로 갈 수 있습니다."}
        </Notice>
      ) : view.day.checkInAt == null ? (
        <Notice kind="info" title="출근한 뒤 제출할 수 있습니다" />
      ) : null}
      <Card>
        {FIELDS.map(([k, label]) => (
          <label key={k} className="stack">
            {label}
            <textarea
              className="field"
              value={values[k]}
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              onBlur={() => save(k)}
            />
          </label>
        ))}
      </Card>
      {missing.length > 0 ? <div className="small muted">아직 쓰지 않은 칸: {missing.join(", ")}</div> : null}
      <button className="btn" onClick={submit} disabled={office.busy || replying || !view.can.submitWeekly || missing.length > 0}>
        주간보고서 제출
      </button>
    </div>
  );
}
