/**
 * 3D 사무실의 배치와 동선. 단위는 m, 맥 앱(SceneKit Layout)과 같은 좌표를 쓴다.
 * x: 오른쪽(+X, 창 쪽), z: 앞(+Z, 출입문 쪽), y: 위. 사람의 앞은 −Z.
 */

export type Vec2 = readonly [number, number]; // [x, z]

export const ROOM = {
  halfWidth: 7,
  halfDepth: 5,
  wallHeight: 3,
  lowWall: 1,
  thickness: 0.24,
  windowZ0: -3.15,
  windowZ1: 3.4,
  windowY0: 0.95,
  windowY1: 2.7,
  doorX0: -1.5,
  doorX1: -0.1,
  doorHeight: 2.25,
  meetingX0: -7,
  meetingX1: -2.3,
  meetingZ0: -5,
  meetingZ1: -1.2,
  /** 회의실 유리벽의 출입구(앞벽, x 범위). */
  meetingDoorX0: -3.35,
  meetingDoorX1: -2.55,
  pantryX1: -3.7,
  pantryZ0: 0.2,
  /** 탕비실 출입구(오른벽) 가운데 z. */
  pantryDoorZ: 2.85,
  restroomX0: 5,
  restroomZ1: -3.4,
  restroomX: 6,
  islandZ: 1,
  islandX: [1.9, 0.5, -0.9] as const,
  islandDeskWidth: 1.4,
  islandDeskDepth: 0.75,
  islandDeskOffset: 0.6,
  /** 책상 상판 윗면 높이. */
  deskTop: 0.76,
} as const;

export const DOOR_X = (ROOM.doorX0 + ROOM.doorX1) / 2;


/** 통로. 사람은 늘 통로를 따라 걷는다. */
export const AISLE = { front: 2.85, back: -0.85 } as const;
/** 두 통로를 잇는 세로길(섬 왼쪽, 팀장 자리 오른쪽). */
export const COLUMNS = [-2.15, 5.3] as const;

/** 자리 주인(개발팀). 타 부서 손님(AI 기획자·AI 디자이너)은 자리가 없고 공유할 때만 회의실에 온다(crew/share.ts). */
export type SeatId = "director" | "manager" | "kwajang" | "daeri" | "senior" | "peerA" | "peerB" | "me";

export interface Seat {
  /** 의자(앉은 사람) 위치. */
  chair: Vec2;
  /** 앉아서 보는 방향(단위 벡터). */
  facing: Vec2;
  /** 의자에서 책상 가운데까지. */
  deskOffset: number;
  deskWidth: number;
  deskDepth: number;
  /** 일어서서 서는 곳(의자 뒤나 옆). */
  stand: Vec2;
  /** 이어지는 통로. */
  aisle: keyof typeof AISLE;
  /** 모니터를 책상 가운데에서 옆으로 옮긴 거리(+는 앉은 사람의 오른쪽). */
  monitorShift: number;
}

const ix = ROOM.islandX;
const innerZ = ROOM.islandZ - ROOM.islandDeskDepth / 2 - ROOM.islandDeskOffset;
const outerZ = ROOM.islandZ + ROOM.islandDeskDepth / 2 + ROOM.islandDeskOffset;
const island = (x: number, inner: boolean): Seat => ({
  chair: [x, inner ? innerZ : outerZ],
  facing: [0, inner ? 1 : -1],
  deskOffset: ROOM.islandDeskOffset,
  deskWidth: ROOM.islandDeskWidth,
  deskDepth: ROOM.islandDeskDepth,
  stand: [x, inner ? innerZ - 0.5 : outerZ + 0.45],
  aisle: inner ? "back" : "front",
  monitorShift: 0,
});

