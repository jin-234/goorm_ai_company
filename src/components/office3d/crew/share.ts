/**
 * 공유 장면(AI 동료 프롬프트 문서 1장 흐름).
 * ① 개발팀장 사전 보고(stage review): 내가 팀장 자리 앞으로 가서 서서 보고하고, 팀장은 앉아서 듣거나 설명한다.
 * ② 부서 회의(stage meeting): 기획·디자인·운영 담당자(부서당 1명)가 출입문으로 들어와 회의실 의자에 앉고,
 *    나는 팀장 자리(또는 내 자리)에서 회의실 화면 옆으로 가서 발표한다(ready). 마지막으로 말한 부서 담당자가 설명하는 몸짓을 한다.
 * ③ 회의록 정리(stage minutes·done)나 공유가 끝나면: 손님은 일어나 인사하고 출입문으로 나가고, 나는 내 자리로 돌아와 앉는다.
 * 시각(t초)만 넣으면 모습이 정해지는 순수 함수라 시험으로 길과 시간을 검사한다.
 */
import type { Pose } from "../person";
import {
  along, headingOf, MEETING, meetingSeatPath, pathLength, presenterPath, route, SEATS, type Vec2,
} from "./layout";
import type { Snapshot } from "./schedule";

/** 부서 회의 참석자(부서당 1명, 문서 2장): 기획팀 AI 기획자, 디자인팀 AI 디자이너, 운영팀 운영 담당자(회의실 발표 순서와 같음). */
export const GUESTS = ["planner", "designer", "operations"] as const;
/** 회의 진행 부서. */
export const HOST: GuestId = "planner";
export type GuestId = (typeof GUESTS)[number];

/** 손님이 앉는 회의실 의자(화면을 보는 줄 셋). 부서마다 담당자 1명씩만 온다. */
const GUEST_CHAIR: Record<GuestId, number> = { planner: 1, designer: 2, operations: 0 };
/** 손님 자리와 부서 이름(명패). 부서를 늘려도 부서당 1명. */
export const GUEST_SEATS: { guest: GuestId; dept: string; chair: number }[] = [
  { guest: "planner", dept: "기획팀", chair: GUEST_CHAIR.planner },
  { guest: "designer", dept: "디자인팀", chair: GUEST_CHAIR.designer },
  { guest: "operations", dept: "운영팀", chair: GUEST_CHAIR.operations },
];
/** 들어오는 순서: 문에서 먼 의자부터. 나갈 때는 반대(문 쪽 의자부터). */
export const ENTRY_ORDER: GuestId[] = [...GUESTS].sort((a, b) => MEETING.chairs[GUEST_CHAIR[a]].at[0] - MEETING.chairs[GUEST_CHAIR[b]].at[0]);
export const DEPT_OF: Record<GuestId, string> = { planner: "기획팀", designer: "디자인팀", operations: "운영팀" };

/** 팀장 사전 보고 때 내가 서는 곳: 팀장 책상 앞(통로 쪽), 팀장을 본다. */
export const REPORT_SPOT: Vec2 = [3.6, 2.25];
const REPORT_FACING: Vec2 = (() => {
  const m = SEATS.manager.chair;
  const d: Vec2 = [m[0] - REPORT_SPOT[0], m[1] - REPORT_SPOT[1]];
  const l = Math.hypot(d[0], d[1]);
  return [d[0] / l, d[1] / l];
})();

/** 내 자리 → 팀장 자리 앞. */
export function meToReportPath(): Vec2[] {
  const s = SEATS.me;
  return [s.stand, [s.stand[0], 2.85], [REPORT_SPOT[0], 2.85], REPORT_SPOT];
}
/** 손님이 들어오는 시차(초)와 걷는 빠르기(m/s). 화면 틀 대체 시간(12초)보다 넉넉히 먼저(약 10초) 발표가 시작되게 빠르게 걷는다. */
export const SHARE = { stagger: 1.3, guestSpeed: 1.7, meSpeed: 1.75, sitDown: 0.5, stand: 0.6, bow: 1.0 } as const;
const SEATED_Y = 0.215;

/** 문 밖 → 회의실 의자. */
export function guestInPath(g: GuestId): Vec2[] {
  // route는 문 밖 끝점에서 시작해 회의실 출입구에서 끝난다. 출입구에서 의자까지는 가로길로.
  const fromDoor = route({ spot: "outside" }, { spot: "meeting" });
  return [...fromDoor.slice(0, -1), ...meetingSeatPath(MEETING.chairs[GUEST_CHAIR[g]].at)];
}

/** 내 자리(또는 팀장 자리 앞) → 회의실 발표 자리. */
export function meToPresenterPath(from: "seat" | "report" = "seat"): Vec2[] {
  const toMeeting = route({ seat: "me" }, { spot: "meeting" });
  const head = from === "report" ? [REPORT_SPOT, [REPORT_SPOT[0], 2.85] as Vec2, ...toMeeting.slice(1, -1)] : toMeeting.slice(0, -1);
  return [...head, ...presenterPath()];
}

