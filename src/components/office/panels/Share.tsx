"use client";
/**
 * 회의실 · 타 부서 공유(발표). 타 부서 AI 동료들이 회의실에 와 있고, 내가 오늘 한 일을 발표한다(개정 기획서 3.1, 4.2, 4.3 B·E).
 * 발표는 과제(파트)마다 그 일을 이어받을 부서 한 곳과 짧게 대화하고, 그 부서가 마무리하면 다음 파트의 부서로 넘어간다.
 * 사용자는 건너뛰거나 언제든 마칠 수 있다. AI 미연결이면 정해진 안내를 'AI가 말한 것'처럼 보이지 않게 따로 표시한다.
 */
import { useEffect, useRef, useState } from "react";
import { MEETING_ROLE_NAME, type MeetingRoleId, type SharePart, sharePartsOf, sharePartState } from "@/lib/office/models";
import { api, isManual, isSample, type OfficeView, type PlannerReply, type ShareTurn } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, ManualMark, Notice, PanelHeader, type PlaceId, SampleMark } from "../ui";
import { SubmissionLine } from "./TaskList";
import { VoiceInput } from "../voice/VoiceInput";

const SKIP_TEXT = "이 질문은 건너뛸게요.";

/** 질문 근거(서버 question_basis·basis_ref). 가이드로 만든 질문을 실제 기획자 발언처럼 보이지 않게 구분한다. */
function basisText(reply: PlannerReply, speaker: MeetingRoleId): string | null {
  const r = reply as PlannerReply & { question_basis?: string; basis_ref?: string };
  const ref = r.basis_ref?.trim();
  switch (r.question_basis) {
    case "role_need":
      return `질문 근거: 역할상 필요 · ${MEETING_ROLE_NAME[speaker].department} 업무에 필요한 정보`;
    case "ux_guide":
      return `질문 근거: 공개 가이드 기반 시나리오${ref ? ` · ${ref}` : ""}`;
    case "collected_case":
      return `질문 근거: 현직자 인터뷰 사례${ref ? ` · ${ref}` : ""}`;
    default:
      return null;
  }
}

/** 설명할 때 놓치기 쉬운 상황. 누르면 입력창에 말머리를 넣는다. */
const MISSED_CASES: [string, string][] = [
  ["빈 화면", "처음 열어 아무것도 없을 때는 "],
  ["오류가 났을 때", "오류가 나면 "],
  ["기다리는 동안(로딩)", "결과를 기다리는 동안에는 "],
  ["잘못 입력했을 때", "잘못 입력하면 "],
];

