/**
 * 요청 하나의 흐름: 상태 읽기 → 가상 시계 맞추기 → 규칙 실행 → 저장.
 *
 * 가상 시계: 실제 시간과 같은 빠르기로 흐른다.
 * 서버는 계속 떠 있지 않으므로, 요청이 올 때 "마지막으로 맞춘 뒤 흐른 실제 시간"만큼 시계를 앞으로 보낸다.
 * 브라우저가 CLOCK_PAUSE_AFTER_MS보다 오래 요청하지 않았으면 앱을 닫아 둔 것으로 보고 그 사이 시간은 흘리지 않는다.
 */
import { Office } from "../office/office";
import { getStore, type OfficeStore } from "./store";

/** 이보다 오래 요청이 없으면 시계가 멈춰 있던 것으로 본다(브라우저를 닫음). */
export const CLOCK_PAUSE_AFTER_MS = 2 * 60 * 1000;

export function newOffice(realNow = Date.now()): Office {
  return new Office(Office.demoStart(realNow));
}

/** 마지막으로 맞춘 뒤 흐른 실제 시간만큼 가상 시계를 보낸다. */
export function syncClock(office: Office, clockAnchor: number, realNow: number): void {
  const elapsed = realNow - clockAnchor;
  if (elapsed > 0 && elapsed <= CLOCK_PAUSE_AFTER_MS) office.advance(office.now + elapsed);
}

/**
 * 회사 상태를 읽어 시계를 맞추고 `work`를 실행한 뒤 저장한다.
 * `work`가 던지면 저장하지 않는다(시계만 맞춘 상태도 버린다).
 */
export async function withOffice<T>(
  id: string,
  work: (office: Office) => T | Promise<T>,
  options: { store?: OfficeStore; realNow?: number } = {},
): Promise<{ office: Office; result: T }> {
  const store = options.store ?? getStore();
  const realNow = options.realNow ?? Date.now();
  const stored = await store.load(id);
  const office = stored ? Office.fromJSON(stored.state) : newOffice(realNow);
  if (stored) syncClock(office, stored.clockAnchor, realNow);
  const result = await work(office);
  await store.save(id, { state: office.toJSON(), clockAnchor: realNow });
  return { office, result };
}
