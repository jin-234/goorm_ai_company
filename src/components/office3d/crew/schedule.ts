/**
 * 동료들의 하루. 시각(epoch ms)만 넣으면 모두의 위치·자세·손에 든 것과 책상 소품 상태가 정해진다.
 * 상태를 쌓지 않는 순수 함수라, 시계를 건너뛰어도(+1시간) 같은 시각엔 늘 같은 장면이 나온다.
 *
 * 하루 흐름(사람마다 그날 시드로 조금씩 다름). 시각은 사용자가 정한 활동 시간(시작·마감)을 기준으로 한다.
 * 정해진 09·18시, 야근·저녁 외출·지각 연출은 없다(VISION COMPANY 개정 기획서 3.1).
 * - 활동 시작 8~45분 전 가방을 메거나 들고 복도에서 걸어 들어와, 의자 옆에 가방을 내려놓고 앉는다.
 * - 일하는 동안 가끔 자기 머그로 한 모금(책상 머그를 집어 든다 → 책상 위 머그는 사라짐).
 * - 4~9분마다: 자기 머그를 들고 커피 받아 오기 / 정수기 종이컵으로 물 / 화장실 / 창가 기지개.
 *   한 곳(커피·정수기·화장실·창가)은 한 번에 한 사람만 쓴다.
 * - 점심(85%, 활동 시간이 12~13시를 덮을 때만) 12:00~12:58: 가방은 두고 나갔다 온다.
 * - 퇴근(활동 마감 1~12분 뒤): 의자 옆 가방을 집어 들고(짐 챙기기) 문으로 나간다.
 * - 기획팀 AI 기획자는 내가 공유하러 오면(단계 sharing) 자리에 앉아 듣는다.
 */
import type { Holding, Pose } from "../person";
import {
  along, deskSpots, DOOR_X, headingOf, MEETING, OUTSIDE_MAT, pathLength, ROOM, route, SEATS, SPOTS,
  type Place, type SeatId, type Spot, type Vec2,
} from "./layout";

export const COWORKERS = ["director", "manager", "kwajang", "daeri", "senior", "peerA", "peerB", "planner"] as const satisfies readonly SeatId[];
export type CoworkerId = (typeof COWORKERS)[number];
/** 아침보고는 AI 팀장과 둘이 한다(개정 기획서: 동료 7명 연출보다 팀장·기획자 대화 우선). */
export const PT_AUDIENCE: CoworkerId[] = ["manager"];

/** 사용자가 정한 활동 시간(자정 기준 분). 기본 09:00~18:00. */
export interface ActivityWindow { start: number; end: number }
export const DEFAULT_WINDOW: ActivityWindow = { start: 9 * 60, end: 18 * 60 };

const MIN = 60_000;
const SEC = 1000;
/** 걷는 빠르기(m/s). */
export const WALK_SPEED = 1.15;
const KST = 9 * 60 * MIN;

/** 이 사람이 지금 하는 것. */
export interface Snapshot {
  id: SeatId;
  visible: boolean;
  /** 발 위치 [x, y, z]. 앉으면 y = SEATED_ROOT_Y. */
  position: [number, number, number];
  /** three.js rotation.y */
  heading: number;
  pose: Pose;
  holding: Holding;
  /** 지금 하는 일(사람이 읽는 설명, 시험·디버그용). */
  doing: string;
}

/** 책상 위·옆 소품. */
export interface DeskProps {
  /** 책상 위 자기 머그가 보이는지(손에 들고 있으면 false). */
  mugOnDesk: boolean;
  /** 의자 옆 바닥에 가방이 있는지(출근해 있는 동안). */
  bagAtDesk: boolean;
  /** 모니터·스탠드가 켜졌는지(자리에 있거나 잠깐 비운 동안). */
  screenOn: boolean;
}

type Segment =
  | { kind: "walk"; t0: number; t1: number; path: Vec2[]; holding: Holding; doing: string }
  | { kind: "act"; t0: number; t1: number; at: Vec2; facing: Vec2; pose: Pose; holding: Holding; doing: string; seated?: boolean }
  | { kind: "hidden"; t0: number; t1: number; doing: string };

interface DayPlan {
  arrive: number;
  leave: number;
  lunch: { out: number; back: number } | null;
  /** 가방이 의자 옆에 놓여 있는 구간. */
  bagFrom: number;
  bagUntil: number;
  segments: Segment[];
}