function PlannerBubble({ reply, speaker, manual, sample }: { reply: PlannerReply; speaker: MeetingRoleId; manual: boolean; sample: boolean }) {
  const name = MEETING_ROLE_NAME[speaker];
  if (manual) {
    return (
      <div className="card" style={{ background: "var(--paper-deep)", gap: 6, padding: 12 }}>
        <ManualMark text={`AI 미연결 · ${name.department} 정해진 안내 문구`} />
        <div className="pre">{[reply.acknowledgement, reply.question].filter(Boolean).join("\n")}</div>
      </div>
    );
  }
  return (
    <div className="card" style={{ gap: 6, padding: 12, borderLeft: "4px solid var(--green)" }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="small" style={{ fontWeight: 700, color: "var(--green)" }}>
          {name.title} · {name.department}
        </span>
        {sample ? <SampleMark /> : null}
      </div>
      {reply.acknowledgement ? <div className="pre">{reply.acknowledgement}</div> : null}
      {reply.question ? (
        <div>
          <div className="pre" style={{ fontWeight: 600 }}>
            {reply.question}
          </div>
          {reply.question_reason ? <div className="small muted pre">필요한 이유: {reply.question_reason}</div> : null}
          {basisText(reply, speaker) ? <div className="small muted">{basisText(reply, speaker)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--green-soft)", borderRadius: 12, padding: "10px 14px" }}>
      <div className="small muted">나</div>
      <div className="pre">{text}</div>
    </div>
  );
}

/** 부서마다 하는 일(회의에 온 부서 안내). */
const ROLE_JOB: Record<MeetingRoleId, string> = {
  planner: "사용자 안내 초안·출시 범위를 준비합니다. 회의 진행도 맡습니다.",
  designer: "화면 상태와 사용자 흐름 시안을 정리합니다.",
  operations: "이용 안내와 문제가 생겼을 때의 대응을 준비합니다.",
};

/** 파트 순서: 끝난 파트는 ✓, 지금 파트는 굵게. */
function PartOrder({ parts, index, done, active }: { parts: SharePart[]; index: number; done: boolean; active: boolean }) {
  return (
    <ol className="small muted" aria-label="발표 파트" style={{ margin: 0, paddingLeft: 20 }}>
      {parts.map((p, i) => {
        const finished = done || i < index;
        const now = active && !done && i === index;
        return (
          <li key={`${p.taskId ?? "day"}-${i}`} style={now ? { fontWeight: 700, color: "var(--ink, inherit)" } : undefined}>
            {`${p.title} → ${MEETING_ROLE_NAME[p.role].department}`}
            {finished ? " ✓" : now ? " · 지금" : ""}
          </li>
        );
      })}
    </ol>
  );
}

/** 대화 기록. 파트가 바뀌는 곳에 어느 파트를 어느 부서가 듣는지 줄을 넣는다. */
function Transcript({ turns, parts, turnPart }: { turns: ShareTurn[]; parts: SharePart[]; turnPart: number[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-live="polite">
      {turns.map((t, i) => {
        const part = turnPart[i];
        const divider =
          i === 0 || part !== turnPart[i - 1] ? (
            <PartDivider key={`part-${part}`} index={part} part={parts[part]} total={parts.length} />
          ) : null;
        const body =
          t.role === "user" ? (
            <UserBubble key={t.id} text={t.text ?? ""} />
          ) : t.reply ? (
            <PlannerBubble key={t.id} reply={t.reply} speaker={t.speaker ?? "planner"} manual={isManual(t.source)} sample={isSample(t.source)} />
          ) : null;
        return divider ? [divider, body] : body;
      })}
    </div>
  );
}

function PartDivider({ index, part, total }: { index: number; part: SharePart | undefined; total: number }) {
  if (!part) return null;
  return (
    <div className="small muted" style={{ borderTop: "1px solid var(--line, #ddd)", paddingTop: 6 }}>
      {`파트 ${index + 1}/${total} · ${part.title} · ${MEETING_ROLE_NAME[part.role].department}`}
    </div>
  );
}

export function Share({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const phase = view.phase.value;
  const share = view.day.share;
  const turns = share.turns;
  const last = [...turns].reverse().find((t) => t.role === "planner");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // 중괄호로 감싸 아무것도 돌려주지 않는다. 최근 브라우저의 scrollIntoView는 Promise를 돌려주는데,
  // 그대로 돌려주면 React가 정리 함수로 부르다 'destroy is not a function'으로 멈춘다.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  const header = (
    <PanelHeader
      place="회의실 · 타 부서 공유"
      title="오늘 한 일 발표"
      detail={"오늘 확정한 과제마다 그 일을 이어받을 부서 한 곳과 이야기합니다.\n한 부서와 대화가 끝나면 다음 과제를 맡은 부서로 넘어갑니다."}
    />
  );

  const [manual, setManual] = useState(false);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    if (manual) {
      // AI 미연결: 내 설명만 기록한다(AI 응답을 만들지 않는다).
      const res = await office.act("recordShareTurn", { role: "user", text: body });
      setSending(false);
      if (res != null) setMessage("");
      return;
    }
    let failed = false;
    await office.run(async () => {
      const r = await api.share(body);
      if (!r.reply) failed = true;
      return { office: r.office ?? view };
    });
    setSending(false);
    if (failed) {
      // 서버는 실패한 말을 기록하지 않는다. 적은 글은 그대로 두고 직접 기록 방식으로 바꾼다.
      setManual(true);
      office.notify("AI 동료에 연결하지 못했습니다.\n적은 글은 그대로 있습니다. 직접 기록으로 남길 수 있습니다.");
      return;
    }
    setMessage("");
  };

  const finish = async (reason: "done" | "userStopped") => {
    if ((await office.act("endSharing", { reason })) != null) {
      office.notify("공유를 마쳤습니다.\n내 책상에서 하루 마감을 해 주세요.");
      onGo("desk");
    }
  };

  if (phase === "beforeCheckIn" || phase === "morningPT" || (phase === "working" && turns.length === 0)) {
    return (
      <div className="panel">
        {header}
        <Notice kind="info" title="결과물을 남긴 뒤 발표합니다">
          {"내 책상에서 과제를 제출하거나 못 끝낸 것으로 정한 다음\n'회의실에서 발표하기'를 눌러 주세요."}
          <div style={{ marginTop: 8 }}>
            <button className="btn secondary small" onClick={() => onGo("desk")}>
              내 책상으로
            </button>
          </div>
        </Notice>
      </div>
    );
  }

  const active = phase === "sharing";
  const subs = view.day.submissions;
  const parts = share.parts ?? sharePartsOf(view.day.tasks);
  const { index: partIndex, done: allDone, turnPart } = sharePartState(parts, turns);
  const current = parts[partIndex];
  const currentDept = MEETING_ROLE_NAME[current.role].department;
  // 지금 파트에서 아직 내가 말하지 않았으면, 이 파트를 설명할 차례다.
  const partStarted = turns.some((t, i) => t.role === "user" && turnPart[i] === partIndex);
  const roles = parts.map((p) => p.role).filter((r, i, a) => a.indexOf(r) === i);
  return (
    <div className="panel">
      {header}

      <Card title="발표 순서와 듣는 부서 (가상 역할)">
        <PartOrder parts={parts} index={partIndex} done={allDone} active={active} />
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {roles.map((r) => (
            <li key={r}>{`${MEETING_ROLE_NAME[r].title}: ${ROLE_JOB[r]}`}</li>
          ))}
        </ul>
        <p className="small muted" style={{ margin: 0 }}>
          과제마다 맡은 부서가 자기 업무에 필요한 것만 한두 가지 묻습니다. 기술 퀴즈나 채점은 하지 않습니다.
        </p>
      </Card>

      <Card title="AI 동료들이 받는 내용">
        <p className="small muted pre" style={{ margin: 0 }}>
          {"아래 설명과 오늘 남긴 결과물이 AI 동료들에게 전송됩니다.\n링크는 내용을 읽지 않으므로 설명을 기준으로 이야기합니다."}
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

      <Card
        title="대화"
        aside={<span className="chip">{`질문 ${share.questionCount} / 최대 ${share.maxQuestions}`}</span>}
      >
        {turns.length > 0 ? <Transcript turns={turns} parts={parts} turnPart={turnPart} /> : null}
        {active && !allDone && !partStarted ? (
          <Notice kind="info" title={`파트 ${partIndex + 1} · '${current.title}'을(를) ${currentDept}에 설명해 주세요`}>
            {turns.length === 0 ? "한두 문장이면 됩니다. 예: 도시를 입력하면 날씨를 보여 주는 화면을 만들었습니다." : "앞 파트는 마쳤습니다. 이 과제에서 한 일과 결과를 이야기해 주세요."}
          </Notice>
        ) : null}
        <div ref={endRef} />

        {active ? (
          <>
            {manual ? (
              <Notice kind="info" title="직접 기록 · AI 미연결">
                {"AI 동료에게 연결하지 못해, 내 설명만 기록합니다.\n과제를 맡은 부서가 알고 싶어 할 것을 생각하며 적어 보세요.\n· 기획: 누가 무엇을 할 수 있게 됐나요?\n· 디자인: 화면은 어떤 순서로, 불러오는 중·실패 때는 어떻게 보이나요?\n· 운영: 쓰다가 막히면 무엇을 보고, 알려진 문제는 무엇인가요?"}
                <div style={{ marginTop: 8 }}>
                  <button className="btn secondary small" onClick={() => setManual(false)} disabled={sending}>
                    AI 동료에 다시 연결해 보기
                  </button>
                </div>
              </Notice>
            ) : null}
            {share.state === "ready_to_summarize" ? (
              <Notice kind="ok" title="모든 파트를 공유했습니다">
                더 덧붙일 말이 없으면 공유를 마쳐도 됩니다.
              </Notice>
            ) : null}
            {/* 말로 하면 적어 둔 글 뒤에 덧붙인다. 보내기 전에 고칠 수 있다. */}
            <VoiceInput
              onText={(t) => setMessage((m) => (m.trim() ? `${m.trimEnd()}\n${t}` : t))}
              disabled={office.busy || sending}
            />
            <details>
              <summary className="small">설명할 때 놓치기 쉬운 상황</summary>
              <div className="row" style={{ marginTop: 6 }}>
                {MISSED_CASES.map(([label, lead]) => (
                  <button
                    key={label}
                    className="btn plain small"
                    onClick={() => setMessage((m) => (m.trim() ? `${m.trimEnd()}\n${lead}` : lead))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </details>
            <textarea
              className="field"
              aria-label="AI 동료들에게 보낼 말"
              rows={3}
              value={message}
              placeholder={!partStarted && !allDone ? `'${current.title}'에서 한 일과 결과를 설명해 주세요.` : "질문에 답하거나 덧붙일 말을 적어 주세요."}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) void send(message);
              }}
            />
            <div className="row">
              <button className="btn" onClick={() => send(message)} disabled={office.busy || sending || !message.trim()}>
                {sending ? (manual ? "기록하는 중" : "AI 동료가 읽는 중") : manual ? "기록하기" : "보내기"}
              </button>
              {!manual && last?.reply?.question ? (
                <button className="btn secondary" onClick={() => send(SKIP_TEXT)} disabled={office.busy || sending}>
                  이 질문 건너뛰기
                </button>
              ) : null}
              <button
                className="btn plain"
                onClick={() => finish(share.state === "ready_to_summarize" ? "done" : "userStopped")}
                disabled={office.busy || sending || !view.can.endSharing}
              >
                공유 마치기
              </button>
            </div>
          </>
        ) : (
          <Notice kind="ok" title="공유를 마쳤습니다">
            <button className="btn secondary small" onClick={() => onGo("desk")}>
              하루 마감으로
            </button>
          </Notice>
        )}
      </Card>

      {share.knownFacts.length > 0 || share.openQuestions.length > 0 ? (
        <Card title="AI 동료들이 정리한 것">
          {share.knownFacts.length > 0 ? (
            <div>
              <div style={{ fontWeight: 700 }}>전달받은 내용</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {share.knownFacts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {share.openQuestions.length > 0 ? (
            <div>
              <div style={{ fontWeight: 700 }}>아직 모르는 것</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {share.openQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="small muted">사용자가 설명한 내용을 정리한 것으로, 실제로 실행해 확인한 것은 아닙니다.</div>
        </Card>
      ) : null}

      <p className="small muted pre" style={{ margin: 0 }}>
        {"질문은 공개 가이드(GOV.UK 서비스팀 역할 안내, NN/g 디자인 크리틱, W3C 오류·성공 알림)를\n바탕으로 구성한 시나리오이며, 실제 담당자의 발언이 아닙니다."}
      </p>
    </div>
  );
}
