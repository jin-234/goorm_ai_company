/**
 * 아침 PT 전사문을 서버 안 규칙으로 읽어 업무 초안을 만든다.
 *
 * Solar에 연결하지 못했을 때 쓰는 간이 정리다. AI가 아니라 정해진 규칙이므로
 * 양식("3단계 필수 업무는 ~입니다. 오후 3시까지 ~하겠습니다.")에 가깝게 말할수록 잘 읽는다.
 * 전사문에 없는 값은 null로 두어 화면에 '확인 필요'로 보이게 한다.
 */
import { newDraft, type TaskDraft, type TaskLevel } from "./models";
import { WorkRules } from "./rules";

interface Span {
  start: number;
  end: number;
}

interface LevelMarker extends Span {
  level: TaskLevel;
}

export interface Deadline extends Span {
  minutes: number;
}

const HOUR_WORDS: Record<string, number> = {
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12,
};

const MINUTE_WORDS: Record<string, number> = {
  십: 10, 십오: 15, 이십: 20, 삼십: 30, 사십: 40, 사십오: 45, 오십: 50,
};

const FILLERS = [
  "안녕하세요", "안녕하십니까", "시작하겠습니다", "말씀드리겠습니다", "발표하겠습니다",
  "이상입니다", "감사합니다", "수고하셨습니다", "아침 PT", "아침 피티",
];

const toInt = (text: string): number | null => (/^\d+$/.test(text) ? Number(text) : null);

