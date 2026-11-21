/**
 * 동료별 대화 기억(요약 MD 파일).
 *
 * 한 동료당 MD 파일 하나. 대화를 마칠 때 요약을 합쳐 갱신하고, 다음 대화를 시작할 때 이 파일을 읽어 이어 간다.
 * 사용자가 MD를 직접 고칠 수 있으므로, 합칠 때는 저장된 MD를 다시 읽어(parse) 고친 내용을 살린 채로 덧붙인다.
 * 정해진 제목(##)이 아닌 부분은 그대로 보존한다.
 */
import { PERSONAS, type PersonaId } from "./personas";

export interface MemoryLogEntry {
  /** 대화 기록 ID. 사용자가 손으로 적은 항목은 없을 수 있다. */
  conversationId: string | null;
  date: string;
  title: string;
  points: string[];
}

export interface MemoryNotes {
  context: string[];
  decisions: string[];
  followups: string[];
  /** 최신이 앞. */
  log: MemoryLogEntry[];
  /** 정해진 제목이 아닌 부분(사용자가 추가한 절). 원문 그대로. */
  extra: string;
}

export const SECTION = {
  context: "알고 있는 맥락",
  decisions: "합의·결정",
  followups: "다음에 이어갈 것",
  log: "대화 기록",
} as const;

export const LIMITS = { context: 15, decisions: 15, followups: 10, log: 20, itemChars: 200, markdownChars: 20_000 } as const;

export const emptyNotes = (): MemoryNotes => ({ context: [], decisions: [], followups: [], log: [], extra: "" });

const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;
const LOG_HEAD = /^###\s+(.*?)\s*(?:<!--\s*c:([\w-]+)\s*-->)?\s*$/;

const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, LIMITS.itemChars);
const key = (s: string) => s.replace(/[\s.,!?·'"“”‘’()~-]/g, "").toLowerCase();

/** 같은 뜻의 항목(공백·문장부호만 다른)은 하나만 남긴다. 먼저 나온 것을 살린다. */
export function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = clean(raw);
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function itemsOf(lines: string[]): string[] {
  return lines.map((l) => l.replace(ITEM, "").trim()).filter((l) => l && !l.startsWith(">") && l !== "(없음)");
}

export function parseMemory(markdown: string): MemoryNotes {
  const notes = emptyNotes();
  const extra: string[] = [];
  let section: keyof typeof SECTION | "extra" | null = null;
  let entry: MemoryLogEntry | null = null;
  const lines: Record<"context" | "decisions" | "followups", string[]> = { context: [], decisions: [], followups: [] };

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      const title = h2[1].trim();
      const found = (Object.keys(SECTION) as (keyof typeof SECTION)[]).find((k) => SECTION[k] === title);
      section = found ?? "extra";
      entry = null;
      if (section === "extra") extra.push(line);
      continue;
    }
    if (section === null) continue; // # 제목과 갱신 안내 줄
    if (section === "extra") {
      extra.push(line);
      continue;
    }
    if (section === "log") {
      const head = LOG_HEAD.exec(line);
      if (head) {
        const [date, ...rest] = head[1].split(" · ");
        entry = { conversationId: head[2] ?? null, date: rest.length ? date.trim() : "", title: (rest.length ? rest.join(" · ") : date).trim(), points: [] };
        notes.log.push(entry);
      } else if (entry && line.trim()) {
        entry.points.push(...itemsOf([line]));
      }
      continue;
    }
    lines[section].push(line);
  }
  notes.context = dedupe(itemsOf(lines.context));
  notes.decisions = dedupe(itemsOf(lines.decisions));
  notes.followups = dedupe(itemsOf(lines.followups));
  notes.extra = extra.join("\n").trim();
  return notes;
}

const bullets = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (없음)");

