"use client";
/**
 * 타 부서 공유(AI 동료 프롬프트 문서 1·5·10·12·13장, 부록 B).
 * ① 개발팀장 사전 보고: 팀장 인사 → 내 설명 → 피드백+질문(최대 2회) → 컨펌 카드. 결과와 관계없이 회의로 갈 수 있다.
 * ② 부서 회의(디자인·마케팅·기획, 진행 기획팀): 진행자 인사 → 내 설명 → 부서마다 질문 → 답 → 피드백·설명 확인
 *    → 한 바퀴 뒤 진행자 정리(되말하기·부서별 남은 확인·다음 행동), 필요하면 한 바퀴 더.
 * ③ 회의록: 서버가 정리한 날짜별 폴더의 파일을 보고 내려받는다.
 * 모든 동료는 가상 인물이다. AI 연결 전 예시 응답·AI 미연결 양식은 AI가 말한 것처럼 보이지 않게 표시한다.
 */
import { useEffect, useRef, useState } from "react";
import { api, isManual, isSample, type OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, ManualMark, Notice, PanelHeader, type PlaceId, SampleMark } from "../ui";
import { VoiceInput } from "../voice/VoiceInput";
import {
  type ColleagueReply,
  DEPT_NAME,
  type DeptId,
  LAYER_NAME,
  type MeetingTurn,
  shareOf,
  type ShareView,
  STATUS_NAME,
} from "./meetingTypes";
import { SubmissionLine } from "./TaskList";

/** 설명할 때 놓치기 쉬운 상황. 누르면 입력창에 말머리를 넣는다. */
const MISSED_CASES: [string, string][] = [
  ["빈 화면", "처음 열어 아무것도 없을 때는 "],
  ["오류가 났을 때", "오류가 나면 "],
  ["기다리는 동안(로딩)", "결과를 기다리는 동안에는 "],
  ["잘못 입력했을 때", "잘못 입력하면 "],
];

const DECISION_KIND = { approved: "ok", approved_with_notes: "info", revise: "warning" } as const;

function speakerOf(share: ShareView, dept: DeptId | undefined) {
  if (!dept) return { title: "AI 동료", persona: "" };
  const base = DEPT_NAME[dept];
  if (dept === "dev_lead") return { title: `${base.name} · ${base.team}`, persona: share.review?.lead.personaLabel ?? "" };
  const p = share.meeting?.participants.find((x) => x.dept === dept);
  const host = share.meeting?.host === dept ? " · 진행" : "";
  return { title: `${p?.name ?? base.name} · ${p?.team ?? base.team}${host}`, persona: p?.personaLabel ?? "" };
}

