/**
 * 기록 내보내기(개발기획서 3.3): 지난 활동일과 오늘 기록을 사용자가 골라 PDF·엑셀로 뽑는다.
 * - recordDaysOf: 회사 상태 → 내보낼 수 있는 하루 목록(서버에서 만든다).
 * - buildReport: 고른 날짜·항목만 남긴 리포트(화면 미리보기·PDF·엑셀이 같은 값을 쓴다).
 * 개인적인 미완료 사유는 기본으로 넣지 않는다. 링크 결과물은 서비스가 본문을 읽지 않았다고 표시한다.
 */
import { DEPT_INFO } from "../colleague/v2/catalog";
import {
  type ColleagueSource,
  type Review,
  type SubmissionKind,
  TASK_OUTCOME_LABEL,
  TASK_STATUS_LABEL,
  type DayRecord,
  type ReadScope,
  type ShareTurn,
  type Submission,
  type WorkTask,
} from "../office/models";
import type { Office } from "../office/office";
import { dayString, koreanShort } from "../office/time";

// MARK: 내보낼 수 있는 하루

export interface RecordTask {
  id: string;
  title: string;
  completionCriteria: string;
  statusLabel: string;
  /** 제출했거나 범위를 줄여 마친 과제. */
  done: boolean;
  outcomeLabel: string | null;
  /** 미완료 사유(개인적일 수 있어 기본 제외). */
  outcomeReason: string;
  carryCount: number;
  carriedFrom: string | null;
  submissionCount: number;
}

export interface RecordSubmission {
  taskTitle: string;
  kind: SubmissionKind;
  content: string;
  readScope: ReadScope;
}

/** 회의실에서 타 부서가 물은 질문과 내 답. */
export interface RecordQuestion {
  department: string;
  question: string;
  reason: string;
  answer: string;
  /** sample = AI 연결 전 예시 응답이 한 질문. */
  source: ColleagueSource | null;
}

export interface RecordDay {
  date: string;
  label: string;
  isToday: boolean;
  closed: boolean;
  /** 활동 인정 기준 초안: 제출물 또는 설명이 있고 마감을 확정한 날. */
  counted: boolean;
  goal: string;
  tasks: RecordTask[];
  submissions: RecordSubmission[];
  /** 회의실에서 내가 설명한 횟수. */
  explanationCount: number;
  questions: RecordQuestion[];
  review: Review | null;
}

export interface RecordsPayload {
  profile: { name: string; targetRole: string };
  /** 회사 시계 기준 오늘. */
  today: string;
  days: RecordDay[];
}

const isDone = (t: WorkTask) => t.status === "submitted" || t.status === "reviewed" || t.outcome === "adjust";

function questionsOf(turns: ShareTurn[]): RecordQuestion[] {
  const out: RecordQuestion[] = [];
  turns.forEach((t, i) => {
    // v2: 동료 발언은 role "colleague", 부서는 dept로 온다.
    const question = t.role === "colleague" ? t.reply?.question?.trim() : "";
    if (!question) return;
    const answer = turns.slice(i + 1).find((n) => n.role === "user")?.text?.trim() ?? "";
    out.push({
      department: t.dept ? DEPT_INFO[t.dept].team : "동료",
      question,
      reason: t.reply?.question_reason?.trim() ?? "",
      answer,
      source: t.source ?? null,
    });
  });
  return out;
}