export function renderMemory(personaId: PersonaId, notes: MemoryNotes, updatedAt: string): string {
  const p = PERSONAS[personaId];
  const log = notes.log.map((e) => {
    const head = `### ${e.date ? `${e.date} · ` : ""}${e.title || "제목 없음"}${e.conversationId ? ` <!-- c:${e.conversationId} -->` : ""}`;
    return [head, ...e.points.map((pt) => `- ${pt}`)].join("\n");
  });
  return [
    `# ${p.name} ${p.title}(${p.department})와의 대화 기억`,
    "",
    `> 마지막 갱신: ${updatedAt} · 대화 기록 ${notes.log.length}건`,
    "> 다음 대화를 시작할 때 이 파일을 읽고 이어서 이야기합니다. 직접 고쳐도 됩니다.",
    "",
    `## ${SECTION.context}`,
    bullets(notes.context),
    "",
    `## ${SECTION.decisions}`,
    bullets(notes.decisions),
    "",
    `## ${SECTION.followups}`,
    bullets(notes.followups),
    "",
    ...(notes.extra ? [notes.extra, ""] : []),
    `## ${SECTION.log}`,
    log.length ? log.join("\n\n") : "(아직 없음)",
    "",
  ].join("\n");
}

/** 대화 한 건의 요약. */
export interface ConversationSummary {
  title: string;
  points: string[];
  /** 새로 알게 된 맥락. */
  context: string[];
  decisions: string[];
  followups: string[];
  /** 이번 대화에서 해결된 '다음에 이어갈 것'. 기억에서 뺀다. */
  resolved: string[];
}

/**
 * 기존 기억에 요약을 합친다. 같은 대화를 다시 요약하면(기록을 고친 뒤) 그 대화의 기록 항목을 바꾼다.
 * 새 항목이 앞에 오고, 상한을 넘으면 오래된 것부터 뺀다.
 */
export function mergeSummary(notes: MemoryNotes, summary: ConversationSummary, meta: { conversationId: string; date: string }): MemoryNotes {
  const resolved = new Set(summary.resolved.map(key));
  const entry: MemoryLogEntry = { conversationId: meta.conversationId, date: meta.date, title: clean(summary.title) || "대화", points: dedupe(summary.points).slice(0, 6) };
  return {
    context: dedupe([...summary.context, ...notes.context]).slice(0, LIMITS.context),
    decisions: dedupe([...summary.decisions, ...notes.decisions]).slice(0, LIMITS.decisions),
    followups: dedupe([...summary.followups, ...notes.followups]).filter((f) => !resolved.has(key(f))).slice(0, LIMITS.followups),
    log: [entry, ...notes.log.filter((e) => e.conversationId !== meta.conversationId)].slice(0, LIMITS.log),
    extra: notes.extra,
  };
}

/** 대화 기록 삭제 때 그 대화의 기록 항목만 뺀다(맥락·결정은 사용자가 직접 정리). */
export function dropLog(notes: MemoryNotes, conversationId: string): MemoryNotes {
  return { ...notes, log: notes.log.filter((e) => e.conversationId !== conversationId) };
}

/** 대화 한 건의 요약을 MD로(대화 기록에 붙여 보여 준다). */
export function renderSummary(summary: ConversationSummary): string {
  const part = (title: string, items: string[]) => (items.length ? [`**${title}**`, ...items.map((i) => `- ${i}`), ""] : []);
  return [
    `### ${summary.title}`,
    "",
    ...part("주요 내용", summary.points),
    ...part("새로 알게 된 맥락", summary.context),
    ...part("합의·결정", summary.decisions),
    ...part("다음에 이어갈 것", summary.followups),
    ...part("해결됨", summary.resolved),
  ]
    .join("\n")
    .trim();
}

/** 프롬프트에 넣을 때 너무 길면 오래된 대화 기록부터 줄인다. */
export function memoryForPrompt(markdown: string, limit = 4000): string {
  if (markdown.length <= limit) return markdown;
  const notes = parseMemory(markdown);
  let log = notes.log;
  const draft = (l: MemoryLogEntry[]) =>
    [
      `## ${SECTION.context}`, bullets(notes.context),
      `## ${SECTION.decisions}`, bullets(notes.decisions),
      `## ${SECTION.followups}`, bullets(notes.followups),
      notes.extra,
      `## ${SECTION.log}(최근 ${l.length}건)`,
      ...l.map((e) => [`### ${e.date} · ${e.title}`, ...e.points.map((p) => `- ${p}`)].join("\n")),
    ].join("\n");
  while (log.length > 0 && draft(log).length > limit) log = log.slice(0, -1);
  return draft(log).slice(0, limit);
}
