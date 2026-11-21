/**
 * 자세 계산. three.js를 쓰지 않는 순수 함수라 시험으로 확인한다.
 *
 * 좌표: 원점은 두 발 사이 바닥, 앞은 −Z, 위는 +Y, 오른쪽(+X)이 그 사람의 오른손 쪽. 단위는 미터(키 약 1.1).
 * 맥 앱(SceneKit) Person의 치수와 동작 수치를 시작값으로 썼다.
 */

export type Pose =
  | "hidden"
  /** 서서 쉰다. */
  | "stand"
  /** 걷는다. 다리 박자는 실제 이동 속도로 맞춘다. */
  | "walk"
  /** 앉아서 타자. 양손 타자와 오른손 마우스를 번갈아 한다. */
  | "sitType"
  /** 앉아서 오른손에 머그를 들고 왼손으로 타자, 가끔 마신다. */
  | "sitMug"
  /** 회의 자리에 앉아 듣는다. 가끔 끄덕인다. */
  | "sitListen"
  /** 걸상에 앉아 간식을 먹는다. */
  | "sitEat"
  /** 앉아서 받은 서류를 읽는다(상사). */
  | "sitReview"
  /** 앉아서 손짓하며 설명한다(상사). */
  | "sitExplain"
  /** 정수기·커피 기계 앞에서 컵을 받친다(왼손으로 버튼). */
  | "fillCup"
  /** 서서 컵으로 마신다. */
  | "drink"
  /** 서서 머그를 들고 가끔 마신다. */
  | "standMug"
  /** 책상 앞에 서서 짐을 챙긴다. */
  | "packUp"
  /** 고개 숙여 인사한다. */
  | "bow"
  /** 기지개를 켠다. */
  | "stretch"
  /** 전화 통화. */
  | "phone"
  /** 서서 발표한다. */
  | "present"
  /** 손을 흔든다. */
  | "wave"
  /** 서서 끄덕이며 듣는다. */
  | "nod"
  /** 손을 앞으로 뻗는다(냉장고 문, 간식 고르기). */
  | "reach"
  /** 서류를 가슴께에 들고 선다. */
  | "holdPaper"
  /** 서류를 두 손으로 내민다. */
  | "offerPaper"
  /** 상자를 든다. */
  | "standBox"
  /** 상자를 내민다. */
  | "offerBox"
  /** 출입문 옆 단말기에 사원증을 찍는다(사람 앞 0.22m·오른쪽 0.15m·높이 0.7m에 두 번 톡). 팔이 짧아 더 멀면 닿지 않는다. */
  | "tapBadge";

export const SEATED_POSES: readonly Pose[] = ["sitType", "sitMug", "sitListen", "sitEat", "sitReview", "sitExplain"];

export type Holding = {
  cup?: "mug" | "paper" | null;
  bag?: "worn" | "carried" | null;
  box?: boolean;
  paper?: boolean;
};

export type Vec3 = readonly [number, number, number];

// 치수(맥 앱과 같다)
export const HIP_HEIGHT = 0.27;
export const SHOULDER_Y = 0.3;
export const SHOULDER_X = 0.118;
export const ARM_LENGTH = 0.235;
export const LEG_LENGTH = 0.25;
export const HEAD_R = 0.2;
/** 앉았을 때 원점 높이. 의자 좌판 윗면 0.47에 엉덩이가 온다. */
export const SEATED_ROOT_Y = 0.47 - HIP_HEIGHT + 0.015;
/** 손 공의 반지름만큼 손 가운데를 물건 윗면 위로 띄운다. */
export const HAND_ABOVE_SURFACE = 0.042;
/** 걸음 한 번(두 발)에 나아가는 거리. 맥 앱 0.64초 × 0.85m/s. */
export const STRIDE = 0.544;

