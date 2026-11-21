/**
 * 공유(개발팀장 사전 보고 → 부서 회의 → 회의록) 화면이 읽는 상태 모양.
 * 4a와 확정한 view.day.share 모양이다(AI 동료 프롬프트 문서 1·5·10·12·13장).
 * 서버 타입이 같은 모양으로 바뀌면 이 파일은 서버 타입을 다시 내보내기만 하면 된다.
 */
import type { OfficeView } from "../api";

export type DeptId = "dev_lead" | "designer" | "marketer" | "planner";
export type ShareStage = "review" | "confirm" | "meeting" | "closed";
export type MeetingRole = "review" | "confirm" | "ask" | "feedback" | "close";

export interface ColleagueReply {
  department?: DeptId;
  persona_id?: string;
  acknowledgement: string;
  feedback: { strength: string; perspective: string; try_next: string } | null;
  question: string;
  question_reason: string;
  anchor_quote?: string;
  basis?: { type: string; source_ids: string[]; note: string };
  understanding_check: { layer: "what" | "how" | "why"; status: "clear" | "partial" | "unclear"; gap: string } | null;
  term_explain: { id: string; term: string; plain: string; example: string; why_we_use: string } | null;
  terms_used: { id: string; term: string; plain: string }[];
  known_facts: string[];
  open_questions: string[];
  can_finish: boolean;
  confirm?: { decision: "approved" | "approved_with_notes" | "revise"; summary: string; notes: string[] };
  /** 서버가 완성해 주는 근거 한 줄(예: "근거: 현직자 공개 실무 자료 · Google 코드 리뷰 가이드"). */
  basisLabel?: string;
  /** term_explain이 비었는데 사용자가 용어를 물었을 때 용어집 뜻풀이. */
  termFallback?: { term: string; plain: string } | null;
}

export interface MeetingTurn {
  id: string;
  at: number;
  role: "user" | "colleague" | "system";
  stage: "review" | "meeting";
  dept?: DeptId;
  meetingRole?: MeetingRole;
  text?: string;
  reply?: ColleagueReply;
  source?: string;
}

export interface Participant {
  dept: DeptId;
  name: string;
  team: string;
  personaId: string;
  personaLabel: string;
}

export interface ShareView {
  stage: ShareStage | null;
  review: {
    lead: { personaId: string; personaLabel: string };
    questionCount: number;
    maxQuestions: number;
    turns: MeetingTurn[];
    confirm: { decision: "approved" | "approved_with_notes" | "revise"; decisionLabel: string; summary: string; notes: string[] } | null;
  } | null;
  meeting: {
    host: DeptId;
    participants: Participant[];
    round: number;
    turns: MeetingTurn[];
    close: { recap: string; openByDept: string[]; tryNext: string } | null;
    stats: { clear: number; partial: number; unclear: number };
  } | null;
  turns: MeetingTurn[];
  minutes: { folder: string; aiSummarized: boolean; files: { name: string; markdown: string }[] } | null;
  canAnotherRound: boolean;
  explainedTerms: string[];
  endedBy: "done" | "userStopped" | "skipped" | null;
}

/** 서버 타입이 바뀌기 전후 모두에서 같은 모양으로 읽는다. */
export const shareOf = (view: OfficeView): ShareView => view.day.share as unknown as ShareView;

export const DEPT_NAME: Record<DeptId, { name: string; team: string }> = {
  dev_lead: { name: "AI 팀장", team: "개발팀" },
  designer: { name: "AI 디자이너", team: "디자인팀" },
  marketer: { name: "AI 마케터", team: "마케팅팀" },
  planner: { name: "AI 기획자", team: "서비스 기획팀" },
};

export const LAYER_NAME = { what: "무엇", how: "어떻게", why: "왜" } as const;
export const STATUS_NAME = { clear: "자기 말로 설명함", partial: "일부만 설명함", unclear: "아직 설명되지 않음" } as const;
