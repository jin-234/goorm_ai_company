/**
 * 회사 시각은 한국 시각(Asia/Seoul, UTC+9, 서머타임 없음)으로 고정한다.
 * 시각은 모두 epoch 밀리초(number)로 다룬다. JSON으로 그대로 저장할 수 있다.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** 시각(epoch ms). */
export type Instant = number;

/** 달력의 하루. 근무일을 구분하는 기준이다. */
export interface DayKey {
  year: number;
  month: number;
  day: number;
}

export function dayKeyOf(instant: Instant): DayKey {
  const shifted = new Date(instant + KST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function makeDay(year: number, month: number, day: number): DayKey {
  return { year, month, day };
}

/** 이 날 자정(KST)에서 `minutes`분 지난 시각. */
export function at(day: DayKey, minutes: number): Instant {
  return Date.UTC(day.year, day.month - 1, day.day) - KST_OFFSET_MS + minutes * MINUTE_MS;
}

/** 1 = 일요일 … 7 = 토요일 */
export function weekday(day: DayKey): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay() + 1;
}

export const isWeekend = (day: DayKey) => weekday(day) === 1 || weekday(day) === 7;
export const isFriday = (day: DayKey) => weekday(day) === 6;

export function weekdayName(day: DayKey): string {
  return ["일", "월", "화", "수", "목", "금", "토"][weekday(day) - 1];
}

export function addDays(day: DayKey, days: number): DayKey {
  return dayKeyOf(at(day, 12 * 60) + days * DAY_MS);
}

/** 다음 근무일. 토요일과 일요일은 건너뛴다. */
export function nextWorkday(day: DayKey): DayKey {
  let next = addDays(day, 1);
  while (isWeekend(next)) next = addDays(next, 1);
  return next;
}

/** 이 날이 속한 주의 월요일. */
export function mondayOfWeek(day: DayKey): DayKey {
  const offset = (weekday(day) + 5) % 7;
  return addDays(day, -offset);
}

/** 주간보고 제목에 쓰는 주차. 그 주 월요일이 속한 달 기준. 예: 11월 3주차 */
export function weekLabel(day: DayKey): string {
  const monday = mondayOfWeek(day);
  return `${monday.month}월 ${Math.floor((monday.day - 1) / 7) + 1}주차`;
}

/** 예: 2026-11-16 */
export function dayString(day: DayKey): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(day.year, 4)}-${pad(day.month)}-${pad(day.day)}`;
}

/** 예: 11월 16일(월) */
export const koreanShort = (day: DayKey) => `${day.month}월 ${day.day}일(${weekdayName(day)})`;

/** 예: 2026년 11월 16일 월요일 */
export const koreanLong = (day: DayKey) => `${day.year}년 ${day.month}월 ${day.day}일 ${weekdayName(day)}요일`;

export function sameDay(a: DayKey | null | undefined, b: DayKey | null | undefined): boolean {
  if (!a || !b) return a == b;
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** 한국 시각 기준, 자정에서 지난 분. 초는 버린다. */
export function minuteOfDay(instant: Instant): number {
  const ms = (((instant + KST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.floor(ms / MINUTE_MS);
}

/** 예: 09:05 */
export const hm = (instant: Instant) => Clock.hm(minuteOfDay(instant));

/** 두 시각 사이의 분(소수점 버림). */
export const minutesBetween = (start: Instant, end: Instant) => Math.trunc((end - start) / MINUTE_MS);

export const addMinutes = (instant: Instant, minutes: number) => instant + minutes * MINUTE_MS;

export const Clock = {
  /** 분을 "HH:MM"으로. */
  hm(minutes: number): string {
    const clamped = Math.max(0, minutes);
    const h = Math.floor(clamped / 60) % 24;
    return `${String(h).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
  },

  /** "HH:MM"(또는 "H:MM")을 분으로. 형식이 틀리면 null. */
  minutesFromHM(text: string): number | null {
    const match = /^(\d{1,2}):(\d{1,2})$/.exec(text.trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 24 || minute >= 60) return null;
    const total = hour * 60 + minute;
    return total <= 24 * 60 ? total : null;
  },

  /** 예: 오후 3시, 오후 3시 30분 */
  korean(minutes: number): string {
    const hour = Math.floor(minutes / 60) % 24;
    const minute = minutes % 60;
    const half = hour < 12 ? "오전" : "오후";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return minute === 0 ? `${half} ${hour12}시` : `${half} ${hour12}시 ${minute}분`;
  },

  /** 분 길이를 읽기 쉬운 말로. 예: 1시간 5분 */
  duration(minutes: number): string {
    const value = Math.max(0, minutes);
    if (value < 60) return `${value}분`;
    return value % 60 === 0 ? `${value / 60}시간` : `${Math.floor(value / 60)}시간 ${value % 60}분`;
  },
};
