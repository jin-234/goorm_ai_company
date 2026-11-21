/**
 * 요청 하나의 흐름: 상태 읽기 → 회사 시계 맞추기 → 규칙 실행 → 저장.
 *
 * 회사 시계: 한국 표준시(Asia/Seoul, UTC+9). 새 회사는 실제 지금 시각에서 시작하고(사용자 결정 2026-11-21),
 * 실제 시간과 같은 빠르기로 흐른다. 서버 시간대(Vercel은 UTC)와 무관하다(epoch 밀리초 + KST 표시 함수).
 * 저장할 때의 "회사 시각 − 실제 시각" 차이를 유지하므로, 시연의 [다음 정각]·[다음 근무일]로 건너뛴 만큼만 앞서 간다.
 * 하루를 마감하지 않은 채 자정이 지나면 그날 23:59에서 멈추고, 다음 활동일을 시작하면 실제 오늘로 간다.
 */
import { Office } from "../office/office";
import { getStore, type OfficeStore } from "./store";

/** 새 회사는 실제 지금 시각(한국 시각으로 표시)에서 시작한다. */
export function newOffice(realNow = Date.now()): Office {
  return new Office(realNow);
}

/** 마지막으로 저장한 뒤 흐른 실제 시간만큼 회사 시계를 보낸다(건너뛴 차이는 그대로 유지). */
export function syncClock(office: Office, clockAnchor: number, realNow: number): void {
  const elapsed = realNow - clockAnchor;
  if (elapsed > 0) office.advance(office.now + elapsed);
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
  const loaded = await store.load(id);
  // 옛 근태 형식(지각·카메라)으로 저장된 상태는 이어 쓰지 않고 새로 시작한다.
  const stored = loaded && Office.isCurrent(loaded.state) ? loaded : null;
  const office = stored ? Office.fromJSON(stored.state) : newOffice(realNow);
  if (stored) syncClock(office, stored.clockAnchor, realNow);
  office.realNow = realNow;
  const result = await work(office);
  await store.save(id, { state: office.toJSON(), clockAnchor: realNow });
  return { office, result };
}