function dayOf(
  r: Pick<DayRecord, "date" | "closedAt" | "goal" | "tasks" | "submissions" | "shareTurns" | "review" | "counted">,
  isToday: boolean,
): RecordDay {
  const titleOf = new Map(r.tasks.map((t) => [t.id, t.title]));
  const countOf = (id: string) => r.submissions.filter((s: Submission) => s.taskId === id).length;
  return {
    date: dayString(r.date),
    label: koreanShort(r.date),
    isToday,
    closed: r.closedAt != null,
    counted: r.counted,
    goal: r.goal,
    tasks: r.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      completionCriteria: t.completionCriteria,
      statusLabel: TASK_STATUS_LABEL[t.status],
      done: isDone(t),
      outcomeLabel: t.outcome ? TASK_OUTCOME_LABEL[t.outcome] : null,
      outcomeReason: t.outcomeReason,
      carryCount: t.carryCount,
      carriedFrom: t.carriedFrom ? dayString(t.carriedFrom) : null,
      submissionCount: countOf(t.id),
    })),
    submissions: r.submissions.map((s) => ({ taskTitle: titleOf.get(s.taskId) ?? "", kind: s.kind, content: s.content, readScope: s.readScope })),
    explanationCount: r.shareTurns.filter((t) => t.role === "user" && t.text?.trim()).length,
    questions: questionsOf(r.shareTurns),
    review: r.review,
  };
}

/** 출근한 날만 내보낼 수 있다(쉬는 날·결근 후보는 활동 기록이 없다). 날짜 오름차순. */
export function recordDaysOf(office: Office): RecordDay[] {
  const past = office.history.filter((r) => r.checkInAt != null).map((r) => dayOf(r, false));
  const d = office.day;
  if (d.checkInAt != null) {
    const counted = d.closedAt != null && (d.submissions.length > 0 || d.share.turns.some((t) => t.role === "user"));
    past.push(dayOf({ ...d, shareTurns: d.share.turns, review: d.review.confirmed, counted }, true));
  }
  return past.filter((r, i, all) => all.findIndex((o) => o.date === r.date) === i).sort((a, b) => a.date.localeCompare(b.date));
}

export function recordsPayloadOf(office: Office): RecordsPayload {
  return {
    profile: { name: office.profile.name, targetRole: office.profile.targetRole },
    today: dayString(office.today),
    days: recordDaysOf(office),
  };
}

// MARK: 고른 내용만 담은 리포트

export interface ExportOptions {
  dates: string[];
  /** 결과물(글·링크·코드). */
  submissions: boolean;
  /** 회의실 질문과 내 답. */
  questions: boolean;
  /** 재제출·범위 조정·이월 같은 수정 이력. */
  revisions: boolean;
  /** 확정한 하루 마감 요약. */
  review: boolean;
  /** 미완료 사유. 개인적인 내용일 수 있어 기본으로 넣지 않는다. */
  incompleteReasons: boolean;
}

export function defaultExportOptions(days: RecordDay[]): ExportOptions {
  const closed = days.filter((d) => d.closed).map((d) => d.date);
  return {
    dates: closed.length > 0 ? closed : days.map((d) => d.date),
    submissions: true,
    questions: true,
    revisions: true,
    review: true,
    incompleteReasons: false,
  };
}

export interface RevisionNote {
  taskTitle: string;
  text: string;
}

export interface ReportDay extends RecordDay {
  revisions: RevisionNote[];
}

export interface Report {
  name: string;
  targetRole: string;
  generatedOn: string;
  period: { from: string; to: string } | null;
  summary: {
    days: number;
    countedDays: number;
    tasks: number;
    doneTasks: number;
    submissions: number;
    explanations: number;
    questions: number;
  };
  options: ExportOptions;
  days: ReportDay[];
  /** 리포트 끝에 붙이는 근거 한계. */
  limits: string[];
}

function revisionsOf(day: RecordDay): RevisionNote[] {
  const notes: RevisionNote[] = [];
  for (const t of day.tasks) {
    if (t.submissionCount > 1) notes.push({ taskTitle: t.title, text: `결과물을 ${t.submissionCount}번 제출(고쳐서 다시 제출)` });
    if (t.carryCount > 0) {
      const from = t.carriedFrom ? `${t.carriedFrom}부터 ` : "";
      notes.push({ taskTitle: t.title, text: `${from}${t.carryCount}번 이월된 과제${t.done ? " → 이날 마침" : ""}` });
    }
    if (t.outcomeLabel && !t.done) notes.push({ taskTitle: t.title, text: `미완료 처리: ${t.outcomeLabel}` });
    else if (t.outcomeLabel && t.submissionCount === 0) notes.push({ taskTitle: t.title, text: "범위를 줄여 오늘 한 데까지로 마침" });
  }
  return notes;
}