export const SEATS: Record<SeatId, Seat> = {
  kwajang: island(ix[0], true),
  daeri: island(ix[1], true),
  senior: island(ix[2], true),
  peerA: island(ix[0], false),
  peerB: island(ix[1], false),
  me: island(ix[2], false),
  manager: {
    chair: [4.2, ROOM.islandZ], facing: [-1, 0], deskOffset: 0.72, deskWidth: 1.7, deskDepth: 0.85,
    stand: [4.7, ROOM.islandZ + 0.45], aisle: "front", monitorShift: 0,
  },
  director: {
    chair: [1.2, -3.9], facing: [0, 1], deskOffset: 0.72, deskWidth: 2.05, deskDepth: 0.95,
    stand: [2.65, -3.9], aisle: "back", monitorShift: 0,
  },
};

/** 앉은 사람의 오른쪽(단위 벡터). 앞이 (fx, fz)면 오른쪽은 (−fz, fx). */
export const rightOf = (f: Vec2): Vec2 => [-f[1], f[0]];

/** 좌석 기준 좌표: along(앞으로), side(오른쪽으로). */
export function seatPoint(seat: Seat, along: number, side: number): Vec2 {
  const r = rightOf(seat.facing);
  return [seat.chair[0] + seat.facing[0] * along + r[0] * side, seat.chair[1] + seat.facing[1] * along + r[1] * side];
}

/** 책상 위 소품 자리(월드 좌표 [x, y, z]). 키보드는 앞 가장자리에서 0.095 안쪽, 마우스는 키보드 +0.32. */
export function deskSpots(seat: Seat) {
  const front = seat.deskOffset - seat.deskDepth / 2;
  const y = ROOM.deskTop;
  const k = seatPoint(seat, front + 0.095, 0);
  const m = seatPoint(seat, front + 0.095, 0.32);
  const mug = seatPoint(seat, front + 0.2, 0.52);
  const bag = seatPoint(seat, 0.05, -0.5);
  return {
    // 키보드·마우스 "윗면" 높이(room/parts.tsx 모델: 키보드 0.0185, 마우스 0.032). 손이 그 위에 놓인다.
    keyboard: [k[0], y + 0.0185, k[1]] as [number, number, number],
    mouse: [m[0], y + 0.032, m[1]] as [number, number, number],
    mug: [mug[0], y, mug[1]] as [number, number, number],
    /** 책상 옆 바닥에 내려놓은 가방. */
    bag: [bag[0], 0, bag[1]] as [number, number, number],
  };
}

/** 사람이 가는 곳(자리 말고). */
export type Spot = "coffee" | "water" | "restroom" | "window" | "outside" | "meeting" | "door" | "fridge" | "microwave" | "snack";

export interface SpotInfo {
  aisle: keyof typeof AISLE;
  /** 통로에서 빠져나오는 x. */
  x: number;
  /** 통로 다음에 지나는 점들. 마지막 점에서 그 일을 한다. */
  points: Vec2[];
  /** 도착해서 보는 방향. */
  facing: Vec2;
}

const pantryEntry: Vec2[] = [[ROOM.pantryX1, AISLE.front], [-5.3, AISLE.front]];

export const SPOTS: Record<Spot, SpotInfo> = {
  coffee: { aisle: "front", x: ROOM.pantryX1, points: [...pantryEntry, [-6.05, 3.95]], facing: [-1, 0] },
  water: { aisle: "front", x: ROOM.pantryX1, points: [...pantryEntry, [-6.25, 2.75]], facing: [-1, 0] },
  fridge: { aisle: "front", x: ROOM.pantryX1, points: [...pantryEntry, [-6.1, 0.85]], facing: [-1, 0] },
  microwave: { aisle: "front", x: ROOM.pantryX1, points: [...pantryEntry, [-6.1, 1.75]], facing: [-1, 0] },
  snack: { aisle: "front", x: ROOM.pantryX1, points: [...pantryEntry, [-4.9, 1.6]], facing: [0, -1] },
  restroom: { aisle: "back", x: ROOM.restroomX, points: [[ROOM.restroomX, ROOM.restroomZ1 + 0.7], [ROOM.restroomX, ROOM.restroomZ1 - 0.8]], facing: [0, -1] },
  window: { aisle: "back", x: 6.35, points: [[6.35, -0.25]], facing: [1, 0] },
  door: { aisle: "front", x: DOOR_X, points: [[DOOR_X, ROOM.halfDepth - 1.1]], facing: [0, 1] },
  // 드나드는 동료는 문 왼쪽 반을 쓴다(출근 전 나는 문 오른쪽 사원증 단말기 앞에 서 있다).
  outside: { aisle: "front", x: DOOR_X, points: [[DOOR_X, ROOM.halfDepth - 1.1], [DOOR_X - 0.3, ROOM.halfDepth - 0.4], [DOOR_X - 0.3, ROOM.halfDepth + 1.6]], facing: [0, 1] },
  meeting: { aisle: "back", x: (ROOM.meetingDoorX0 + ROOM.meetingDoorX1) / 2, points: [[(ROOM.meetingDoorX0 + ROOM.meetingDoorX1) / 2, ROOM.meetingZ1 - 0.5]], facing: [-1, 0] },
};