/** 팔 하나의 각도. 매달린 팔을 앞(pitch)·안쪽 방향(yaw)·옆(roll)으로 돌린다. */
export interface Arm {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface Body {
  left: Arm;
  right: Arm;
  /** 어깨에서 손 가운데까지 거리. 손이 소매에서 조금 나오거나 들어가며 목표에 정확히 닿게 한다. */
  reachL: number;
  reachR: number;
  legL: number;
  legR: number;
  torsoPitch: number;
  headPitch: number;
  headYaw: number;
  bounce: number;
  hipRoll: number;
}

export interface Face {
  /** 0이면 눈을 뜨고 1이면 감는다. */
  blink: number;
  /** 입 벌림(0~1). */
  mouthOpen: number;
  /** 웃을 때 입이 옆으로 벌어지는 정도(0~1). */
  smile: number;
  /** 눈썹 올림(미터). */
  browLift: number;
}

export interface PoseContext {
  rate: number;
  phase: number;
  holding: Holding;
  /** 키보드 윗면 가운데와 마우스 윗면(사람 좌표). 앉아 타자일 때 손을 얹는다. */
  desk?: { keyboard: Vec3; mouse: Vec3 } | null;
  /** 걸음 위상(라디안)과 세기(0~1.2). 실제 이동 속도에서 나온다. */
  gait: { cycle: number; amount: number };
  /** 한 손에 드는 가방(토트·서류가방)을 들었는지. */
  carriesHandBag: boolean;
  /** 지금 자세가 시작된 뒤 지난 초. */
  sincePoseStart: number;
}

const arm = (pitch: number, yaw: number, roll: number): Arm => ({ pitch, yaw, roll });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);
/** 0~1 사이 고르게 흩어진 값. 같은 입력이면 늘 같다. */
const hash = (x: number) => fract(Math.sin(x * 12.9898 + 78.233) * 43758.5453);

export function mixArm(a: Arm, b: Arm, t: number): Arm {
  return { pitch: lerp(a.pitch, b.pitch, t), yaw: lerp(a.yaw, b.yaw, t), roll: lerp(a.roll, b.roll, t) };
}

export function mixBody(a: Body, b: Body, t: number): Body {
  return {
    left: mixArm(a.left, b.left, t),
    right: mixArm(a.right, b.right, t),
    reachL: lerp(a.reachL, b.reachL, t),
    reachR: lerp(a.reachR, b.reachR, t),
    legL: lerp(a.legL, b.legL, t),
    legR: lerp(a.legR, b.legR, t),
    torsoPitch: lerp(a.torsoPitch, b.torsoPitch, t),
    headPitch: lerp(a.headPitch, b.headPitch, t),
    headYaw: lerp(a.headYaw, b.headYaw, t),
    bounce: lerp(a.bounce, b.bounce, t),
    hipRoll: lerp(a.hipRoll, b.hipRoll, t),
  };
}

// MARK: - 팔 방향 계산

/** 팔 각도 → 어깨에서 본 손 방향(엉덩이 좌표). 회전 순서는 Ry(−yaw)·Rx(pitch)·Rz(roll)을 (0,−1,0)에 건다. */
export function armDirection(a: Arm): [number, number, number] {
  // Rz(roll)·(0,−1,0) = (sin r, −cos r, 0)
  const x0 = Math.sin(a.roll), y0 = -Math.cos(a.roll), z0 = 0;
  // Rx(pitch)
  const cp = Math.cos(a.pitch), sp = Math.sin(a.pitch);
  const x1 = x0, y1 = y0 * cp - z0 * sp, z1 = y0 * sp + z0 * cp;
  // Ry(−yaw)
  const cy = Math.cos(-a.yaw), sy = Math.sin(-a.yaw);
  return [x1 * cy + z1 * sy, y1, -x1 * sy + z1 * cy];
}

/** 어깨 위치(사람 좌표). 몸을 숙이면(torsoPitch < 0) 어깨가 앞으로 나간다. */
export function shoulderAt(side: -1 | 1, torsoPitch: number, bounce = 0): [number, number, number] {
  const c = Math.cos(torsoPitch), s = Math.sin(torsoPitch);
  return [side * SHOULDER_X, HIP_HEIGHT + bounce + SHOULDER_Y * c, SHOULDER_Y * s];
}

/** 손 가운데가 사람 좌표의 점에 닿는 팔 각도와 어깨-손 거리. */
export function reach(target: Vec3, side: -1 | 1, torsoPitch: number): { arm: Arm; length: number } {
  const [sx, sy, sz] = shoulderAt(side, torsoPitch);
  const dx = target[0] - sx, dy = target[1] - sy, dz = target[2] - sz;
  // 엉덩이 좌표로 되돌린다(Rx(−torsoPitch)).
  const c = Math.cos(-torsoPitch), s = Math.sin(-torsoPitch);
  const hx = dx, hy = dy * c - dz * s, hz = dy * s + dz * c;
  const length = Math.hypot(hx, hy, hz);
  const pitch = Math.acos(Math.max(-1, Math.min(1, -hy / length)));
  const yaw = Math.atan2(hx, -hz);
  return { arm: { pitch, yaw, roll: 0 }, length };
}