/** 팀장 사전 보고 t초: 자리에서 일어나 팀장 자리 앞으로 걸어가 서서 보고한다. */
export function reviewAt(t: number): { me: Snapshot; arrived: boolean } {
  const path = meToReportPath();
  const walk = walkTime(path, SHARE.meSpeed);
  if (t < walk) return { me: walking("me", path, t * SHARE.meSpeed, "팀장에게 보고하러"), arrived: false };
  return { me: reporting(), arrived: true };
}

const reporting = (): Snapshot => ({
  id: "me", visible: true, position: [REPORT_SPOT[0], 0, REPORT_SPOT[1]], heading: headingOf(REPORT_FACING),
  pose: "present", holding: {}, doing: "팀장 사전 보고",
});
export const reviewSteady = reporting;

/** 사전 보고 중 팀장 자세: 팀장이 마지막으로 말했으면 설명, 아니면 듣다가 가끔 끄덕인다. */
export function managerPose(speaker: string | null, t: number): Pose {
  if (speaker === "dev_lead") return "sitExplain";
  return Math.floor(t / 4) % 3 === 2 ? "nod" : "sitListen";
}

const walkTime = (path: Vec2[], speed: number) => pathLength(path) / speed;

function seated(id: string, chairIndex: number, pose: Pose): Snapshot {
  const c = MEETING.chairs[chairIndex];
  return { id: id as Snapshot["id"], visible: true, position: [c.at[0], SEATED_Y, c.at[1]], heading: headingOf(c.facing), pose, holding: {}, doing: "회의실에서 듣기" };
}

function walking(id: string, path: Vec2[], d: number, doing: string): Snapshot {
  const p = along(path, d);
  return { id: id as Snapshot["id"], visible: true, position: [p.at[0], 0, p.at[1]], heading: headingOf(p.facing), pose: "walk", holding: {}, doing };
}

const presenting = (): Snapshot => ({
  id: "me", visible: true, position: [MEETING.presenter[0], 0, MEETING.presenter[1]], heading: headingOf(MEETING.presenterFacing),
  pose: "present", holding: {}, doing: "타 부서 공유 발표",
});

const atDesk = (pose: Pose = "sitType"): Snapshot => {
  const s = SEATS.me;
  return { id: "me", visible: true, position: [s.chair[0], SEATED_Y, s.chair[1]], heading: headingOf(s.facing), pose, holding: {}, doing: "내 자리" };
};

const hidden = (id: string): Snapshot => ({ id: id as Snapshot["id"], visible: false, position: [0, 0, 0], heading: 0, pose: "hidden", holding: {}, doing: "없음" });

/**
 * 회의 중 손님 자세: 마지막으로 말한 부서(speaker)의 담당자가 설명하는 몸짓(sitExplain), 나머지는 듣다가 가끔 끄덕인다.
 * 말한 부서를 모르면 진행자(기획팀)가 묻고 끄덕이기를 번갈아 한다.
 */
function listening(g: GuestId, t: number, speaker: string | null = null): Pose {
  if (speaker && GUESTS.includes(speaker as GuestId)) {
    if (g === speaker) return "sitExplain";
    return Math.floor((t + GUESTS.indexOf(g) * 1.7) / 4.5) % 3 === 2 ? "nod" : "sitListen";
  }
  if (g === HOST) return Math.floor(t / 3.2) % 2 === 0 ? "sitExplain" : "nod";
  return Math.floor((t + 1.3) / 4.5) % 3 === 2 ? "nod" : "sitListen";
}

/** 들어오는 연출의 시간표. */
export function arrivalTimes(from: "seat" | "report" = "seat") {
  // 안쪽 의자(문에서 먼 쪽)에 앉을 사람부터 들어온다. 늦게 온 사람이 앉아 있는 사람 앞을 지나가지 않는다.
  const guestStart = (g: GuestId) => ENTRY_ORDER.indexOf(g) * SHARE.stagger;
  const guestSeat = (g: GuestId) => guestStart(g) + walkTime(guestInPath(g), SHARE.guestSpeed);
  // 손님이 걸어오는 동안 나도 자리에서 일어나 회의실로 간다. 마지막 손님이 앉고 조금 뒤 발표 자리에 닿도록 거꾸로 맞춘다
  // (회의실에 들어서면 손님은 이미 앉아 있다). 대체 시간 12초 안에 끝난다.
  const lastSeat = Math.max(...GUESTS.map(guestSeat));
  const meWalk = walkTime(meToPresenterPath(from), SHARE.meSpeed);
  // 자리에 앉아 있었으면 0.8초 뒤 일어나고, 팀장 자리 앞에 서 있었으면 바로 걷는다.
  const meStart = Math.max(from === "report" ? 0 : 0.8, lastSeat + 0.6 - meWalk);
  const ready = meStart + meWalk;
  return { guestStart, guestSeat, meStart, ready };
}