/** 문 오른쪽 바깥벽의 사원증 단말기(카드 리더) 가운데 [x, y, z]. 바깥면(+Z)을 본다. 두께 0.035. */
export const BADGE_READER: [number, number, number] = [ROOM.doorX1 + 0.25, 0.7, ROOM.halfDepth + ROOM.thickness / 2 + 0.018];
/** 단말기 카드 면(앞면)의 z. */
export const BADGE_READER_FACE_Z = BADGE_READER[2] + 0.0175;
/**
 * 출근 전 내가 서서 기다리는 곳: 단말기를 보고(−Z) 선다.
 * tapBadge 손 기준점(나 원점에서 앞 0.22m·오른쪽 0.15m·높이 0.70m, f4 시험값)이 단말기 카드 면에 오도록 세운다.
 */
export const OUTSIDE_MAT: Vec2 = [BADGE_READER[0] - 0.15, BADGE_READER_FACE_Z + 0.22];

/** 회의실 탁자와 의자. */
/** 회의실 출입구 바로 안. */
export const MEETING_DOOR_IN: Vec2 = [(ROOM.meetingDoorX0 + ROOM.meetingDoorX1) / 2, ROOM.meetingZ1 - 0.5];
/** 회의실 안 탁자 앞 가로길 z(의자 줄보다 문 쪽). 사람은 여기를 따라 옆으로 간 뒤 의자·발표 자리로 들어간다. */
export const MEETING_LANE_Z = ROOM.meetingZ1 - 0.55;
/** 발표 자리로 가는 왼벽 쪽 세로길 x(탁자·의자와 떨어진 곳). */
export const MEETING_SIDE_X = -6.35;

export const MEETING = {
  /** 탁자 가운데와 크기(가로 x, 세로 z). */
  table: [-4.75, -3.3] as Vec2,
  tableSize: [2.2, 0.9] as Vec2,
  /** 아침 PT 화면(뒷벽) 가운데 x. */
  screenX: -4.75,
  /** 화면 왼쪽 옆, 발표하는 사람이 청중을 보고 서는 곳. */
  presenter: [-6.15, -4.35] as Vec2,
  presenterFacing: [0.5, 0.866] as Vec2,
  /** 듣는 사람 의자: 화면을 보는 줄 셋과 탁자 끝 하나. */
  chairs: [
    { at: [-5.6, -2.4] as Vec2, facing: [0, -1] as Vec2 },
    { at: [-4.75, -2.4] as Vec2, facing: [0, -1] as Vec2 },
    { at: [-3.9, -2.4] as Vec2, facing: [0, -1] as Vec2 },
    { at: [-3.25, -3.3] as Vec2, facing: [-1, 0] as Vec2 },
  ],
};

export type Place = { seat: SeatId } | { spot: Spot };

function exitPoints(place: Place): { aisle: keyof typeof AISLE; x: number; points: Vec2[] } {
  if ("seat" in place) {
    const s = SEATS[place.seat];
    return { aisle: s.aisle, x: s.stand[0], points: [s.stand] };
  }
  const info = SPOTS[place.spot];
  return { aisle: info.aisle, x: info.x, points: info.points };
}

