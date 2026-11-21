/**
 * 회의록 정리(docs/ai-colleague/AI동료_프롬프트.md 12장).
 * 회의록/날짜/시각_제목/ 폴더에 00~06·99 파일을 만든다. 서버(Vercel)는 파일을 쓸 수 없어 상태에 { name, markdown }으로 두고
 * 화면이 목록·본문 보기와 .md 내려받기를 한다. AI 요약에 실패하면 대화 기록만으로 만들고 요약 칸은 "AI 정리 없음".
 */
import type { ColleagueDept, Minutes, MinutesFile, ShareTurn } from "@/lib/office/models";
import type { Office } from "@/lib/office/office";
import { dayString, hm } from "@/lib/office/time";
import { DECISION_LABEL, DEPT_INFO, personaById } from "./catalog";
import { historyOf } from "./prompt";
import { PROMPT_BLOCKS } from "./prompt-data.generated";

export interface MinutesSummary {
  title: string;
  one_line: string;
  review: { lead_understanding: string; notes: string[] };
  depts: { dept: string; items: { question: string; answer: string; feedback: string }[] }[];
  open_items: { dept: string; item: string }[];
  next_actions: string[];
}

const NO_AI = "AI 정리 없음";
const FILE_DEPT_ORDER: ColleagueDept[] = ["designer", "marketer", "planner"];

/** MINUTES 프롬프트 + ① 팀장 보고 기록 + ② 회의 기록. */
export function minutesPrompt(office: Office): string {
  const share = office.day.share;
  const lines = (stage: "review" | "meeting") =>
    historyOf(share.turns, stage, share.meeting?.host ?? null)
      .map((h) => `${h.speaker}: ${h.text}`)
      .join("\n");
  return `${PROMPT_BLOCKS.MINUTES}\n\n[① 개발팀장 사전 보고]\n${lines("review")}\n\n[② 부서 회의]\n${lines("meeting")}`;
}

/** 모델이 준 요약을 모양에 맞춘다. 모양이 틀리면 null. */
export function readSummary(raw: Record<string, unknown> | null): MinutesSummary | null {
  if (!raw || typeof raw.title !== "string") return null;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const review = (raw.review ?? {}) as Record<string, unknown>;
  return {
    title: s(raw.title).slice(0, 30),
    one_line: s(raw.one_line),
    review: { lead_understanding: s(review.lead_understanding), notes: arr(review.notes).map(s).filter(Boolean) },
    depts: arr(raw.depts).map((d) => ({
      dept: s((d as Record<string, unknown>).dept),
      items: arr((d as Record<string, unknown>).items).map((i) => ({
        question: s((i as Record<string, unknown>).question),
        answer: s((i as Record<string, unknown>).answer) || "답변 없음",
        feedback: s((i as Record<string, unknown>).feedback),
      })),
    })),
    open_items: arr(raw.open_items).map((o) => ({ dept: s((o as Record<string, unknown>).dept), item: s((o as Record<string, unknown>).item) })).filter((o) => o.item),
    next_actions: arr(raw.next_actions).map(s).filter(Boolean),
  };
}

