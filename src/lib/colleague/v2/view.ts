/**
 * 회의실 발표 화면 값(78과 맞춘 계약). 저장 상태에 화면이 바로 쓸 이름·근거 한 줄·용어 풀이·결정 문구를 붙인다.
 */
import type { ShareSession, ShareTurn } from "@/lib/office/models";
import { DECISION_LABEL, DEPT_INFO, basisLabel, personaById } from "./catalog";
import { understandingStats } from "./minutes";
import { askedTerm } from "./validate";

export function turnView(t: ShareTurn, turns: ShareTurn[]) {
  if (t.role !== "colleague" || !t.reply) return t;
  const r = t.reply;
  // AI가 term_explain을 비웠는데 바로 앞 사용자 말이 용어 뜻을 물었으면 용어집 뜻풀이로 대신 보여 준다(10장).
  const prevUser = [...turns.slice(0, turns.indexOf(t))].reverse().find((x) => x.role === "user");
  const asked = !r.term_explain && t.dept && prevUser?.text ? askedTerm(t.dept, prevUser.text) : null;
  const fallback = asked;
  return {
    ...t,
    reply: {
      ...r,
      basisLabel: r.question ? basisLabel(r.basis) : "",
      termFallback: fallback ? { term: fallback.term, plain: fallback.plain } : null,
      ...(r.confirm ? { confirm: { ...r.confirm, decisionLabel: DECISION_LABEL[r.confirm.decision] ?? r.confirm.decision } } : {}),
    },
  };
}

export function shareView(share: ShareSession, canAnotherRound: boolean) {
  const turns = share.turns.map((t) => turnView(t, share.turns));
  const lead = share.review ? personaById(share.review.personaId) : null;
  return {
    stage: share.stage,
    turns,
    review: share.review
      ? {
          lead: { personaId: share.review.personaId, personaLabel: lead?.label ?? "" },
          questionCount: share.review.questionCount,
          maxQuestions: 2,
          turns: turns.filter((t) => t.stage === "review"),
          confirm: share.review.confirm ? { ...share.review.confirm, decisionLabel: DECISION_LABEL[share.review.confirm.decision] ?? share.review.confirm.decision } : null,
        }
      : null,
    meeting: share.meeting
      ? {
          host: share.meeting.host,
          participants: share.meeting.participants.map((p) => ({
            dept: p.dept,
            name: DEPT_INFO[p.dept].name,
            team: DEPT_INFO[p.dept].team,
            personaId: p.personaId,
            personaLabel: personaById(p.personaId)?.label ?? "",
          })),
          round: share.meeting.round,
          /**
           * 이번 바퀴 차례(화면의 차례 표시용). order는 질문 순서, asked는 이미 물은 부서,
           * awaitingAnswer는 질문하고 내 답을 기다리는 부서, next는 그다음 물을 부서(없으면 null), closingNext는 다음이 진행자 정리인지.
           */
          turnOrder: {
            order: share.meeting.participants.map((p) => p.dept),
            asked: share.meeting.participants.slice(0, share.meeting.nextAsk).map((p) => p.dept),
            awaitingAnswer: share.meeting.awaitingFeedback,
            next: share.meeting.participants[share.meeting.nextAsk]?.dept ?? null,
            closingNext: share.stage === "meeting" && share.meeting.nextAsk >= share.meeting.participants.length,
          },
          turns: turns.filter((t) => t.stage === "meeting"),
          close: share.meeting.close,
          stats: understandingStats(share.turns.filter((t) => t.stage === "meeting")),
        }
      : null,
    minutes: share.minutes,
    canAnotherRound,
    explainedTerms: share.explainedTerms,
    endedBy: share.endedBy,
  };
}