/** 한 곳에서 다른 곳까지 걷는 길(첫 점은 출발 자리, 마지막 점은 도착 자리). 통로와 세로길만 쓴다. */
export function route(from: Place, to: Place): Vec2[] {
  const a = exitPoints(from);
  const b = exitPoints(to);
  const path: Vec2[] = [...[...a.points].reverse(), [a.x, AISLE[a.aisle]]];
  if (a.aisle !== b.aisle) {
    // 가까운 세로길로 통로를 바꾼다.
    const col = COLUMNS.reduce((best, c) => (Math.abs(c - a.x) + Math.abs(c - b.x) < Math.abs(best - a.x) + Math.abs(best - b.x) ? c : best));
    path.push([col, AISLE[a.aisle]], [col, AISLE[b.aisle]]);
  }
  path.push([b.x, AISLE[b.aisle]], ...b.points);
  return dedupe(path);
}

function dedupe(path: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-3) out.push(p);
  }
  return out;
}

export function pathLength(path: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return total;
}

/** 길 위에서 d만큼 간 곳과 그때 보는 방향. */
export function along(path: Vec2[], d: number): { at: Vec2; facing: Vec2 } {
  let rest = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1];
    const [x1, z1] = path[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (rest <= len || i === path.length - 1) {
      const t = len === 0 ? 1 : Math.min(1, rest / len);
      return { at: [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t], facing: len === 0 ? [0, -1] : [(x1 - x0) / len, (z1 - z0) / len] };
    }
    rest -= len;
  }
  return { at: path[path.length - 1] ?? [0, 0], facing: [0, -1] };
}

/** 보는 방향 → three.js rotation.y (사람의 앞은 −Z). */
export const headingOf = (f: Vec2) => Math.atan2(-f[0], -f[1]);

/** 사람이 걸어 다니면 안 되는 곳(벽·가구). 검사용. [x0, z0, x1, z1] */
export const BLOCKERS: { name: string; box: [number, number, number, number] }[] = [
  { name: "섬 책상", box: [ix[2] - ROOM.islandDeskWidth / 2, ROOM.islandZ - ROOM.islandDeskDepth, ix[0] + ROOM.islandDeskWidth / 2, ROOM.islandZ + ROOM.islandDeskDepth] },
  { name: "팀장 책상", box: [4.2 - 0.72 - 0.43, ROOM.islandZ - 0.85, 4.2 - 0.72 + 0.43, ROOM.islandZ + 0.85] },
  { name: "부장 책상", box: [1.2 - 1.03, -3.9 + 0.72 - 0.48, 1.2 + 1.03, -3.9 + 0.72 + 0.48] },
  { name: "회의실 앞 유리벽(왼쪽)", box: [ROOM.meetingX0, ROOM.meetingZ1 - 0.05, ROOM.meetingDoorX0, ROOM.meetingZ1 + 0.05] },
  { name: "회의실 오른 유리벽", box: [ROOM.meetingX1 - 0.05, ROOM.meetingZ0, ROOM.meetingX1 + 0.05, ROOM.meetingZ1] },
  { name: "탕비실 오른벽(뒤)", box: [ROOM.pantryX1 - 0.05, ROOM.pantryZ0, ROOM.pantryX1 + 0.05, ROOM.pantryDoorZ - 0.55] },
  { name: "탕비실 오른벽(앞)", box: [ROOM.pantryX1 - 0.05, ROOM.pantryDoorZ + 0.55, ROOM.pantryX1 + 0.05, ROOM.halfDepth] },
  { name: "탕비실 뒷벽", box: [-ROOM.halfWidth, ROOM.pantryZ0 - 0.05, ROOM.pantryX1, ROOM.pantryZ0 + 0.05] },
  { name: "화장실 왼벽", box: [ROOM.restroomX0 - 0.06, -ROOM.halfDepth, ROOM.restroomX0 + 0.06, ROOM.restroomZ1] },
  { name: "화장실 앞벽(왼쪽)", box: [ROOM.restroomX0, ROOM.restroomZ1 - 0.06, ROOM.restroomX - 0.5, ROOM.restroomZ1 + 0.06] },
  { name: "화장실 앞벽(오른쪽)", box: [ROOM.restroomX + 0.5, ROOM.restroomZ1 - 0.06, ROOM.halfWidth, ROOM.restroomZ1 + 0.06] },
  { name: "앞벽(문 왼쪽)", box: [-ROOM.halfWidth, ROOM.halfDepth - 0.12, ROOM.doorX0, ROOM.halfDepth + 0.12] },
  { name: "앞벽(문 오른쪽)", box: [ROOM.doorX1, ROOM.halfDepth - 0.12, ROOM.halfWidth, ROOM.halfDepth + 0.12] },
];