/** 공유 단계가 시작된 뒤 t초. ready면 손님은 앉았고 나는 발표 자리에 섰다. */
export function shareArrivalAt(t: number, from: "seat" | "report" = "seat", speaker: string | null = null): { guests: Record<GuestId, Snapshot>; me: Snapshot; ready: boolean } {
  const times = arrivalTimes(from);
  const guests = {} as Record<GuestId, Snapshot>;
  for (const g of GUESTS) {
    const t0 = times.guestStart(g);
    const path = guestInPath(g);
    if (t < t0) guests[g] = hidden(g);
    else if (t < times.guestSeat(g)) guests[g] = walking(g, path, (t - t0) * SHARE.guestSpeed, "회의실로");
    else guests[g] = seated(g, GUEST_CHAIR[g], t < times.guestSeat(g) + SHARE.sitDown ? "sitListen" : listening(g, t, speaker));
  }
  let me: Snapshot;
  if (t < times.meStart) me = from === "report" ? reporting() : atDesk();
  else if (t < times.ready) me = walking("me", meToPresenterPath(from), (t - times.meStart) * SHARE.meSpeed, "회의실로 발표하러");
  else me = presenting();
  return { guests, me, ready: t >= times.ready };
}

/** 공유 중(연출이 끝났거나 처음부터 공유 단계로 들어온 경우)의 모습. t는 아무 초(자세 바꾸기용). */
export function shareSteady(t: number, speaker: string | null = null): { guests: Record<GuestId, Snapshot>; me: Snapshot } {
  const guests = {} as Record<GuestId, Snapshot>;
  for (const g of GUESTS) guests[g] = seated(g, GUEST_CHAIR[g], listening(g, t, speaker));
  return { guests, me: presenting() };
}

/** 회의실 의자 → 문 밖(나가는 길). */
export function guestOutPath(g: GuestId): Vec2[] {
  return [...guestInPath(g)].reverse();
}

/** 발표 자리 → 내 자리. */
export function meBackPath(): Vec2[] {
  return [...meToPresenterPath()].reverse();
}

/** 공유가 끝난 뒤 t초. done이면 손님은 나갔고 나는 자리에 앉았다. */
export function shareEndAt(t: number): { guests: Record<GuestId, Snapshot>; me: Snapshot; done: boolean } {
  const guests = {} as Record<GuestId, Snapshot>;
  let guestsGone = true;
  // 한 줄로 나간다: 문 쪽에 가까운 의자(오른쪽)부터 1.3초 간격.
  const outOrder = [...ENTRY_ORDER].reverse();
  for (const g of GUESTS) {
    const i = outOrder.indexOf(g);
    const t0 = i * SHARE.stagger;
    const walkFrom = t0 + SHARE.stand + SHARE.bow;
    const path = guestOutPath(g);
    const walkEnd = walkFrom + walkTime(path, SHARE.guestSpeed);
    const c = MEETING.chairs[GUEST_CHAIR[g]];
    if (t < t0) guests[g] = seated(g, GUEST_CHAIR[g], "sitListen");
    else if (t < walkFrom) {
      // 일어나 발표자(나) 쪽을 보고 인사한다.
      const toward: Vec2 = [MEETING.presenter[0] - c.at[0], MEETING.presenter[1] - c.at[1]];
      const len = Math.hypot(toward[0], toward[1]) || 1;
      guests[g] = { id: g as Snapshot["id"], visible: true, position: [c.at[0], 0, c.at[1]], heading: headingOf([toward[0] / len, toward[1] / len]), pose: t < t0 + SHARE.stand ? "stand" : "bow", holding: {}, doing: "인사" };
    } else if (t < walkEnd) guests[g] = walking(g, path, (t - walkFrom) * SHARE.guestSpeed, "나가는 길");
    else guests[g] = hidden(g);
    if (t < walkEnd) guestsGone = false;
  }
  const meWalkFrom = SHARE.stand + SHARE.bow; // 손님 인사를 받고 나서 자리로
  const meWalkEnd = meWalkFrom + walkTime(meBackPath(), SHARE.meSpeed);
  let me: Snapshot;
  if (t < meWalkFrom) me = { ...presenting(), pose: t < SHARE.stand ? "present" : "bow", doing: "인사" };
  else if (t < meWalkEnd) me = walking("me", meBackPath(), (t - meWalkFrom) * SHARE.meSpeed, "자리로");
  else me = atDesk();
  return { guests, me, done: guestsGone && t >= meWalkEnd };
}