/** 손이 소매에서 빠지거나 파묻히지 않는 거리 범위. */
export const REACH_MIN = 0.2;
export const REACH_MAX = 0.272;
const clampReach = (x: number) => Math.min(REACH_MAX, Math.max(REACH_MIN, x));

/** 팔 각도와 거리로 손 가운데 위치(사람 좌표)를 구한다. 시험과 소품 배치에 쓴다. */
export function handAt(a: Arm, side: -1 | 1, torsoPitch: number, length = ARM_LENGTH): [number, number, number] {
  const [sx, sy, sz] = shoulderAt(side, torsoPitch);
  const [hx, hy, hz] = armDirection(a);
  const c = Math.cos(torsoPitch), s = Math.sin(torsoPitch);
  const wx = hx, wy = hy * c - hz * s, wz = hy * s + hz * c;
  return [sx + wx * length, sy + wy * length, sz + wz * length];
}

// MARK: - 타자

/**
 * 타자 치는 동안 오른손이 어디 있는지(0이면 키보드, 1이면 마우스).
 * 사람마다 주기(13~18초)와 시작점이 달라 다 같이 마우스를 잡지 않는다.
 */
export function mouseShare(t: number, phase: number): number {
  const period = 13 + 5 * fract(phase * 0.37 + 0.11);
  const f = fract((t + phase * 3.1) / period);
  // 0~0.5 양손 타자, 0.5~0.56 마우스로, 0.56~0.86 마우스, 0.86~0.92 키보드로.
  return smoothstep(0.5, 0.56, f) * (1 - smoothstep(0.86, 0.92, f));
}

function typingBody(t: number, ctx: PoseContext, mug: boolean): Body {
  const desk = ctx.desk;
  const torsoPitch = -0.2;
  // 몇 초마다 잠깐 멈춰 화면을 읽는다.
  const typing = Math.sin(t * 0.83 + ctx.phase) + Math.sin(t * 0.31 + 1.3 + ctx.phase) > 1.25 ? 0 : 1;
  const tapL = typing * Math.pow(Math.abs(Math.sin((t * 2 * Math.PI) / 0.34)), 3);
  const tapR = typing * Math.pow(Math.abs(Math.sin((t * 2 * Math.PI) / 0.29 + 1.1)), 3);
  const base: Body = {
    left: arm(1.72 - 0.09 * tapL, -0.3, -0.05),
    right: arm(1.72 - 0.09 * tapR, 0.3, 0.05),
    reachL: ARM_LENGTH,
    reachR: ARM_LENGTH,
    legL: Math.PI / 2 - 0.05,
    legR: Math.PI / 2 + 0.03,
    torsoPitch,
    headPitch: -0.04,
    headYaw: 0,
    bounce: 0,
    hipRoll: 0,
  };
  if (desk) {
    const [kx, ky, kz] = desk.keyboard;
    const lift = HAND_ABOVE_SURFACE;
    // 왼손: 키보드 왼쪽 절반 위. 칠 때 1.5cm쯤 들렸다 내려온다. 손이 조금씩 옆으로 옮겨 다닌다.
    const driftL = 0.012 * Math.sin(t * 0.7 + ctx.phase);
    const share = mug ? 0 : mouseShare(t, ctx.phase);
    const left = reach([kx - 0.085 + driftL, ky + lift + 0.015 * tapL * (1 - 0.6 * share), kz + 0.005], -1, torsoPitch);
    base.left = left.arm;
    base.reachL = clampReach(left.length);
    if (!mug) {
      const driftR = 0.012 * Math.sin(t * 0.9 + 1.7 + ctx.phase);
      const onKeys: [number, number, number] = [kx + 0.085 + driftR, ky + lift + 0.015 * tapR, kz + 0.005];
      // 마우스: 손을 얹고 조금씩 움직이며, 가끔 딸깍(손이 4mm 내려간다).
      const [mx, my, mz] = desk.mouse;
      const click = Math.pow(Math.max(0, Math.sin(t * 2 * Math.PI / 1.7 + ctx.phase)), 12);
      const onMouse: [number, number, number] = [
        mx + 0.012 * Math.sin(t * 1.3 + ctx.phase),
        my + lift - 0.004 * click,
        mz + 0.01 * Math.sin(t * 0.9 + 0.4),
      ];
      // 옮겨 가는 동안은 손을 살짝 들어 키보드 모서리를 넘는다.
      const arc = 0.03 * Math.sin(Math.PI * share);
      const target: Vec3 = [
        lerp(onKeys[0], onMouse[0], share),
        lerp(onKeys[1], onMouse[1], share) + arc,
        lerp(onKeys[2], onMouse[2], share),
      ];
      const right = reach(target, 1, torsoPitch);
      base.right = right.arm;
      base.reachR = clampReach(right.length);
      // 마우스를 쓸 때는 고개를 조금 기울여 화면을 본다.
      base.headYaw += -0.04 * share;
    }
  }
  if (mug) {
    // 오른손은 가슴께에서 머그를 들고 있다가 9초마다 마신다.
    const cycle = fract((t + ctx.phase) / 9) * 9;
    const sip = smoothstep(4, 4.5, cycle) * (1 - smoothstep(6.2, 6.7, cycle));
    // 쉴 때는 상판 위 키보드 오른쪽 앞에 머그를 받치고, 마실 때는 입 앞(머리 가운데 0.8에서 7cm 아래)으로 올린다.
    // 각도로만 정하면 손이 상판 밑으로 들어가서, 책상 높이를 기준으로 목표점을 잡는다.
    const surface = desk ? desk.keyboard[1] : 0.59;
    const front = desk ? desk.keyboard[2] : -0.27;
    const rest: Vec3 = [0.17, surface + 0.075, front + 0.06];
    const mouth: Vec3 = [0.07, 0.69, -0.2];
    const target: Vec3 = [lerp(rest[0], mouth[0], sip), lerp(rest[1], mouth[1], sip) + 0.04 * Math.sin(Math.PI * sip), lerp(rest[2], mouth[2], sip)];
    const right = reach(target, 1, torsoPitch);
    base.right = right.arm;
    base.reachR = clampReach(right.length);
    base.headPitch += 0.14 * sip;
  }
  return base;
}