// ─── 바닥에 놓인 화분·나무(사람이 지나가지 않는 곳) ──────────────────────

/**
 * 화분 잎이 퍼지는 가로 반지름. room/parts.tsx의 Plant 모양과 같은 식:
 * 잎 덩어리 중심이 lean만큼 바깥에 있고, 잎(반지름 r, 세로 1.6배)이 최대 0.4rad 기울어 r·(1 + 1.6·sin0.4) ≈ 1.62r 만큼 더 나간다.
 */
export function plantRadius(height: number, scale = 1) {
  const lean = 0.22;
  const r = 0.16 * height;
  return (lean + r * 1.62) * scale;
}

/** 둥근 나무(room/Room.tsx RoundTree)의 잎 덩어리 가로 반지름. */
export const ROUND_TREE_RADIUS = 0.2 + 0.27;

export interface Decor { name: string; kind: "plant" | "tree"; at: Vec2; height: number; scale: number; radius: number }

const plant = (name: string, at: Vec2, height: number, scale = 1): Decor => ({ name, kind: "plant", at, height, scale, radius: plantRadius(height, scale) });

/** 바닥 화분·나무. Room이 이 목록대로 놓고, 시험이 벽·가구·자리·걷는 길과 겹치지 않는지 본다. */
export const DECOR: Decor[] = [
  plant("앞 오른쪽 모서리 큰 화분(맥 앱 자리)", [6.25, 4.25], 1.25),
  plant("뒷벽 화분(화장실 옆)", [4.3, -4.35], 1.0),
  plant("탕비실 앞 모서리 화분", [-4.25, 4.4], 0.8),
  { name: "탕비실 출입구 옆 둥근 나무", kind: "tree", at: [-2.6, 4.3], height: 1.3, scale: 1, radius: ROUND_TREE_RADIUS },
];

/** 바깥벽 안쪽 면(사람·가구가 넘으면 안 되는 선). [x0, z0, x1, z1] */
export const INTERIOR: [number, number, number, number] = [
  -ROOM.halfWidth + ROOM.thickness / 2, -ROOM.halfDepth + ROOM.thickness / 2,
  ROOM.halfWidth - ROOM.thickness / 2, ROOM.halfDepth - ROOM.thickness / 2,
];

/** 회의실 출입구 → 의자(의자 줄 앞 가로길을 따라 옆으로 간 뒤 의자로). */
export function meetingSeatPath(chair: Vec2): Vec2[] {
  return [MEETING_DOOR_IN, [chair[0], MEETING_LANE_Z], chair];
}

/** 회의실 출입구 → 발표 자리(왼벽 쪽으로 돌아 탁자를 피해 화면 옆으로). */
export function presenterPath(): Vec2[] {
  return [MEETING_DOOR_IN, [MEETING_SIDE_X, MEETING_LANE_Z], [MEETING_SIDE_X, MEETING.presenter[1]], MEETING.presenter];
}

/** 회의실 탁자(걷는 길 검사용). */
export const MEETING_TABLE_BOX: [number, number, number, number] = [
  MEETING.table[0] - MEETING.tableSize[0] / 2, MEETING.table[1] - MEETING.tableSize[1] / 2,
  MEETING.table[0] + MEETING.tableSize[0] / 2, MEETING.table[1] + MEETING.tableSize[1] / 2,
];
