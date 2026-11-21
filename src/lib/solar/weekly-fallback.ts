import { Cast, type WeeklyReport } from "../office/models";

export interface WeeklyReply {
  subject: string;
  body: string;
  /** 답장에서 짚은 성취 한 가지. */
  achievement: string;
}

/**
 * Solar에 연결하지 못했을 때 쓰는 주간보고 기본 답장.
 * AI가 쓴 글이 아니라 정해진 문구에 보고서의 한 줄을 넣은 것이므로 화면에서 그렇게 표시한다.
 */
export function localWeeklyReply(report: Pick<WeeklyReport, "completed" | "nextGoals">, name: string): WeeklyReply {
  const achievement = firstLine(report.completed) ?? "이번 주에 끝낸 업무";
  const goal = firstLine(report.nextGoals);
  const lines = [
    "주간보고서 잘 읽었습니다.",
    "",
    `“${achievement}”,`,
    "이 일을 이번 주에 끝까지 해낸 점을 먼저 짚고 싶습니다.",
    "정해 둔 일을 결과물로 남기는 것이 가장 어려운데,",
    "그 일을 해냈습니다.",
    "",
    "미완료로 적은 업무는 이유를 함께 적어 주어",
    "상황을 이해했습니다.",
  ];
  if (goal) lines.push(`다음 주에는 “${goal}”부터`, "작은 단위로 나눠 시작해 보면 좋겠습니다.");
  lines.push("", "한 주 동안 수고 많았습니다.", "", `${Cast.managerName} 드림`);
  return { subject: `[주간 피드백] ${name} 사원 주간보고 확인`, body: lines.join("\n"), achievement };
}

/** 글머리 기호와 번호, 끝 마침표를 떼어 낸 첫 줄. */
export function firstLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/^[-·•*–—▪◦\s]+/u, "");
    line = line.replace(/^\d+[.)]\s*/, "");
    line = line.replace(/^[\s.。]+|[\s.。]+$/gu, "");
    if (line) return line;
  }
  return null;
}