const safeName = (t: string) => t.replace(/[\\/:*?"<>|\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 14) || "오늘 작업";

function turnLine(t: ShareTurn, host: ColleagueDept | null): string {
  const time = hm(t.at);
  if (t.role === "user") return `- ${time} **나**: ${t.text}`;
  if (t.role === "system") return `- ${time} **${DEPT_INFO[t.stage === "review" ? "dev_lead" : (host ?? "planner")].name}** (안내): ${t.text}`;
  const r = t.reply!;
  const parts = [r.acknowledgement, r.feedback && [r.feedback.strength, r.feedback.perspective, r.feedback.try_next].filter(Boolean).join(" "), r.question].filter(Boolean).join(" ");
  const tag = t.source === "sample" ? " (예시 응답)" : t.source === "manual" ? " (정해진 안내)" : "";
  return `- ${time} **${DEPT_INFO[t.dept!].name}**${tag}: ${parts}`;
}

/** 이 부서가 물은 질문과 그 뒤 내 답·피드백(기록에서 바로 뽑음). */
function pairsFromRecord(turns: ShareTurn[], dept: ColleagueDept) {
  const out: { question: string; answer: string; feedback: string }[] = [];
  turns.forEach((t, i) => {
    if (t.role !== "colleague" || t.dept !== dept || !t.reply?.question) return;
    const answer = turns.slice(i + 1).find((x) => x.role === "user");
    const fb = turns.slice(i + 1).find((x) => x.role === "colleague" && x.dept === dept && x.meetingRole === "feedback");
    out.push({
      question: t.reply.question,
      answer: answer?.text ?? "답변 없음",
      feedback: fb?.reply?.feedback ? [fb.reply.feedback.strength, fb.reply.feedback.perspective].filter(Boolean).join(" ") : "",
    });
  });
  return out;
}

export function understandingStats(turns: ShareTurn[]) {
  const stats = { clear: 0, partial: 0, unclear: 0 };
  for (const t of turns) {
    const s = t.reply?.understanding_check?.status;
    if (s) stats[s] += 1;
  }
  return stats;
}

/** 회의록 파일 만들기. summary가 null이면 기록만으로(요약 칸은 "AI 정리 없음"). */
export function buildMinutes(office: Office, summary: MinutesSummary | null): Minutes {
  const share = office.day.share;
  const host = share.meeting?.host ?? null;
  const reviewTurns = share.turns.filter((t) => t.stage === "review");
  const meetingTurns = share.turns.filter((t) => t.stage === "meeting");
  const closedAt = [...share.turns].reverse().find((t) => t.meetingRole === "close")?.at ?? office.now;
  const date = dayString(office.day.date);
  const fallbackTitle = office.day.tasks[0]?.title || office.day.goal || "오늘 작업";
  const title = safeName(summary?.title || fallbackTitle);
  const folder = `회의록/${date}/${hm(closedAt).replace(":", "")}_${title}`;
  const confirm = share.review?.confirm ?? null;
  const stats = understandingStats(share.turns);
  const lead = personaById(share.review?.personaId ?? "");
  const participants = (share.meeting?.participants ?? []).map((p) => `${DEPT_INFO[p.dept].team}(${personaById(p.personaId)?.label ?? p.personaId})`);
  const close = share.meeting?.close ?? null;
  const ai = (v: string | undefined) => (summary ? v || "-" : NO_AI);
  const notice = "> AI가 대화 기록을 바탕으로 정리한 회의록이며, 원문은 99_전체 대화 기록에서 확인할 수 있습니다. 회사와 동료는 모두 가상 역할입니다.";

  const files: MinutesFile[] = [];
  files.push({
    name: "00_회의 요약.md",
    markdown: [
      `# ${title} — 회의 요약`,
      "",
      notice,
      "",
      `- 일시: ${date} ${hm(closedAt)}`,
      `- 참석: 나(개발팀), ${participants.join(", ") || "-"} · 진행 ${host ? DEPT_INFO[host].team : "-"}`,
      `- 사전 보고: 개발팀장(${lead?.label ?? "-"}) · ${confirm ? DECISION_LABEL[confirm.decision] ?? confirm.decision : "컨펌 전에 회의로 감"}`,
      `- 설명 확인: 자기 말로 설명함 ${stats.clear} · 일부만 설명함 ${stats.partial} · 아직 설명되지 않음 ${stats.unclear}`,
      `- 한 줄 요약: ${ai(summary?.one_line)}`,
      "",
      "## 다음 행동",
      ...(summary ? (summary.next_actions.length ? summary.next_actions.map((a) => `- ${a}`) : ["- 기록에서 나온 다음 행동 없음"]) : [`- ${close?.tryNext || NO_AI}`]),
    ].join("\n"),
  });
  files.push({
    name: "01_개발팀장 사전 보고.md",
    markdown: [
      "# 개발팀장 사전 보고",
      "",
      `- 컨펌 결정: ${confirm ? DECISION_LABEL[confirm.decision] ?? confirm.decision : "컨펌 전에 회의로 감"}`,
      `- 팀장이 이해한 내용: ${summary?.review.lead_understanding || confirm?.summary || "-"}`,
      "",
      "## 회의 전에 챙길 것",
      ...((summary?.review.notes.length ? summary.review.notes : confirm?.notes ?? []).map((n) => `- ${n}`) || []),
      "",
      "## 대화",
      ...reviewTurns.map((t) => turnLine(t, host)),
    ].join("\n"),
  });
  FILE_DEPT_ORDER.forEach((dept, i) => {
    if (!share.meeting?.participants.some((p) => p.dept === dept)) return;
    const team = DEPT_INFO[dept].team;
    const fromAi = summary?.depts.find((d) => d.dept.includes(team.replace(/^서비스 /, "")) || d.dept === dept)?.items;
    const items = fromAi?.length ? fromAi : pairsFromRecord(meetingTurns, dept);
    files.push({
      name: `0${i + 2}_${team}.md`,
      markdown: [
        `# ${team}`,
        "",
        "## 질문 · 내 답 · 피드백 요지",
        ...(items.length
          ? items.flatMap((x, n) => [`### ${n + 1}. ${x.question}`, `- 내 답: ${x.answer}`, `- 피드백: ${x.feedback || "-"}`, ""])
          : ["- 이번 회의에서 질문하지 않음"]),
        "## 발언 기록",
        ...meetingTurns.filter((t) => t.role === "user" || t.dept === dept).map((t) => turnLine(t, host)),
      ].join("\n"),
    });
  });
  const open = summary?.open_items.length ? summary.open_items.map((o) => `${o.dept}: ${o.item}`) : close?.openByDept ?? [];
  files.push({
    name: "05_남은 확인과 다음 행동.md",
    markdown: [
      "# 남은 확인과 다음 행동",
      "",
      "## 남은 확인",
      ...(open.length ? open.map((o) => `- ${o}`) : ["- 없음"]),
      "",
      "## 다음 행동",
      ...(summary?.next_actions.length ? summary.next_actions.map((a) => `- ${a}`) : [`- ${close?.tryNext || "-"}`]),
    ].join("\n"),
  });
  const terms = new Map<string, { dept: ColleagueDept; term: string; plain: string; example?: string }>();
  for (const t of share.turns) {
    if (t.role !== "colleague" || !t.reply) continue;
    for (const u of t.reply.terms_used) if (!terms.has(u.id)) terms.set(u.id, { dept: t.dept!, term: u.term, plain: u.plain });
    const e = t.reply.term_explain;
    if (e) terms.set(e.id || e.term, { dept: t.dept!, term: e.term, plain: e.plain, example: e.example });
  }
  files.push({
    name: "06_오늘 들은 실무 용어.md",
    markdown: [
      "# 오늘 들은 실무 용어",
      "",
      ...(["dev_lead", ...FILE_DEPT_ORDER] as ColleagueDept[]).flatMap((dept) => {
        const list = [...terms.values()].filter((x) => x.dept === dept);
        return list.length ? [`## ${DEPT_INFO[dept].team}`, ...list.map((x) => `- **${x.term}**: ${x.plain}${x.example ? ` (예: ${x.example})` : ""}`), ""] : [];
      }),
      ...(terms.size === 0 ? ["- 이번에는 용어를 쓰지 않았어요."] : []),
    ].join("\n"),
  });
  files.push({
    name: "99_전체 대화 기록.md",
    markdown: ["# 전체 대화 기록", "", "## ① 개발팀장 사전 보고", ...reviewTurns.map((t) => turnLine(t, host)), "", "## ② 부서 회의", ...meetingTurns.map((t) => turnLine(t, host))].join("\n"),
  });
  return { folder, aiSummarized: summary != null, files };
}
