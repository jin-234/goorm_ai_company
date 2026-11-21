"use client";
/**
 * 기획팀 공유. 오늘 한 일과 결과를 설명하면 AI 기획자가 자기 후속 업무에 필요한 것을 한 번에 하나씩 묻는다.
 * 기획자 응답은 서버(AI 동료)가 남기고, 화면은 사용자 설명만 보낸다.
 * AI 기획자가 아직 연결되지 않았으면 정해진 안내 문구만 보여 주고, AI가 말한 것처럼 표시하지 않는다.
 */
import { useState } from "react";
import { Cast } from "@/lib/office/models";
import { hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";
import { VoiceInput } from "../voice/VoiceInput";

type Turn = OfficeView["day"]["share"]["turns"][number];

/** AI 미연결일 때 스스로 점검해 볼 질문(정해진 문구). */
const GUIDE = [
  "이 결과로 무엇을 할 수 있나요?",
  "아직 되지 않거나 확인하지 못한 것은 무엇인가요?",
  "다음에 이어서 할 일은 무엇인가요?",
];

export function Share({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const share = view.day.share;
  const [text, setText] = useState("");
  const hasPlanner = share.turns.some((t) => t.role === "planner");
  const hasUser = share.turns.some((t) => t.role === "user");

  const send = async () => {
    if ((await office.act("recordShareTurn", { role: "user", text })) != null) setText("");
  };
  const end = async (reason: "done" | "userStopped") => {
    if ((await office.act("endSharing", { reason })) != null) office.notify("공유를 마쳤습니다.\n하루 마감을 작성해 주세요.");
  };

  return (
    <div className="panel">
      <PanelHeader
        place="기획팀"
        title={`${Cast.plannerTeam} 공유`}
        detail={`${Cast.plannerName}(AI)에게 오늘 한 일과 결과를 설명합니다.\n질문은 ${share.maxQuestions}개까지이고, 언제든 마칠 수 있습니다.`}
      />

      <Card title="대화" aside={<span className="chip">{`질문 ${share.questionCount} / ${share.maxQuestions}`}</span>}>
        {share.turns.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            아직 설명하지 않았습니다. 오늘 무엇을 했고 결과가 어떤지 적어 주세요.
          </p>
        ) : (
          share.turns.map((t) => <TurnView key={t.id} turn={t} />)
        )}
      </Card>

      {!hasPlanner && hasUser ? (
        <Notice kind="info" title="AI 기획자 연결을 준비 중입니다">
          {"지금은 설명만 기록합니다. 아래 질문으로 스스로 점검해 보고, 더 적거나 공유를 마쳐 주세요.\n" +
            GUIDE.map((g) => `· ${g}`).join("\n")}
        </Notice>
      ) : null}

      {share.openQuestions.length > 0 ? (
        <Card title="아직 남은 질문">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {share.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={hasUser ? "더 설명하기" : "오늘 한 일 설명하기"}>
        <VoiceInput onText={(t) => setText((v) => (v.trim() ? `${v.trimEnd()}\n${t}` : t))} disabled={office.busy} />
        <textarea
          className="field"
          aria-label="기획팀에 설명"
          rows={4}
          value={text}
          placeholder="예: 도시를 입력하면 날씨를 보여 주는 화면을 만들었습니다. 실패 안내는 아직 만들지 않았습니다."
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" onClick={send} disabled={office.busy || !text.trim()}>
          설명 보내기
        </button>
      </Card>

      <div className="row">
        <button className="btn secondary" onClick={() => end("done")} disabled={office.busy}>
          {share.state === "ready_to_summarize" ? "공유 마치기" : "이만 마치고 하루 마감으로"}
        </button>
        {!hasUser ? (
          <button className="btn plain" onClick={() => end("userStopped")} disabled={office.busy}>
            설명 없이 종료
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <div style={{ justifySelf: "end", maxWidth: "85%" }}>
        <div className="small muted" style={{ textAlign: "right" }}>
          나 · {hm(turn.at)}
        </div>
        <div className="pre" style={{ background: "var(--green-soft)", borderRadius: 10, padding: "8px 12px" }}>
          {turn.text}
        </div>
      </div>
    );
  }
  const r = turn.reply;
  return (
    <div style={{ maxWidth: "85%" }}>
      <div className="small muted">
        {Cast.plannerName} {turn.source === "solar" ? "(AI)" : "(정해진 안내)"} · {hm(turn.at)}
      </div>
      <div className="pre" style={{ background: "var(--paper-deep)", borderRadius: 10, padding: "8px 12px" }}>
        {[r?.acknowledgement, r?.question].filter(Boolean).join("\n")}
      </div>
      {r?.question_reason ? <div className="small muted">묻는 이유: {r.question_reason}</div> : null}
    </div>
  );
}