export function buildReport(payload: RecordsPayload, options: ExportOptions): Report {
  const picked = new Set(options.dates);
  const days = payload.days
    .filter((d) => picked.has(d.date))
    .map((d) => ({
      ...d,
      tasks: d.tasks.map((t) => ({ ...t, outcomeReason: options.incompleteReasons ? t.outcomeReason : "" })),
      submissions: options.submissions ? d.submissions : [],
      questions: options.questions ? d.questions : [],
      review: options.review ? d.review : null,
      revisions: options.revisions ? revisionsOf(d) : [],
    }));
  const allTasks = days.flatMap((d) => d.tasks);
  const usedSample = days.some((d) => d.questions.some((q) => q.source === "sample"));
  const hasLink = days.some((d) => d.submissions.some((s) => s.readScope === "notRead"));
  const limits = [
    "VISION COMPANY 가상회사에서 AI 팀장·AI 타 부서 동료와 연습한 자기 기록입니다. 역량 인증서나 경력 증명이 아닙니다.",
    "과제·결과물·설명은 사용자가 직접 입력한 내용이고, 서비스는 결과물을 실행하거나 정답 여부를 검증하지 않았습니다.",
    "마감 요약은 AI 초안을 바탕으로 사용자가 확인·수정해 확정한 글입니다.",
  ];
  if (hasLink) limits.push("링크 결과물은 주소만 기록했고 서비스가 링크 본문을 읽지 않았습니다.");
  if (usedSample) limits.push("‘예시 응답’ 표시가 있는 질문은 AI 연결 전 예시 생성기가 만든 질문입니다.");
  limits.push("사용자가 고른 날짜와 항목만 담았습니다. 넣지 않은 기록은 이 문서에 없습니다.");
  return {
    name: payload.profile.name,
    targetRole: payload.profile.targetRole,
    generatedOn: payload.today,
    period: days.length > 0 ? { from: days[0].date, to: days[days.length - 1].date } : null,
    summary: {
      days: days.length,
      countedDays: days.filter((d) => d.counted).length,
      tasks: allTasks.length,
      doneTasks: allTasks.filter((t) => t.done).length,
      submissions: days.reduce((n, d) => n + d.submissions.length, 0),
      explanations: days.reduce((n, d) => n + d.explanationCount, 0),
      questions: days.reduce((n, d) => n + d.questions.length, 0),
    },
    options,
    days,
    limits,
  };
}

/** 내려받는 파일 이름(확장자 제외). 파일 이름에 못 쓰는 글자는 뺀다. */
export function exportFileName(report: Report): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  const period = report.period ? (report.period.from === report.period.to ? report.period.from : `${report.period.from}~${report.period.to}`) : report.generatedOn;
  return ["VISION_COMPANY_활동기록", safe(report.name), period].filter(Boolean).join("_");
}

export const REVIEW_LABELS: [keyof Review, string][] = [
  ["reported_work", "오늘 한 일"],
  ["explained_learning", "설명한 개념·배운 내용"],
  ["artifact_observations", "결과물에서 확인한 것"],
  ["shared_scope_and_limits", "발표 때 전한 가능 범위와 제약"],
  ["open_questions", "아직 남은 질문"],
  ["job_connection", "희망 직무와의 연결"],
  ["next_action", "다음 행동 하나"],
];

export const reviewValue = (review: Review, key: keyof Review): string => {
  const v = review[key];
  return Array.isArray(v) ? v.filter((s) => s.trim()).join("\n") : v.trim();
};

export const SUBMISSION_KIND_LABEL: Record<SubmissionKind, string> = { text: "글", link: "링크", code: "코드" };