// MARK: - 몸

/** 서 있을 때 몇 초마다 다른 곳을 잠깐 본다. */
function glance(t: number, phase: number, size: number): number {
  const length = 4.7 + 2.3 * fract(phase * 0.71);
  const k = Math.floor((t + phase) / length);
  const f = fract((t + phase) / length);
  const before = (hash(k - 1 + phase) * 2 - 1) * size;
  const now = (hash(k + phase) * 2 - 1) * size;
  return lerp(before, now, smoothstep(0, 0.12, f));
}

export function bodyFor(pose: Pose, t: number, ctx: PoseContext): Body {
  const tt = t * ctx.rate + ctx.phase;
  const b: Body = {
    left: arm(0.12, 0, -0.12),
    right: arm(0.12, 0, 0.12),
    reachL: ARM_LENGTH,
    reachR: ARM_LENGTH,
    legL: 0,
    legR: 0,
    torsoPitch: 0,
    headPitch: 0.16 + 0.035 * Math.sin((tt * 2 * Math.PI) / 6.3 + 0.7),
    headYaw: 0.05 * Math.sin((tt * 2 * Math.PI) / 11),
    bounce: 0,
    hipRoll: 0,
  };
  const sitLegs = () => {
    b.legL = Math.PI / 2 - 0.04;
    b.legR = Math.PI / 2 + 0.02;
  };
  const bagDown = () => {
    // 한 손에 든 가방: 팔을 내리고 몸에서 조금 벌린다(가방이 다리에 닿지 않게).
    b.right = arm(0.04, 0, 0.27);
  };

  switch (pose) {
    case "hidden":
      return b;
    case "stand": {
      // 무게를 양발로 천천히 옮기고, 가끔 다른 곳을 본다.
      b.hipRoll = 0.022 * Math.sin((tt * 2 * Math.PI) / 7.1);
      b.headYaw += glance(tt, ctx.phase, 0.32);
      if (ctx.carriesHandBag) bagDown();
      if (ctx.holding.paper) b.right = arm(1.0, 0.35, 0.05);
      if (ctx.holding.box) {
        b.left = arm(1.05, -0.45, 0);
        b.right = arm(1.05, 0.45, 0);
      }
      break;
    }
    case "standMug": {
      const cycle = fract(tt / 7) * 7;
      const lift = 0.35 + 0.65 * smoothstep(3, 3.45, cycle) * (1 - smoothstep(5, 5.45, cycle));
      b.right = arm(0.9 + 1.35 * lift, 0.55, 0.05);
      b.headPitch += 0.1 * lift;
      b.hipRoll = 0.02 * Math.sin((tt * 2 * Math.PI) / 7.1);
      break;
    }
    case "wave": {
      b.right = arm(0.1, 0, 2.55 + 0.28 * Math.sin((tt * 2 * Math.PI) / 0.55));
      b.headYaw += 0.12;
      break;
    }
    case "sitType":
    case "sitMug": {
      const typed = typingBody(tt, ctx, pose === "sitMug");
      typed.headPitch += b.headPitch - 0.16 + 0.12;
      typed.headYaw += b.headYaw * 0.6;
      return typed;
    }
    case "sitListen": {
      b.torsoPitch = -0.04;
      sitLegs();
      b.left = arm(1.0, -0.38, -0.05);
      b.right = arm(1.0, 0.38, 0.05);
      const cycle = fract(tt / 9) * 9;
      const nod = cycle < 1.2 ? Math.sin((cycle / 1.2) * 2 * Math.PI * 2) : 0;
      b.headPitch += 0.1 * Math.max(0, nod) - 0.05;
      b.headYaw += glance(tt, ctx.phase, 0.18);
      break;
    }
    case "present": {
      const talk = Math.sin((tt * 2 * Math.PI) / 2.3);
      b.right = arm(1.15 + 0.3 * talk, 0.15, 0.35 + 0.1 * Math.sin((tt * 2 * Math.PI) / 3.1));
      b.left = arm(0.35 + 0.15 * Math.max(0, -talk), -0.1, -0.18);
      b.headYaw += 0.28 * Math.sin((tt * 2 * Math.PI) / 5.5);
      b.bounce = 0.006 * Math.sin((tt * 2 * Math.PI) / 1.15);
      break;
    }
    case "phone": {
      b.left = arm(0.35, 0, -2.55);
      b.right = arm(0.25, 0.2, 0.15);
      b.headYaw += 0.15 * Math.sin((tt * 2 * Math.PI) / 4.2);
      b.hipRoll = 0.03 * Math.sin((tt * 2 * Math.PI) / 3.3);
      break;
    }
    case "stretch": {
      const reachUp = 0.18 * Math.sin((tt * 2 * Math.PI) / 2.8);
      b.left = arm(0.1, 0, -2.85 - reachUp);
      b.right = arm(0.1, 0, 2.85 + reachUp);
      b.headPitch += 0.12;
      b.hipRoll = 0.09 * Math.sin((tt * 2 * Math.PI) / 5.6);
      break;
    }
    case "standBox":
      b.left = arm(1.05, -0.45, 0);
      b.right = arm(1.05, 0.45, 0);
      b.headPitch -= 0.04;
      break;
    case "offerBox":
      b.left = arm(1.35, -0.45, 0);
      b.right = arm(1.35, 0.45, 0);
      break;
    case "fillCup": {
      b.right = arm(1.2, 0.2, 0.05);
      const press = Math.pow(Math.max(0, Math.sin((tt * 2 * Math.PI) / 1.6)), 4);
      b.left = arm(1.45 + 0.12 * press, -0.05, -0.05);
      b.headPitch -= 0.14;
      b.torsoPitch = -0.05;
      break;
    }
    case "drink": {
      const cycle = fract(tt / 6) * 6;
      const sip = smoothstep(1.5, 2.0, cycle) * (1 - smoothstep(3.2, 3.7, cycle));
      b.right = mixArm(arm(1.05, 0.35, 0.05), arm(2.3, 0.6, 0.05), sip);
      b.left = arm(0.2, 0, -0.14);
      b.headPitch += 0.2 * sip;
      break;
    }
    case "sitEat": {
      b.torsoPitch = -0.06;
      sitLegs();
      b.left = arm(1.05, -0.4, -0.05);
      const cycle = fract(tt / 5) * 5;
      const bite = smoothstep(0.6, 1.0, cycle) * (1 - smoothstep(1.4, 1.8, cycle));
      b.right = mixArm(arm(1.05, 0.35, 0.05), arm(2.25, 0.62, 0.05), bite);
      const chew = cycle > 1.6 && cycle < 3.6 ? 0.025 * Math.sin(cycle * 2 * Math.PI * 2.2) : 0;
      b.headPitch += chew + 0.06 * bite - 0.03;
      break;
    }
    case "reach":
      b.right = arm(1.4 + 0.08 * Math.sin((tt * 2 * Math.PI) / 1.9), 0.1, 0.1);
      b.left = arm(0.25, 0, -0.14);
      b.headPitch -= 0.06;
      b.torsoPitch = -0.08;
      break;
    case "packUp": {
      const shuffle = Math.sin((tt * 2 * Math.PI) / 1.3);
      b.right = arm(1.0 + 0.25 * shuffle, 0.3, 0.05);
      b.left = arm(1.0 - 0.25 * shuffle, -0.3, -0.05);
      b.headPitch -= 0.18;
      b.torsoPitch = -0.12;
      break;
    }
    case "bow": {
      // 0.4초에 숙이고 0.8초 머문 뒤 천천히 든다. 계속 bow면 다시 숙이지 않고 선 채로 있는다.
      const s = ctx.sincePoseStart;
      const down = smoothstep(0, 0.4, s) * (1 - smoothstep(1.2, 1.7, s));
      b.torsoPitch = -0.42 * down;
      b.headPitch -= 0.12 * down;
      b.left = arm(0.15, 0, -0.08);
      b.right = arm(0.15, 0, 0.08);
      break;
    }
    case "tapBadge": {
      // 0.35초에 카드를 들어 단말기에 대고, 0.5초와 0.8초에 두 번 톡 댄 뒤 1.2초부터 내린다.
      const s = ctx.sincePoseStart;
      const up = smoothstep(0, 0.35, s) * (1 - smoothstep(1.2, 1.5, s));
      const tap = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (s - 0.4) / 0.2)))) + Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (s - 0.7) / 0.2))));
      const reader: Vec3 = [0.15, 0.7, -0.22 + 0.02 * Math.min(1, tap)];
      const rest: Vec3 = [0.16, 0.36, -0.04];
      const target: Vec3 = [lerp(rest[0], reader[0], up), lerp(rest[1], reader[1], up), lerp(rest[2], reader[2], up)];
      const right = reach(target, 1, 0);
      b.right = right.arm;
      b.reachR = clampReach(right.length);
      b.headPitch -= 0.12 * up;
      b.headYaw -= 0.18 * up;
      break;
    }
    case "holdPaper":
      b.right = arm(1.0, 0.35, 0.05);
      b.left = arm(0.75, -0.3, -0.05);
      b.headPitch -= 0.05;
      b.headYaw += glance(tt, ctx.phase, 0.15);
      break;
    case "offerPaper":
      b.right = arm(1.4, 0.15, 0.05);
      b.left = arm(1.25, -0.2, -0.05);
      b.torsoPitch = -0.14;
      b.headPitch -= 0.06;
      break;
    case "nod": {
      b.right = arm(0.55, 0.5, 0.05);
      b.left = arm(0.55, -0.5, -0.05);
      const beat = fract(tt / 1.4);
      b.headPitch -= 0.14 * Math.max(0, Math.sin(beat * Math.PI * 2)) + 0.04;
      break;
    }
    case "sitReview":
    case "sitExplain": {
      b.torsoPitch = -0.06;
      sitLegs();
      if (pose === "sitReview") {
        const f = fract(tt / 3.1);
        const flip = smoothstep(0, 0.3, f) * (1 - smoothstep(0.3, 0.6, f));
        b.right = arm(1.45, 0.3, 0.05);
        b.left = arm(1.2 + 0.25 * flip, -0.25, -0.05);
        b.headPitch -= 0.1;
      } else {
        const talk = Math.sin((tt * 2 * Math.PI) / 1.7);
        b.right = arm(1.0 + 0.25 * talk, 0.15, 0.35 + 0.1 * Math.sin((tt * 2 * Math.PI) / 2.3));
        b.left = arm(1.15, -0.3, -0.05);
        b.headYaw += 0.12 * Math.sin((tt * 2 * Math.PI) / 4.1);
        b.headPitch += 0.03;
      }
      break;
    }
    case "walk": {
      // 다리 박자는 실제로 나아간 거리로 센다. 천천히 걸으면 보폭과 팔 흔들림도 작아진다.
      const amount = ctx.gait.amount;
      const swing = Math.sin(ctx.gait.cycle);
      b.legL = 0.5 * swing * amount;
      b.legR = -0.5 * swing * amount;
      b.left = arm(-0.4 * swing * amount + 0.1, 0, -0.16);
      b.right = arm(0.4 * swing * amount + 0.1, 0, 0.16);
      // 발이 땅을 디딜 때 가장 낮고, 다리가 모일 때 가장 높다.
      b.bounce = 0.04 * amount * Math.abs(Math.sin(ctx.gait.cycle));
      b.torsoPitch = -0.05 * Math.min(1, amount);
      b.hipRoll = 0.04 * swing * amount;
      b.headPitch -= 0.04 * Math.abs(Math.cos(ctx.gait.cycle)) * amount;
      if (ctx.holding.box) {
        b.left = arm(1.05, -0.45, 0);
        b.right = arm(1.05, 0.45, 0);
      } else if (ctx.holding.paper) {
        b.right = arm(1.0, 0.35, 0.05);
      } else if (ctx.holding.cup) {
        b.right = arm(1.0, 0.4, 0.05);
      } else if (ctx.carriesHandBag) {
        // 가방 든 손은 크게 흔들지 않는다. 가방이 무게만큼 조금 흔들린다.
        b.right = arm(0.04 + 0.08 * swing * amount, 0, 0.27);
      }
      break;
    }
  }
  return b;
}