function* matchAll(pattern: string, text: string): Generator<RegExpExecArray> {
  const re = new RegExp(pattern, "gu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}

export function parse(transcript: string, workEnd: number = WorkRules.defaultWorkEnd): TaskDraft[] {
  const text = normalize(transcript);
  if (!text) return [];

  const markers = levelMarkers(text);
  const drafts: TaskDraft[] = [];

  if (markers.length === 0) {
    for (const sentence of sentences(text)) {
      const draft = draftFromFreeSentence(sentence, workEnd);
      if (draft) drafts.push(draft);
    }
  } else {
    markers.forEach((marker, index) => {
      const end = index + 1 < markers.length ? markers[index + 1].start : text.length;
      drafts.push(draftFromSegment(text.slice(marker.end, end), marker.level, workEnd));
    });
  }

  // 중요도가 높은 순서로. 단계를 모르는 업무는 뒤에 둔다(같으면 말한 순서).
  return [...drafts].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
}

// MARK: 단계 표시 찾기

/** 단계 앞에 오는 숫자 말. 숫자·한자어·고유어·영어로 말할 수 있다. */
const LEVEL_WORDS: Record<string, TaskLevel> = {
  "3": 3, 삼: 3, 세: 3, 쓰리: 3,
  "2": 2, 이: 2, 두: 2, 투: 2,
  "1": 1, 일: 1, 한: 1, 원: 1,
};

export function levelMarkers(text: string): LevelMarker[] {
  // "3단계부터 1단계 순서로 말씀드리겠습니다" 같은 안내 말은 업무가 아니다.
  const pattern = "(3|2|1|삼|이|일|세|두|한|쓰리|투|원)\\s*단계(?!\\s*(?:부터|까지|순서|순으로|에서|별로))";
  return [...matchAll(pattern, text)].map((m) => ({ level: LEVEL_WORDS[m[1]], start: m.index, end: m.index + m[0].length }));
}

// MARK: 구간 → 초안

export function draftFromSegment(raw: string, level: TaskLevel, workEnd: number): TaskDraft {
  const body = stripLead(raw);
  const due = deadline(body, workEnd)?.minutes ?? null;
  const parts = sentences(body);
  if (parts.length === 0) return newDraft({ level, due });

  const firstClean = removingDeadline(parts[0], workEnd);
  const title = nominalTitle(firstClean) ?? actionPhrase(firstClean);
  const criteria = parts
    .slice(1)
    .map((s) => actionPhrase(removingDeadline(s, workEnd)))
    .filter((s) => s.length > 0)
    .join(", ");

  return newDraft({ title: title || null, level, due, doneCriteria: criteria || null });
}

export function draftFromFreeSentence(sentence: string, workEnd: number): TaskDraft | null {
  if (FILLERS.some((f) => sentence.includes(f))) return null;
  const due = deadline(sentence, workEnd)?.minutes ?? null;
  const cleaned = removingDeadline(sentence, workEnd);
  const title = nominalTitle(cleaned) ?? actionPhrase(cleaned);
  if ([...title].length < 2) return null;
  return newDraft({ title, level: null, due, doneCriteria: null });
}

/** "필수 업무는 지원서 최종 검토입니다" → "지원서 최종 검토입니다" */
export function stripLead(raw: string): string {
  let text = raw.replace(/^[\s,:·-]+|[\s,:·-]+$/gu, "");
  // 단계 이름 뒤에 바로 붙은 조사: "3단계는 …", "3단계로는 …"
  text = text.replace(/^(?:로는|으로는|는|은)\s+/u, "");
  // 단계 설명과 '업무는' 같은 말머리
  text = text.replace(/^(?:필수\s*마감|필수|당일\s*완료|당일|이월\s*가능)?\s*(?:(?:업무|과제|할\s*일)\s*(?:로는|는|은)?)?\s*/u, "");
  return text.trim();
}

/** "지원서 최종 검토입니다" → "지원서 최종 검토". 명사로 끝나는 문장이 아니면 null. */
export function nominalTitle(sentence: string): string | null {
  const text = trimSentence(sentence);
  const m = /^(.+?)\s*(?:입니다|이에요|예요|이고요|이구요|이며|이고)$/u.exec(text);
  const title = m?.[1].trim();
  return title ? title : null;
}

/**
 * 하겠다는 말을 끝내는 조건 문구로 바꾼다.
 * "오탈자를 확인하고 제출본을 저장하겠습니다" → "오탈자를 확인하고 제출본을 저장"
 * "문단을 쓰겠습니다" → "문단을 쓰기"
 */
export function actionPhrase(sentence: string): string {
  const text = trimSentence(sentence);
  if (!text) return "";

  // "보내도록 하겠습니다" → "보내기"
  const toDo = /^(.*\S)도록\s*하겠(?:습니다|어요)$/u.exec(text);
  if (toDo) return toDo[1] + "기";

  const doEndings =
    "(?:하겠습니다|하겠어요|할게요|할\\s*예정입니다|할\\s*계획입니다|하려고\\s*합니다|하려\\s*합니다|할\\s*겁니다|할\\s*것입니다|할\\s*거예요|합니다)";
  const doMatch = new RegExp(`^(.*?)(\\s*)${doEndings}$`, "u").exec(text);
  if (doMatch) {
    const stem = doMatch[1];
    if (!stem) return text;
    // "정리를 하겠습니다"처럼 띄어 쓴 경우는 "정리를 하기"
    return doMatch[2] === "" ? stem : stem + " 하기";
  }

  const will = /^(.*\S)겠(?:습니다|어요)$/u.exec(text);
  if (will) return will[1] + "기";
  return text;
}

// MARK: 마감

/** 문장에서 가장 먼저 나오는 마감 표현을 찾는다. */
export function deadline(text: string, workEnd: number): Deadline | null {
  const found: Deadline[] = [];
  const untilWords = "(?:까지|전까지|이전까지|전에|이전에|안에|안으로)";

  // 오후 3시까지, 세 시 반까지, 15시 30분까지
  const clock =
    "(오전|오후|아침|저녁|낮|밤)?\\s*(\\d{1,2}|열한|열두|다섯|여섯|일곱|여덟|아홉|열|한|두|세|네)\\s*시(?!간)\\s*" +
    "(?:(\\d{1,2}|사십오|십오|삼십|이십|사십|오십|십)\\s*분|(반))?\\s*" +
    untilWords;
  for (const m of matchAll(clock, text)) {
    const rawHour = toInt(m[2]) ?? HOUR_WORDS[m[2]];
    if (rawHour == null || rawHour < 0 || rawHour > 24) continue;
    let minute = 0;
    if (m[3] != null) minute = toInt(m[3]) ?? MINUTE_WORDS[m[3]] ?? 0;
    else if (m[4] != null) minute = 30;
    if (minute < 0 || minute >= 60) continue;
    found.push({ minutes: resolveHour(rawHour, m[1] ?? null) * 60 + minute, start: m.index, end: m.index + m[0].length });
  }

  // 15:00까지
  for (const m of matchAll(`(\\d{1,2}):(\\d{2})\\s*${untilWords}`, text)) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute >= 60) continue;
    found.push({ minutes: hour * 60 + minute, start: m.index, end: m.index + m[0].length });
  }

  // 퇴근 전까지, 오늘 안에
  const endOfDay = "퇴근\\s*(?:시간)?\\s*(?:전까지|전에|까지|전)|(?:오늘|금일)\\s*(?:안에|안으로|중으로|중에|내로|까지)";
  for (const m of matchAll(endOfDay, text)) found.push({ minutes: workEnd, start: m.index, end: m.index + m[0].length });

  // 점심 전까지, 오전 중으로, 정오까지
  const noon = "(?:점심|오전)\\s*(?:시간)?\\s*(?:전까지|전에|까지|중으로|중에|안에|안으로)|정오\\s*(?:까지|전까지|전에)";
  for (const m of matchAll(noon, text)) found.push({ minutes: 12 * 60, start: m.index, end: m.index + m[0].length });

  return found.reduce<Deadline | null>((best, d) => (best == null || d.start < best.start ? d : best), null);
}