function ColleagueCard({ turn, share }: { turn: MeetingTurn; share: ShareView }) {
  const r = turn.reply as ColleagueReply;
  const who = speakerOf(share, turn.dept);
  const manual = isManual(turn.source);
  const isClose = turn.meetingRole === "close";
  const term = r.term_explain ?? (r.termFallback ? { term: r.termFallback.term, plain: r.termFallback.plain, example: "", why_we_use: "" } : null);
  return (
    <div
      className="card"
      style={{ gap: 6, padding: 12, borderLeft: manual ? undefined : "4px solid var(--green)", background: manual ? "var(--paper-deep)" : undefined }}
    >
      <div className="row" style={{ gap: 6 }}>
        <span className="small" style={{ fontWeight: 700, color: "var(--green)" }}>
          {who.title}
        </span>
        {who.persona ? <span className="badge tag">{who.persona}</span> : null}
        {isSample(turn.source) ? <SampleMark /> : null}
        {manual ? <ManualMark text="AI 미연결 · 정해진 안내 문구" /> : null}
      </div>

      {r.acknowledgement ? <div className="pre">{r.acknowledgement}</div> : null}

      {r.feedback ? (
        <div className="small" style={{ display: "grid", gap: 2, background: "var(--green-soft)", borderRadius: 8, padding: "8px 10px" }}>
          {r.feedback.strength ? <div>잘한 점 · {r.feedback.strength}</div> : null}
          {r.feedback.perspective ? <div>{isClose ? "정리" : "직무 관점"} · {r.feedback.perspective}</div> : null}
          {r.feedback.try_next ? <div>다음에 써볼 것 · {r.feedback.try_next}</div> : null}
        </div>
      ) : null}

      {r.question ? (
        <div>
          <div className="pre" style={{ fontWeight: 600 }}>
            {r.question}
          </div>
          {r.question_reason ? <div className="small muted pre">묻는 이유: {r.question_reason}</div> : null}
        </div>
      ) : null}

      {r.basisLabel ? <div className="small muted">{r.basisLabel}</div> : null}

      {r.understanding_check ? (
        <div className="small" style={{ borderTop: "1px dashed var(--line)", paddingTop: 6 }}>
          <span style={{ fontWeight: 700 }}>설명 확인</span> · {LAYER_NAME[r.understanding_check.layer]} ·{" "}
          {STATUS_NAME[r.understanding_check.status]}
          {r.understanding_check.gap ? <span className="muted"> — {r.understanding_check.gap}</span> : null}
        </div>
      ) : null}

      {r.terms_used.length > 0 ? (
        <div className="small muted">
          용어 메모 · {r.terms_used.map((t) => `${t.term}: ${t.plain}`).join(" / ")}
        </div>
      ) : null}

      {term ? (
        <div className="small" style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontWeight: 700 }}>용어 설명 · {term.term}</div>
          <div>{term.plain}</div>
          {term.example ? <div className="muted">예: {term.example}</div> : null}
          {term.why_we_use ? <div className="muted">이 말을 쓰는 이유: {term.why_we_use}</div> : null}
          {!r.term_explain ? <div className="muted">부서 용어집 뜻풀이</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Transcript({ turns, share }: { turns: MeetingTurn[]; share: ShareView }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-live="polite">
      {turns.map((t) =>
        t.role === "user" ? (
          <div key={t.id} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--green-soft)", borderRadius: 12, padding: "10px 14px" }}>
            <div className="small muted">나</div>
            <div className="pre">{t.text}</div>
          </div>
        ) : t.role === "system" ? (
          <div key={t.id} className="small pre" style={{ color: "var(--ink-soft)", borderLeft: "3px solid var(--line)", paddingLeft: 10 }}>
            {t.dept ? `${speakerOf(share, t.dept).title} · ` : ""}
            {t.text}
          </div>
        ) : t.reply ? (
          <ColleagueCard key={t.id} turn={t} share={share} />
        ) : null,
      )}
    </div>
  );
}

function Steps({ stage }: { stage: ShareView["stage"] }) {
  const at = stage === "review" || stage === "confirm" ? 0 : stage === "meeting" ? 1 : stage === "closed" ? 2 : -1;
  const items = ["① 개발팀장 사전 보고", "② 부서 회의", "③ 회의록"];
  return (
    <div className="row" aria-label="공유 단계">
      {items.map((label, i) => (
        <span key={label} className={`badge ${i === at ? "l3" : i < at ? "l1" : "tag"}`} aria-current={i === at ? "step" : undefined}>
          {label}
        </span>
      ))}
    </div>
  );
}

function download(name: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Minutes({ minutes }: { minutes: NonNullable<ShareView["minutes"]> }) {
  const [open, setOpen] = useState(minutes.files[0]?.name ?? "");
  const file = minutes.files.find((f) => f.name === open);
  return (
    <Card title="회의록" aside={<span className="badge tag">{minutes.folder}</span>}>
      <p className="small muted pre" style={{ margin: 0 }}>
        {minutes.aiSummarized
          ? "AI가 대화 기록을 바탕으로 정리한 회의록입니다. 원문은 '99_전체 대화 기록'에서 확인하세요."
          : "AI 정리 없음 · 대화 기록만으로 만든 회의록입니다."}
      </p>
      <div className="row" role="tablist" aria-label="회의록 파일">
        {minutes.files.map((f) => (
          <button
            key={f.name}
            role="tab"
            aria-selected={f.name === open}
            className={`btn small ${f.name === open ? "" : "secondary"}`}
            onClick={() => setOpen(f.name)}
          >
            {f.name.replace(/\.md$/, "")}
          </button>
        ))}
      </div>
      {file ? (
        <>
          <div
            className="pre small"
            style={{ maxHeight: 360, overflow: "auto", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}
          >
            {file.markdown}
          </div>
          <div className="row">
            <button className="btn secondary small" onClick={() => download(file.name, file.markdown)}>
              이 파일 내려받기
            </button>
            <button className="btn plain small" onClick={() => minutes.files.forEach((f) => download(f.name, f.markdown))}>
              모두 내려받기 ({minutes.files.length}개)
            </button>
          </div>
        </>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        회의록은 이 브라우저의 내 기록에만 남습니다. 다른 사람과 공유되지 않습니다.
      </p>
    </Card>
  );
}

export function Share({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const phase = view.phase.value;
  const share = shareOf(view);
  const stage = share.stage;
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const stageTurns = stage === "meeting" || stage === "closed" ? (share.meeting?.turns ?? []) : (share.review?.turns ?? []);

  // 중괄호로 감싸 아무것도 돌려주지 않는다(최근 브라우저의 scrollIntoView는 Promise를 돌려준다).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [stageTurns.length]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    let replied = 0;
    await office.run(async () => {
      const r = (await api.share(body)) as { replies?: MeetingTurn[]; office?: OfficeView };
      replied = r.replies?.length ?? 0;
      return { office: r.office ?? view };
    });
    setSending(false);
    // 실패하면 서버가 내 말을 기록하지 않으므로, 적은 글은 지우지 않고 그대로 둔다.
    if (replied > 0) setMessage("");
  };

  const act = async (type: string, payload: Record<string, unknown> = {}, notice?: string) => {
    if ((await office.act(type, payload)) != null && notice) office.notify(notice);
  };

  const finish = async () => {
    if ((await office.act("endSharing", { reason: stage === "closed" ? "done" : "userStopped" })) != null) {
      office.notify("공유를 마쳤습니다.\n내 책상에서 하루 마감을 해 주세요.");
      onGo("desk");
    }
  };

  const inReview = stage === "review" || stage === "confirm";
  const header = (
    <PanelHeader
      place={inReview ? "팀장 자리 · 사전 보고" : "회의실 · 부서 회의"}
      title={inReview ? "개발팀장에게 먼저 보고" : stage === "closed" ? "회의를 마쳤습니다" : "오늘 한 일 공유 회의"}
      detail={
        inReview
          ? "회의에 들어가기 전에 개발팀장에게 오늘 한 일을 먼저 설명합니다.\n팀장이 최대 두 번 묻고, 회의 전에 챙길 것을 알려 줍니다."
          : "디자인·마케팅·기획팀 담당자가 회의실에 와 있습니다(진행: 기획팀).\n한 분씩 돌아가며 자기 업무에 필요한 것을 묻습니다."
      }
    />
  );

  // 공유를 시작하기 전
  if (stage == null) {
    return (
      <div className="panel">
        <PanelHeader place="회의실 · 타 부서 공유" title="오늘 한 일 공유" detail="개발팀장 사전 보고 → 디자인·마케팅·기획팀 회의 → 회의록 순서로 진행합니다." />
        <Steps stage={null} />
        {phase === "working" ? (
          <Notice kind="info" title="결과물을 남겼다면 공유를 시작해 주세요">
            {"내 책상에서 '회의실에서 발표하기'를 누르면\n개발팀장 사전 보고부터 시작합니다."}
            <div style={{ marginTop: 8 }}>
              <button className="btn secondary small" onClick={() => onGo("desk")}>
                내 책상으로
              </button>
            </div>
          </Notice>
        ) : (
          <Notice kind="info" title="아직 공유할 때가 아닙니다">
            내 책상에서 과제를 제출하거나 못 끝낸 것으로 정한 다음 공유를 시작합니다.
          </Notice>
        )}
      </div>
    );
  }

  const active = phase === "sharing" && (stage === "review" || stage === "meeting");
  const subs = view.day.submissions;
  const confirm = share.review?.confirm ?? null;
  const meeting = share.meeting;
  const total = meeting ? meeting.stats.clear + meeting.stats.partial + meeting.stats.unclear : 0;

  return (
    <div className="panel">
      {header}
      <Steps stage={stage} />

      {inReview ? (
        <Card title="이번에 듣는 사람">
          <div className="row">
            <span className="badge l3">AI 팀장 · 개발팀</span>
            {share.review?.lead.personaLabel ? <span className="badge tag">{share.review.lead.personaLabel}</span> : null}
            <span className="chip">{`질문 ${share.review?.questionCount ?? 0} / 최대 ${share.review?.maxQuestions ?? 2}`}</span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            팀장은 회의에서 할 말을 대신 써 주지 않습니다. 확인한 것과 추측을 나눠 설명하면 됩니다.
          </p>
        </Card>
      ) : meeting ? (
        <Card title={`회의 참석 (${meeting.round}바퀴째)`}>
          <div className="row">
            {meeting.participants.map((p) => (
              <span key={p.dept} className="row" style={{ gap: 4 }}>
                <span className={`badge ${p.dept === meeting.host ? "l3" : "l2"}`}>
                  {p.team}
                  {p.dept === meeting.host ? " · 진행" : ""}
                </span>
                <span className="badge tag">{p.personaLabel}</span>
              </span>
            ))}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            모두 가상 인물입니다. 회의 참석자는 팀장 사전 보고 대화를 보지 못했습니다.
          </p>
        </Card>
      ) : null}

      <Card title="동료가 받는 내용">
        <p className="small muted pre" style={{ margin: 0 }}>
          {"내 설명과 오늘 남긴 결과물이 AI 동료에게 전송됩니다.\n링크는 내용을 읽지 않으므로 설명을 기준으로 이야기합니다."}
        </p>
        {subs.length === 0 ? (
          <div className="small muted">남긴 결과물이 없습니다. 설명만으로 대화합니다(설명 기준).</div>
        ) : (
          <details>
            <summary className="small">남긴 결과물 {subs.length}건 보기</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
              {subs.map((s) => (
                <SubmissionLine key={s.id} s={s} />
              ))}
            </div>
          </details>
        )}
      </Card>

      <Card title={inReview ? "사전 보고" : "회의"}>
        {stageTurns.length === 0 ? <p className="muted" style={{ margin: 0 }}>대화를 준비하는 중입니다.</p> : <Transcript turns={stageTurns} share={share} />}
        <div ref={endRef} />

        {stage === "confirm" && confirm ? (
          <div className="card" style={{ gap: 8, padding: 12, background: "var(--paper)" }}>
            <Notice kind={DECISION_KIND[confirm.decision]} title={confirm.decisionLabel}>
              {confirm.decision === "revise" ? "그래도 회의에 들어갈 수 있습니다. 아래 것을 회의에서 '확인 중'이라고 말하면 됩니다." : undefined}
            </Notice>
            <div>
              <div className="small" style={{ fontWeight: 700 }}>
                팀장이 이해한 내용
              </div>
              <div className="pre">{confirm.summary}</div>
            </div>
            {confirm.notes.length > 0 ? (
              <div>
                <div className="small" style={{ fontWeight: 700 }}>
                  회의 전에 챙길 것
                </div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                  {confirm.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button className="btn" onClick={() => act("enterMeeting", {}, "회의실로 이동합니다.\n디자인·마케팅·기획팀이 기다리고 있습니다.")} disabled={office.busy}>
              회의실로 가기
            </button>
          </div>
        ) : null}

        {stage === "closed" && meeting ? (
          <div className="card" style={{ gap: 8, padding: 12, background: "var(--paper)" }}>
            {meeting.close ? (
              <>
                <div>
                  <div className="small" style={{ fontWeight: 700 }}>
                    진행자 정리
                  </div>
                  <div className="pre">{meeting.close.recap}</div>
                </div>
                {meeting.close.openByDept.length > 0 ? (
                  <div>
                    <div className="small" style={{ fontWeight: 700 }}>
                      부서별로 아직 확인할 것
                    </div>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                      {meeting.close.openByDept.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {meeting.close.tryNext ? (
                  <div>
                    <span className="small" style={{ fontWeight: 700 }}>
                      다음 행동
                    </span>{" "}
                    {meeting.close.tryNext}
                  </div>
                ) : null}
              </>
            ) : null}
            {total > 0 ? (
              <div className="row" aria-label="설명 확인 통계">
                <span className="badge l3">{`${STATUS_NAME.clear} ${meeting.stats.clear}`}</span>
                <span className="badge l2">{`${STATUS_NAME.partial} ${meeting.stats.partial}`}</span>
                <span className="badge none">{`${STATUS_NAME.unclear} ${meeting.stats.unclear}`}</span>
              </div>
            ) : null}
            <div className="row">
              {share.canAnotherRound ? (
                <button className="btn secondary" onClick={() => act("anotherRound", {}, "한 바퀴 더 돌아가며 묻습니다.")} disabled={office.busy}>
                  한 바퀴 더
                </button>
              ) : null}
              <button className="btn" onClick={finish} disabled={office.busy || !view.can.endSharing}>
                공유 마치고 하루 마감으로
              </button>
            </div>
          </div>
        ) : null}

        {active ? (
          <>
            <VoiceInput onText={(t) => setMessage((m) => (m.trim() ? `${m.trimEnd()}\n${t}` : t))} disabled={office.busy || sending} />
            {stage === "meeting" ? (
              <details>
                <summary className="small">설명할 때 놓치기 쉬운 상황</summary>
                <div className="row" style={{ marginTop: 6 }}>
                  {MISSED_CASES.map(([label, lead]) => (
                    <button key={label} className="btn plain small" onClick={() => setMessage((m) => (m.trim() ? `${m.trimEnd()}\n${lead}` : lead))}>
                      {label}
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
            <textarea
              className="field"
              aria-label="동료에게 보낼 말"
              rows={3}
              value={message}
              placeholder={stageTurns.some((t) => t.role === "user") ? "질문에 답하거나 덧붙일 말을 적어 주세요. 모르는 용어는 '○○가 뭐예요?'라고 물어도 됩니다." : "오늘 무엇을 했는지, 어떻게 했고 왜 그렇게 했는지 설명해 주세요."}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) void send(message);
              }}
            />
            <div className="row">
              <button className="btn" onClick={() => send(message)} disabled={office.busy || sending || !message.trim()}>
                {sending ? "동료가 읽는 중" : "보내기"}
              </button>
              <button className="btn plain" onClick={finish} disabled={office.busy || sending || !view.can.endSharing}>
                여기서 공유 그만하기
              </button>
            </div>
          </>
        ) : null}
      </Card>

      {stage === "closed" && share.minutes ? <Minutes minutes={share.minutes} /> : null}

      <p className="small muted pre" style={{ margin: 0 }}>
        {"질문은 공개 직무 자료·가이드·실무 자료를 바탕으로 구성한 시나리오이며,\n실제 동료나 현직자의 발언이 아닙니다."}
      </p>
    </div>
  );
}