// MARK: - 얼굴

/** 눈 깜빡임. 3.6~5.4초마다, 세 번에 한 번은 두 번 연달아. */
export function blinkAt(t: number, phase: number): number {
  const period = 3.6 + 1.8 * fract(phase * 0.618 + 0.3);
  const k = Math.floor((t + phase) / period);
  const local = fract((t + phase) / period) * period;
  const one = (start: number) => (local >= start && local < start + 0.15 ? Math.sin((Math.PI * (local - start)) / 0.15) : 0);
  return Math.max(one(0), hash(k + phase) < 0.33 ? one(0.27) : 0);
}

export function faceFor(pose: Pose, t: number, ctx: Pick<PoseContext, "rate" | "phase" | "sincePoseStart">): Face {
  const tt = t * ctx.rate + ctx.phase;
  const face: Face = { blink: blinkAt(t, ctx.phase), mouthOpen: 0, smile: 0, browLift: 0 };
  const talk = (gap: number) => {
    // 말하는 동안 입이 열렸다 닫히고, 몇 초마다 숨을 고른다.
    const speaking = Math.sin(tt * 1.1) + Math.sin(tt * 0.43 + 1) > gap ? 1 : 0;
    face.mouthOpen = speaking * (0.35 + 0.65 * Math.abs(Math.sin((tt * 2 * Math.PI) / 0.27)));
  };
  switch (pose) {
    case "present":
      talk(-0.8);
      face.browLift = 0.006;
      break;
    case "sitExplain":
    case "phone":
      talk(-0.4);
      break;
    case "sitEat": {
      const cycle = fract(tt / 5) * 5;
      face.mouthOpen = cycle > 0.8 && cycle < 1.3 ? 0.8 : cycle > 1.6 && cycle < 3.6 ? 0.25 * Math.abs(Math.sin(cycle * Math.PI * 2.2)) : 0;
      break;
    }
    case "wave":
      face.smile = 1;
      face.mouthOpen = 0.45;
      face.browLift = 0.007;
      break;
    case "bow":
      face.smile = 0.7;
      face.blink = Math.max(face.blink, smoothstep(0.1, 0.35, ctx.sincePoseStart) * (1 - smoothstep(1.1, 1.4, ctx.sincePoseStart)));
      break;
    case "nod":
    case "offerPaper":
    case "offerBox":
    case "tapBadge":
      face.smile = 0.5;
      break;
    case "stretch":
      face.blink = 0.85;
      face.mouthOpen = 0.6 + 0.3 * Math.sin((tt * 2 * Math.PI) / 2.8);
      break;
    case "sitReview":
      face.browLift = -0.004;
      break;
    default:
      break;
  }
  return face;
}

/** 손에 든 머그가 보이는지. */
export function mugInHand(pose: Pose, holding: Holding): boolean {
  if (pose === "hidden") return false;
  if (pose === "sitMug" || pose === "standMug") return true;
  return holding.cup === "mug";
}

/** 손에 든 종이컵이 보이는지. */
export function paperCupInHand(pose: Pose, holding: Holding): boolean {
  if (pose === "hidden" || mugInHand(pose, holding)) return false;
  return holding.cup === "paper" || pose === "fillCup" || pose === "drink";
}