/** 오전·오후를 말하지 않은 시각은 근무시간에 맞춰 읽는다. 1~8시는 오후, 9~11시는 오전. */
export function resolveHour(hour: number, half: string | null): number {
  switch (half) {
    case "오후":
    case "저녁":
    case "밤":
      return hour < 12 ? hour + 12 : hour;
    case "오전":
    case "아침":
      return hour === 12 ? 0 : hour;
    case "낮":
      return hour < 8 ? hour + 12 : hour;
    default:
      if (hour >= 13) return hour;
      return hour <= 8 ? hour + 12 : hour;
  }
}

export function removingDeadline(sentence: string, workEnd: number): string {
  const found = deadline(sentence, workEnd);
  if (!found) return sentence;
  const text = sentence.slice(0, found.start) + sentence.slice(found.end);
  return text.replace(/\s{2,}/gu, " ").trim();
}

// MARK: 문장 다루기

export function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 문장 단위로 나눈다. 음성 전사에는 마침표가 없을 수 있어 말끝도 함께 본다. */
export function sentences(text: string): string[] {
  // 마침표 뒤에 공백이 없을 때는 "3.5"처럼 숫자가 이어지는 경우를 나누지 않는다.
  const separator =
    "(?<=[.!?。])\\s+|(?<=[.!?。])(?=[^\\d\\s])|\\n+|(?<=니다)\\s+|(?<=어요)\\s+|(?<=게요)\\s+|(?<=예요)\\s+";
  const pieces: string[] = [];
  let cursor = 0;
  for (const m of matchAll(separator, text)) {
    const start = m.index;
    if ((m[0].length === 0 && start === 0) || start < cursor) continue;
    pieces.push(text.slice(cursor, start));
    cursor = start + m[0].length;
  }
  pieces.push(text.slice(cursor));
  return pieces.map(trimSentence).filter((s) => s.length > 0);
}

export function trimSentence(text: string): string {
  return text.replace(/^[\s.!?。,·]+|[\s.!?。,·]+$/gu, "");
}

export const PTParser = { parse, deadline, actionPhrase, sentences };