// ─── 시드 난수 ───────────────────────────────────────────────

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (lo: number, hi: number) => lo + (hi - lo) * next() };
}

/** 그날 자정(KST)의 epoch ms. */
export function dayStart(now: number): number {
  return Math.floor((now + KST) / (24 * 60 * MIN)) * 24 * 60 * MIN - KST;
}

// ─── 하루 계획 만들기 ────────────────────────────────────────

const cache = new Map<string, Record<CoworkerId, DayPlan>>();

/** 그날 모든 동료의 계획. 같은 날·같은 활동 시간이면 다시 계산하지 않는다. */
export function dayPlans(day0: number, window: ActivityWindow = DEFAULT_WINDOW): Record<CoworkerId, DayPlan> {
  const key = `${day0}:${window.start}:${window.end}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = (minutes: number) => day0 + minutes * MIN;

  const base = {} as Record<CoworkerId, DayPlan>;
  for (const id of COWORKERS) {
    const r = rng(hashString(`${day0}:${id}`));
    // 활동 시작 전에 모두 앉는다(팀장은 아침보고를 위해 조금 일찍). 시작 시각을 지나 들어오는 사람은 없다.
    const before = id === "manager" ? r.range(14, 30) : id === "director" ? r.range(8, 20) : r.range(10, 45);
    const arrive = m(Math.max(6 * 60, window.start - before));
    const leave = m(Math.min(23 * 60 + 50, window.end + r.range(1, 12)));
    const lunchRoll = r.next();
    const lunch = window.start < 12 * 60 && window.end > 13 * 60 + 10 && lunchRoll < 0.85
      ? { out: m(12 * 60 + r.range(0.5, 5)), back: m(12 * 60 + 52 + r.range(0, 6)) } : null;
    base[id] = { arrive, leave, lunch, bagFrom: arrive, bagUntil: leave, segments: [] };
  }

  // 잠깐 다녀오기 후보를 모두 만든 뒤, 시각 순서로 한 곳 한 사람만 받아 준다.
  type Errand = { id: CoworkerId; t0: number; spot: Spot; kind: "coffee" | "water" | "restroom" | "stretch"; segments: Segment[]; busy: [number, number] };
  const candidates: Errand[] = [];
  for (const id of COWORKERS) {
    const plan = base[id];
    const r = rng(hashString(`${day0}:${id}:errand`));
    let t = m(window.start + 20) + r.range(0, 5) * MIN;
    while (t < plan.leave - 6 * MIN) {
      const roll = r.next();
      const kind = roll < 0.32 ? "coffee" : roll < 0.6 ? "water" : roll < 0.84 ? "restroom" : "stretch";
      const spot: Spot = kind === "coffee" ? "coffee" : kind === "water" ? "water" : kind === "restroom" ? "restroom" : "window";
      const linger = kind === "restroom" ? r.range(28, 50) : kind === "stretch" ? r.range(5, 8) : 0;
      const e = buildErrand(id, t, kind, linger, r.range(35, 60));
      const clash =
        (plan.lunch && e.end > plan.lunch.out - 2 * MIN && t < plan.lunch.back + 2 * MIN) ||
        t < plan.arrive + 5 * MIN;
      if (!clash) candidates.push({ id, t0: t, spot, kind, segments: e.segments, busy: e.busy });
      t += r.range(4, 9) * MIN;
    }
  }
  candidates.sort((a, b) => a.t0 - b.t0);
  const taken: Record<string, [number, number][]> = {};
  for (const c of candidates) {
    const list = (taken[c.spot] ??= []);
    if (list.some(([a, b]) => c.busy[0] < b + 3 * SEC && a < c.busy[1] + 3 * SEC)) continue;
    list.push(c.busy);
    base[c.id].segments.push(...c.segments);
  }

  for (const id of COWORKERS) {
    const plan = base[id];
    const seat = SEATS[id];
    const out = route({ seat: id }, { spot: "outside" });
    const into = [...out].reverse();
    const walkIn = pathLength(into) / WALK_SPEED * SEC;
    // 출근: 복도에서 가방을 메거나 들고 들어와 의자 옆에서 가방을 내려놓는다.
    plan.segments.push(
      { kind: "walk", t0: plan.arrive, t1: plan.arrive + walkIn, path: into, holding: { bag: "worn" }, doing: "출근(가방)" },
      { kind: "act", t0: plan.arrive + walkIn, t1: plan.arrive + walkIn + 2.2 * SEC, at: seat.stand, facing: seat.facing, pose: "packUp", holding: { bag: "carried" }, doing: "가방 내려놓기" },
    );
    plan.bagFrom = plan.arrive + walkIn + 2.2 * SEC;
    // 점심: 가방은 두고 나간다.
    for (const meal of [plan.lunch]) {
      if (!meal) continue;
      const walk = pathLength(out) / WALK_SPEED * SEC;
      plan.segments.push(
        { kind: "walk", t0: meal.out, t1: meal.out + walk, path: out, holding: {}, doing: "밥 먹으러 나감" },
        { kind: "hidden", t0: meal.out + walk, t1: meal.back, doing: "밖" },
        { kind: "walk", t0: meal.back, t1: meal.back + walk, path: into, holding: {}, doing: "밥 먹고 들어옴" },
      );
    }
    // 퇴근: 가방을 집어 들고 나간다.
    const pack = 3 * SEC;
    plan.bagUntil = plan.leave;
    plan.segments.push(
      { kind: "act", t0: plan.leave, t1: plan.leave + pack, at: seat.stand, facing: seat.facing, pose: "packUp", holding: { bag: "carried" }, doing: "짐 챙기기" },
      { kind: "walk", t0: plan.leave + pack, t1: plan.leave + pack + pathLength(out) / WALK_SPEED * SEC, path: out, holding: { bag: "worn" }, doing: "퇴근(가방)" },
    );
    plan.segments.sort((a, b) => a.t0 - b.t0);
  }
  cache.set(key, base);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return base;
}

/** 다녀오기 하나: 자리 → 그곳 → 할 일 → 자리. */
function buildErrand(id: CoworkerId, t0: number, kind: "coffee" | "water" | "restroom" | "stretch", linger: number, sipSeconds: number) {
  const spot: Spot = kind === "coffee" ? "coffee" : kind === "water" ? "water" : kind === "restroom" ? "restroom" : "window";
  const go = route({ seat: id }, { spot });
  const back = [...go].reverse();
  const walk = (pathLength(go) / WALK_SPEED) * SEC;
  const info = SPOTS[spot];
  const at = info.points[info.points.length - 1];
  const segments: Segment[] = [];
  let t = t0;
  const push = (s: Segment) => { segments.push(s); t = s.t1; };
  if (kind === "coffee") {
    // 자기 머그를 책상에서 집어 들고 가서 받아 오고, 자리에서 마신다.
    push({ kind: "walk", t0: t, t1: t + walk, path: go, holding: { cup: "mug" }, doing: "머그 들고 커피 받으러" });
    push({ kind: "act", t0: t, t1: t + 5 * SEC, at, facing: info.facing, pose: "fillCup", holding: { cup: "mug" }, doing: "커피 받기" });
    push({ kind: "walk", t0: t, t1: t + walk, path: back, holding: { cup: "mug" }, doing: "커피 들고 자리로" });
    const seat = SEATS[id];
    push({ kind: "act", t0: t, t1: t + sipSeconds * SEC, at: seat.chair, facing: seat.facing, pose: "sitMug", holding: { cup: "mug" }, doing: "자리에서 커피", seated: true });
  } else if (kind === "water") {
    push({ kind: "walk", t0: t, t1: t + walk, path: go, holding: {}, doing: "물 마시러" });
    push({ kind: "act", t0: t, t1: t + 3.5 * SEC, at, facing: info.facing, pose: "fillCup", holding: { cup: "paper" }, doing: "종이컵에 물 받기" });
    push({ kind: "act", t0: t, t1: t + 6 * SEC, at, facing: info.facing, pose: "drink", holding: { cup: "paper" }, doing: "물 마시기" });
    push({ kind: "walk", t0: t, t1: t + walk, path: back, holding: {}, doing: "자리로" });
  } else if (kind === "restroom") {
    const door = info.points[0];
    const doorWalk = (pathLength(go.slice(0, -1)) / WALK_SPEED) * SEC;
    push({ kind: "walk", t0: t, t1: t + doorWalk, path: go.slice(0, -1), holding: {}, doing: "화장실 가는 길" });
    push({ kind: "walk", t0: t, t1: t + 1.4 * SEC, path: [door, at], holding: {}, doing: "화장실 들어감" });
    push({ kind: "hidden", t0: t, t1: t + linger * SEC, doing: "화장실" });
    push({ kind: "walk", t0: t, t1: t + 1.4 * SEC, path: [at, door], holding: {}, doing: "화장실 나옴" });
    push({ kind: "walk", t0: t, t1: t + doorWalk, path: back.slice(1), holding: {}, doing: "자리로" });
  } else {
    push({ kind: "walk", t0: t, t1: t + walk, path: go, holding: {}, doing: "창가로" });
    push({ kind: "act", t0: t, t1: t + linger * SEC, at, facing: info.facing, pose: "stretch", holding: {}, doing: "기지개" });
    push({ kind: "walk", t0: t, t1: t + walk, path: back, holding: {}, doing: "자리로" });
  }
  // 한 곳을 쓰는 시간: 도착부터 떠날 때까지.
  const busy: [number, number] = [segments[0].t1, segments[segments.length - (kind === "coffee" ? 2 : 1)].t0];
  return { segments, end: t, busy };
}

// ─── 지금 모습 ───────────────────────────────────────────────

export interface CrewOptions {
  /** 지금 아침보고 중인지(view.phase.value === "morningPT"). 팀장이 회의실에 앉는다. */
  morningPT?: boolean;
  /** 지금 기획팀에 공유 중인지(view.phase.value === "sharing"). 기획자가 자리에 앉아 듣는다. */
  sharing?: boolean;
  /** 아침보고를 듣는 사람을 바꿀 때. */
  audience?: CoworkerId[];
  /** 사용자가 정한 활동 시간. */
  window?: ActivityWindow;
}

/** 일하는 중 가끔 한 모금: 5분마다 그 사람 몫의 확률로 25초 동안 머그를 든다. */
function sipping(id: SeatId, now: number): boolean {
  const bucket = Math.floor(now / (5 * MIN));
  const r = rng(hashString(`${id}:${bucket}`));
  if (r.next() > 0.45) return false;
  const start = bucket * 5 * MIN + r.range(10, 240) * SEC;
  return now >= start && now < start + 25 * SEC;
}

const SEATED_Y = 0.215;

function seatedSnapshot(id: SeatId, pose: Pose, holding: Holding, doing: string): Snapshot {
  const seat = SEATS[id];
  return { id, visible: true, position: [seat.chair[0], SEATED_Y, seat.chair[1]], heading: headingOf(seat.facing), pose, holding, doing };
}

/** 한 동료의 지금 모습과 책상 소품. */
export function coworkerAt(id: CoworkerId, now: number, options: CrewOptions = {}): { snapshot: Snapshot; desk: DeskProps } {
  const plan = dayPlans(dayStart(now), options.window)[id];
  const hidden: Snapshot = { id, visible: false, position: [0, 0, 0], heading: 0, pose: "hidden", holding: {}, doing: "없음" };
  const bagAtDesk = now >= plan.bagFrom && now < plan.bagUntil;
  const inOffice = now >= plan.arrive && now < plan.leave;

  // 아침 PT: 청중은 회의실 의자에 앉아 듣는다(출근해 있을 때만).
  const audience = options.audience ?? PT_AUDIENCE;
  if (options.morningPT && audience.includes(id) && now >= plan.bagFrom && now < plan.leave) {
    const chair = MEETING.chairs[audience.indexOf(id) % MEETING.chairs.length];
    return {
      snapshot: { id, visible: true, position: [chair.at[0], SEATED_Y, chair.at[1]], heading: headingOf(chair.facing), pose: "sitListen", holding: {}, doing: "아침 PT 듣기" },
      desk: { mugOnDesk: true, bagAtDesk, screenOn: false },
    };
  }

  // 공유 중: 기획자는 하던 일을 멈추고 자리에 앉아 내 설명을 듣는다(늦은 시각이어도 남아 있는다).
  if (options.sharing && id === "planner") {
    return { snapshot: seatedSnapshot(id, "sitListen", {}, "공유 듣기"), desk: { mugOnDesk: true, bagAtDesk: true, screenOn: true } };
  }

  const seg = plan.segments.find((s) => now >= s.t0 && now < s.t1);
  if (seg) {
    const holding = seg.kind === "hidden" ? {} : seg.holding;
    const mugOnDesk = holding.cup !== "mug";
    const desk = { mugOnDesk, bagAtDesk, screenOn: inOffice && seg.doing !== "밖" };
    if (seg.kind === "hidden") return { snapshot: { ...hidden, doing: seg.doing }, desk };
    if (seg.kind === "walk") {
      const p = along(seg.path, ((now - seg.t0) / SEC) * WALK_SPEED);
      return { snapshot: { id, visible: true, position: [p.at[0], 0, p.at[1]], heading: headingOf(p.facing), pose: "walk", holding, doing: seg.doing }, desk };
    }
    if (seg.seated) return { snapshot: seatedSnapshot(id, seg.pose, holding, seg.doing), desk };
    return { snapshot: { id, visible: true, position: [seg.at[0], 0, seg.at[1]], heading: headingOf(seg.facing), pose: seg.pose, holding, doing: seg.doing }, desk };
  }

  const outForMeal = !!plan.lunch && now >= plan.lunch.out && now < plan.lunch.back;
  if (!inOffice || outForMeal) {
    return { snapshot: hidden, desk: { mugOnDesk: true, bagAtDesk, screenOn: false } };
  }
  const sip = sipping(id, now);
  return {
    snapshot: seatedSnapshot(id, sip ? "sitMug" : "sitType", sip ? { cup: "mug" } : {}, sip ? "한 모금" : "일하는 중"),
    desk: { mugOnDesk: !sip, bagAtDesk, screenOn: true },
  };
}

// ─── 나 ─────────────────────────────────────────────────────

/** 백엔드 view.seat.kind */
export type SeatKind =
  | "beforeCheckIn" | "absentCandidate" | "seated" | "checking" | "emptyBeforeWork" | "lunch" | "away"
  | "dinner" | "unauthorizedAway" | "cameraOff" | "review" | "off" | "sharing";

/** 자리 비움 사유 → 가는 곳과 하는 일(맥 앱 AwayPlan 규칙 그대로). */
export function awayPlan(reason: string): { spot: Spot | null; pose: Pose; holding: Holding } {
  const text = reason.replace(/\s/g, "");
  const has = (words: string[]) => words.some((w) => text.includes(w));
  if (has(["화장실", "손씻", "양치", "볼일"])) return { spot: "restroom", pose: "hidden", holding: {} };
  if (has(["택배", "배달", "우편", "등기", "문앞", "손님"])) return { spot: "door", pose: "standBox", holding: { box: true } };
  if (has(["전화", "통화", "연락", "콜"])) return { spot: "window", pose: "phone", holding: {} };
  if (has(["스트레칭", "기지개", "운동", "체조", "몸풀", "허리", "산책", "바람"])) return { spot: "window", pose: "stretch", holding: {} };
  if (has(["전자레인지", "데우", "데워", "도시락", "렌지"])) return { spot: "microwave", pose: "stand", holding: {} };
  if (has(["간식", "과자", "빵", "배고", "출출", "초콜릿", "사탕", "탕비"])) return { spot: "snack", pose: "reach", holding: {} };
  if (has(["냉장고", "음료", "우유", "주스", "탄산", "콜라"])) return { spot: "fridge", pose: "drink", holding: { cup: "paper" } };
  if (has(["물", "정수기", "목말", "목이말"])) return { spot: "water", pose: "drink", holding: { cup: "paper" } };
  // 커피·차와 그 밖의 사유: 자기 머그로 커피.
  return { spot: "coffee", pose: "standMug", holding: { cup: "mug" } };
}

/** 내 모습. 서버가 준 착석 상태와 단계만 보고 정한다(규칙은 다시 계산하지 않는다). */
export function meAt(now: number, seat: { kind: SeatKind; reason?: string }, phase: string): { snapshot: Snapshot; desk: DeskProps } {
  const hidden: Snapshot = { id: "me", visible: false, position: [0, 0, 0], heading: 0, pose: "hidden", holding: {}, doing: "없음" };
  const checkedIn = !["beforeCheckIn", "absentCandidate", "off"].includes(seat.kind);
  const desk: DeskProps = { mugOnDesk: true, bagAtDesk: checkedIn, screenOn: checkedIn };
  if (phase === "sharing" && checkedIn) {
    // 기획팀 책상 앞에 서서 기획자에게 오늘 한 일을 설명한다.
    const info = SPOTS.share;
    const at = info.points[info.points.length - 1];
    return { snapshot: { id: "me", visible: true, position: [at[0], 0, at[1]], heading: headingOf(info.facing), pose: "present", holding: {}, doing: "기획팀에 공유" }, desk };
  }
  if (phase === "morningPT" && checkedIn) {
    const at = MEETING.presenter;
    return { snapshot: { id: "me", visible: true, position: [at[0], 0, at[1]], heading: headingOf(MEETING.presenterFacing), pose: "present", holding: {}, doing: "아침 PT 발표" }, desk: { ...desk, screenOn: false } };
  }
  switch (seat.kind) {
    case "beforeCheckIn":
    case "absentCandidate":
      return { snapshot: { id: "me", visible: true, position: [OUTSIDE_MAT[0], 0, OUTSIDE_MAT[1]], heading: headingOf([0, -1]), pose: "stand", holding: { bag: "worn" }, doing: "출근 전, 문 밖" }, desk };
    case "seated":
    case "checking":
    case "sharing": // 단계가 sharing이면 위에서 기획팀 앞에 세운다. 여기 오는 건 단계가 앞서 바뀐 경우뿐이라 자리에 둔다.
    case "review": {
      const sip = sipping("me", now);
      return { snapshot: seatedSnapshot("me", sip ? "sitMug" : "sitType", sip ? { cup: "mug" } : {}, "일하는 중"), desk: { ...desk, mugOnDesk: !sip } };
    }
    case "away": {
      const plan = awayPlan(seat.reason ?? "");
      if (!plan.spot || plan.pose === "hidden") return { snapshot: { ...hidden, doing: "화장실" }, desk };
      const info = SPOTS[plan.spot];
      const at = info.points[info.points.length - 1];
      return {
        snapshot: { id: "me", visible: true, position: [at[0], 0, at[1]], heading: headingOf(info.facing), pose: plan.pose, holding: plan.holding, doing: `자리 비움: ${seat.reason ?? ""}` },
        desk: { ...desk, mugOnDesk: plan.holding.cup !== "mug" },
      };
    }
    case "off":
      return { snapshot: { ...hidden, doing: "퇴근" }, desk: { mugOnDesk: true, bagAtDesk: false, screenOn: false } };
    default:
      // 점심·저녁·허용 밖 자리 비움·카메라 꺼짐·근무 전 빈자리: 빈 의자.
      return { snapshot: { ...hidden, doing: seat.kind }, desk: { ...desk, screenOn: seat.kind === "cameraOff" } };
  }
}

// ─── 출근 입장 연출 ───────────────────────────────────────────

/** 입장 연출 시간(초): 사원증 찍기 → 자동문 열림 → 걸어 들어가 자리에 앉기. */
export const ENTRANCE = { tap: 1.2, open: 0.6 } as const;

/** 단말기 앞 → 문 → 내 자리까지 걷는 길. */
export function entrancePath(): Vec2[] {
  return [OUTSIDE_MAT, [DOOR_X + 0.1, ROOM.halfDepth + 0.55], ...route({ spot: "door" }, { seat: "me" })];
}

/**
 * 출근 버튼을 누른 뒤 t초의 내 모습. 사원증을 찍고(tapBadge), 문이 열리면 걸어 들어가 자리에 앉는다.
 * done이면 연출이 끝났다(이후로는 meAt을 쓴다).
 */
export function entranceAt(t: number): { snapshot: Snapshot; doorOpen: boolean; readerFlash: number; walking: boolean; done: boolean } {
  const path = entrancePath();
  const walkFrom = ENTRANCE.tap + ENTRANCE.open;
  const walkSeconds = pathLength(path) / WALK_SPEED;
  // 카드를 대는 0.5초·0.8초 두 번에 맞춰 불이 켜진다.
  const flash = (t > 0.45 && t < 0.68) || (t > 0.75 && t < 1.05) ? 1 : 0;
  const base = { id: "me" as const, visible: true, holding: { bag: "worn" as const } };
  if (t < walkFrom) {
    return {
      snapshot: { ...base, position: [OUTSIDE_MAT[0], 0, OUTSIDE_MAT[1]], heading: headingOf([0, -1]), pose: t < ENTRANCE.tap ? "tapBadge" : "stand", doing: t < ENTRANCE.tap ? "사원증 찍기" : "문 열리는 중" },
      doorOpen: t >= ENTRANCE.tap, readerFlash: flash, walking: false, done: false,
    };
  }
  if (t < walkFrom + walkSeconds) {
    const p = along(path, (t - walkFrom) * WALK_SPEED);
    return {
      snapshot: { ...base, position: [p.at[0], 0, p.at[1]], heading: headingOf(p.facing), pose: "walk", doing: "출근해 자리로" },
      doorOpen: true, readerFlash: 0, walking: true, done: false,
    };
  }
  return { snapshot: { ...seatedSnapshot("me", "sitType", {}, "자리에 앉음") }, doorOpen: false, readerFlash: 0, walking: false, done: true };
}

// ─── 퇴근 연출 ───────────────────────────────────────────────

/** 퇴근 연출 시간(초): 짐 챙기기 → 걸어 나가기 → 문 밖에서 잠깐 뒤 마무리. */
export const LEAVING = { pack: 2.2, linger: 2.2 } as const;

/** 내 자리 → 출입문 → 문 밖. */
export function leavePath(): Vec2[] {
  return route({ seat: "me" }, { spot: "outside" });
}

/**
 * 하루 마감을 확정한 뒤(단계가 off로 바뀜) t초의 내 모습. 자리에서 짐을 챙기고(packUp, 가방을 듦),
 * 가방을 메고 출입문으로 걸어 나간다. 문 밖 끝에 닿으면 사라지고, linger초 뒤 done.
 */
export function leaveAt(t: number): { snapshot: Snapshot; phase: "pack" | "walk" | "gone"; done: boolean; bagAtDesk: boolean } {
  const path = leavePath();
  const walkSeconds = pathLength(path) / WALK_SPEED;
  const seat = SEATS.me;
  if (t < LEAVING.pack) {
    return {
      snapshot: { id: "me", visible: true, position: [seat.stand[0], 0, seat.stand[1]], heading: headingOf(seat.facing), pose: "packUp", holding: { bag: "carried" }, doing: "짐 챙기기" },
      phase: "pack", done: false, bagAtDesk: false,
    };
  }
  if (t < LEAVING.pack + walkSeconds) {
    const p = along(path, (t - LEAVING.pack) * WALK_SPEED);
    return {
      snapshot: { id: "me", visible: true, position: [p.at[0], 0, p.at[1]], heading: headingOf(p.facing), pose: "walk", holding: { bag: "worn" }, doing: "퇴근(가방)" },
      phase: "walk", done: false, bagAtDesk: false,
    };
  }
  return {
    snapshot: { id: "me", visible: false, position: [0, 0, 0], heading: 0, pose: "hidden", holding: {}, doing: "퇴근" },
    phase: "gone", done: t >= LEAVING.pack + walkSeconds + LEAVING.linger, bagAtDesk: false,
  };
}

/** 키보드·마우스 위치(Person desk prop). */
export const deskHands = (id: SeatId) => {
  const s = deskSpots(SEATS[id]);
  return { keyboard: s.keyboard, mouse: s.mouse };
};

/** 시험·디버그용: 그날 계획 요약. */
export function planSummary(id: CoworkerId, now: number, window?: ActivityWindow) {
  const p = dayPlans(dayStart(now), window)[id];
  return { arrive: p.arrive, leave: p.leave, lunch: p.lunch, segments: p.segments.length };
}

/** 같은 시각, 모두의 모습(나 포함). */
export function crewAt(now: number, me: { kind: SeatKind; reason?: string }, phase: string, window?: ActivityWindow) {
  const options: CrewOptions = { morningPT: phase === "morningPT", sharing: phase === "sharing", window };
  const result = {} as Record<SeatId, { snapshot: Snapshot; desk: DeskProps }>;
  for (const id of COWORKERS) result[id] = coworkerAt(id, now, options);
  result.me = meAt(now, me, phase);
  return result;
}

export type { Place };
