/**
 * 기본 도형으로 만든 둥근 3등신 사람(three.js).
 *
 * 원점은 두 발 사이 바닥이고 −Z를 본다. 단위는 미터(키 약 1.1). 관절 구조와 치수는 맥 앱과 같다.
 * 맥 앱에서 고친 점:
 * - 머리카락을 머리와 거의 같은 공으로 겹치면 머리선이 톱니처럼 깨졌다. 가장자리가 둥글게 말린 껍데기로 만든다.
 * - 단발의 옆·뒷머리 덩어리가 턱 밑을 감싸 수염처럼 보였다. 얼굴 앞을 비운 종 모양으로 만든다.
 * - 사원증 목줄이 몸통에 묻혀 노란 점만 보였다. 몸통 반지름을 높이별로 계산해 옷 위에 띄운다.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CrewLook } from "./crew";
import { HEAD_R, HIP_HEIGHT, LEG_LENGTH, SHOULDER_X, SHOULDER_Y } from "./pose";

// MARK: - 재료와 도형

const matte = (color: string, roughness = 0.86) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
const satin = (color: string, roughness = 0.42) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
const metal = (color: string, roughness = 0.38) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.8 });

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const sphere = (r: number, mat: THREE.Material, seg = 40) => mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), mat);
/** 전체 높이 기준 캡슐(맥 앱 SCNCapsule과 같게). 세로(Y) 방향. */
const capsule = (r: number, height: number, mat: THREE.Material, seg = 24) =>
  mesh(new THREE.CapsuleGeometry(r, Math.max(0.0001, height - 2 * r), Math.max(4, seg / 3), seg), mat);
const box = (w: number, h: number, d: number, round: number, mat: THREE.Material) =>
  mesh(new RoundedBoxGeometry(w, h, d, round > 0.03 ? 5 : 3, Math.min(round, Math.min(w, h, d) / 2)), mat);
const cylinder = (r: number, h: number, mat: THREE.Material, seg = 32) => mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
/** XY 평면에 누운 고리(정면을 본다). */
const torus = (ring: number, pipe: number, mat: THREE.Material) => mesh(new THREE.TorusGeometry(ring, pipe, 14, 40), mat);

function place<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, parent?: THREE.Object3D): T {
  o.position.set(x, y, z);
  parent?.add(o);
  return o;
}
const deg = (d: number) => (d * Math.PI) / 180;
function turn<T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0): T {
  o.rotation.set(deg(x), deg(y), deg(z));
  return o;
}
function scale<T extends THREE.Object3D>(o: T, x: number, y = x, z = x): T {
  o.scale.set(x, y, z);
  return o;
}
const group = (name?: string) => {
  const g = new THREE.Group();
  if (name) g.name = name;
  return g;
};

/** 몇 개의 점을 부드러운 곡선으로 잇는다(Catmull-Rom). */
function smooth(points: [number, number][], steps = 6): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push(new THREE.Vector2(Math.max(0, f(p0[0], p1[0], p2[0], p3[0])), f(p0[1], p1[1], p2[1], p3[1])));
    }
  }
  const last = points[points.length - 1];
  out.push(new THREE.Vector2(last[0], last[1]));
  return out;
}

/**
 * 세로축을 중심으로 옆모습 선을 돌린 도형.
 * arc는 도는 범위(도), center는 범위의 가운데 방향(0 앞(−Z), 90 오른쪽(+X), 180 뒤(+Z)). 맥 앱 Shape.lathe와 같은 약속.
 */
function lathe(profile: THREE.Vector2[], mat: THREE.Material, segments = 48, arc = 360, center = 0): THREE.Mesh {
  const length = deg(arc);
  // three의 LatheGeometry는 φ=0이 +Z, φ=π/2가 +X다.
  const start = Math.PI - deg(center) - length / 2;
  return mesh(new THREE.LatheGeometry(profile, segments, start, length), mat);
}

// MARK: - 몸통 모양

/** 몸통 옆모습(반지름, 높이). 아래가 넓은 종 모양. */
const TORSO_PROFILE: [number, number][] = [[0, 0], [0.12, 0.004], [0.152, 0.05], [0.15, 0.17], [0.128, 0.29], [0.09, 0.355], [0, 0.37]];
const TORSO_CURVE = smooth(TORSO_PROFILE);

/** 그 높이의 몸통 반지름. 사원증·단추처럼 옷 위에 붙는 것을 띄울 때 쓴다. */
export function torsoRadius(y: number): number {
  for (let i = 0; i < TORSO_CURVE.length - 1; i++) {
    const a = TORSO_CURVE[i], b = TORSO_CURVE[i + 1];
    if ((y >= a.y && y <= b.y) || (y <= a.y && y >= b.y)) {
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return 0;
}

// MARK: - 머리카락 도형

/**
 * 공의 한쪽을 덮는 껍데기. 축을 기울여 자르면 머리선이 된다.
 * 가장자리는 안쪽으로 둥글게 말아 두께가 보이게 한다(톱니처럼 깨진 경계 대신 깔끔한 선).
 * @param tilt 축을 +Y에서 뒤(+Z)로 기울인 각(라디안)
 * @param cut 가운데에서 자르는 면까지 거리(축 방향). 음수면 가운데보다 아래까지 덮는다.
 */
function capShell(radius: number, tilt: number, cut: number, mat: THREE.Material, lip = 0.011): THREE.Group {
  const edge = Math.acos(Math.max(-1, Math.min(1, cut / radius)));
  const at = (rho: number, phi: number) => new THREE.Vector2(rho * Math.sin(phi), rho * Math.cos(phi));
  const points: THREE.Vector2[] = [at(radius - 2 * lip, edge - 0.18)];
  for (let k = 0; k <= 8; k++) {
    const a = (Math.PI * k) / 8;
    points.push(at(radius - lip - lip * Math.cos(a), edge + (lip / radius) * Math.sin(a)));
  }
  const steps = 32;
  for (let i = 1; i <= steps; i++) points.push(at(radius, edge * (1 - i / steps)));
  const shell = lathe(points, mat, 64);
  shell.rotation.x = tilt;
  const wrap = group();
  wrap.add(shell);
  return wrap;
}

/** 이마(front)와 목덜미(back) 높이로 머리선을 정하는 머리 껍데기. */
function hairCap(front: number, back: number, mat: THREE.Material, radius = 0.214): THREE.Group {
  const tilt = Math.atan2(front - back, 0.4);
  const cut = Math.cos(tilt) * ((front + back) / 2);
  return scale(capShell(radius, tilt, cut, mat), 1.08, 1, 1);
}

/**
 * 얼굴 앞을 비운 종 모양 옆·뒷머리(단발). 위쪽은 머리 껍데기 안에 숨어 이어진다.
 * @param bottom 머리끝 높이(머리 가운데 기준)
 * @param open 얼굴 앞에 비워 두는 각(도)
 */
function hairBell(bottom: number, mat: THREE.Material, open = 112, radius = 0.226): THREE.Mesh {
  const r = radius;
  const pts: [number, number][] = [[r - 0.024, bottom + 0.05]];
  for (let k = 0; k <= 6; k++) {
    const a = (Math.PI * k) / 6;
    pts.push([r - 0.012 - 0.012 * Math.cos(a), bottom - 0.012 * Math.sin(a)]);
  }
  pts.push([r + 0.003, bottom + 0.05], [r, -0.03], [0.214, 0.02], [0.2, 0.06]);
  const profile = smooth(pts, 5);
  const bell = lathe(profile, mat, 56, 360 - open, 180);
  return scale(bell, 1.08, 1, 1);
}

// MARK: - 사람 한 명

export interface Rig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  headPivot: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  eyes: THREE.Group[];
  brows: THREE.Group[];
  mouth: THREE.Group;
  props: {
    mug: THREE.Group;
    paperCup: THREE.Group;
    snack: THREE.Group;
    paperFile: THREE.Group;
    phone: THREE.Group;
    box: THREE.Group;
    folder: THREE.Group | null;
    backpack: THREE.Group | null;
    straps: THREE.Group | null;
    handBag: THREE.Group | null;
    /** 가슴에 단 사원증 카드(손에 들면 숨긴다). */
    badgeChest: THREE.Group | null;
    /** 단말기에 찍을 때 오른손에 드는 사원증. */
    badgeHand: THREE.Group;
    /** 왼손 메모장(기획자). */
    notepad: THREE.Group | null;
  };
  /** 만든 도형·재료. 사람이 사라질 때 정리한다. */
  dispose(): void;
}

let badgeTexture: THREE.Texture | null = null;
/** 사원증 카드 그림: 초록 띠, 얼굴 동그라미, 이름 줄. */
function badgeMap(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  if (badgeTexture) return badgeTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 130;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#FBF8F1";
  g.fillRect(0, 0, 100, 130);
  g.fillStyle = "#2F6B4F";
  g.fillRect(0, 0, 100, 26);
  g.fillStyle = "#F4C534";
  g.fillRect(40, 8, 20, 6);
  g.fillStyle = "#E9CDB8";
  g.beginPath();
  g.arc(50, 60, 19, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#8C8A86";
  g.fillRect(22, 92, 56, 7);
  g.fillStyle = "#C9C4B8";
  g.fillRect(30, 106, 40, 5);
  badgeTexture = new THREE.CanvasTexture(canvas);
  badgeTexture.colorSpace = THREE.SRGBColorSpace;
  badgeTexture.anisotropy = 4;
  return badgeTexture;
}

export function buildPerson(look: CrewLook): Rig {
  const skin = matte(look.skin, 0.62);
  const cloth = matte(look.top, 0.9);
  const pants = matte(look.pants, 0.92);
  const shoe = satin("#2E2A28", 0.5);

  const root = group(`person.${look.id}`);
  const hips = place(group("hips"), 0, HIP_HEIGHT, 0, root);

  // 다리. 엉덩이에서 아래로 매달린다.
  const legL = group("legL"), legR = group("legR");
  for (const [pivot, x] of [[legL, -0.072], [legR, 0.072]] as const) {
    place(pivot, x, 0.04, 0, hips);
    place(capsule(0.058, LEG_LENGTH + 0.04, pants), 0, -LEG_LENGTH / 2 + 0.01, 0, pivot);
    place(box(0.11, 0.07, 0.15, 0.035, shoe), 0, -LEG_LENGTH - 0.005, -0.025, pivot);
  }

  // 몸통
  const torso = place(group("torso"), 0, 0, 0, hips);
  torso.add(lathe(TORSO_CURVE, cloth, 40));

  // 팔. 어깨를 몸통에 파묻고 소매 끝에 벙어리장갑 손.
  const armL = group("armL"), armR = group("armR"), handL = group("handL"), handR = group("handR");
  for (const [pivot, hand, side] of [[armL, handL, -1], [armR, handR, 1]] as const) {
    place(pivot, side * SHOULDER_X, SHOULDER_Y, 0, torso);
    place(capsule(0.05, 0.25, cloth), 0, -0.1, 0, pivot);
    // 소맷부리. 손이 소매에서 나오는 자리를 또렷하게.
    place(turn(torus(0.044, 0.01, matte(new THREE.Color(look.top).multiplyScalar(0.88).getStyle(), 0.9)), 90), 0, -0.2, 0, pivot);
    place(hand, 0, -0.235, 0, pivot);
    hand.add(scale(sphere(0.056, skin, 24), 1, 1.05, 0.9));
    place(sphere(0.024, skin, 16), side * -0.04, 0.005, -0.03, hand);
  }

  // 머리. 목 없이 몸통 위에 얹는다.
  const headPivot = place(group("headPivot"), 0, 0.345, 0, torso);
  const head = place(group("head"), 0, HEAD_R - 0.01, 0, headPivot);
  head.add(scale(sphere(HEAD_R, skin, 56), 1.08, 1, 1));
  const face = buildFace(head, look);
  buildHair(head, look);

  const rig: Rig = {
    root, hips, torso, headPivot, armL, armR, handL, handR, legL, legR,
    eyes: face.eyes, brows: face.brows, mouth: face.mouth,
    props: {
      mug: buildMug(handR, look.mugColor),
      paperCup: buildPaperCup(handR),
      snack: buildSnack(handR),
      paperFile: buildPaperFile(handR),
      phone: buildPhone(handL),
      box: buildBox(torso),
      folder: null,
      backpack: null,
      straps: null,
      handBag: null,
      badgeChest: null,
      badgeHand: buildBadgeInHand(handR),
      notepad: null,
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.dispose();
        }
      });
    },
  };

  for (const extra of look.extras) {
    switch (extra) {
      case "cardigan": addCardigan(torso); break;
      case "tieSuit": addTie(torso, look, true); break;
      case "tieShirt": addTie(torso, look, false); break;
      case "glasses": addGlasses(head); break;
      case "hoodiePocket": addHoodiePocket(torso, look); break;
      case "hoodDown": addHoodDown(torso, look); break;
      case "vest": addVest(torso); break;
      case "folder": rig.props.folder = addFolder(handR); break;
      case "collar": addCollar(torso, look); break;
      case "notepad": rig.props.notepad = buildNotepad(handL); break;
      case "headset": addHeadset(head, look); break;
      case "tablet": rig.props.notepad = buildTablet(handL); break;
    }
  }
  if (look.hasBadge) rig.props.badgeChest = addBadge(torso, look.badgeY, look.lanyard ?? "#F4C534");
  if (look.bagKind === "backpack") {
    const bag = addBackpack(torso, look.bagColor);
    rig.props.backpack = bag.bag;
    rig.props.straps = bag.straps;
  } else {
    rig.props.handBag = look.bagKind === "tote" ? buildTote(handR, look.bagColor) : buildBriefcase(handR, look.bagColor);
  }
  return rig;
}

// MARK: - 얼굴

/** 가로로 긴 알약 눈(빛 점 하나), 눈썹, 옅은 볼, 작은 입. 코는 없다. */
function buildFace(head: THREE.Group, look: CrewLook) {
  const eyeMat = satin("#1E1E22", 0.12);
  const shine = new THREE.MeshBasicMaterial({ color: "#FFFFFF" });
  const browMat = matte(new THREE.Color(look.hair).multiplyScalar(0.72).getStyle(), 0.7);
  const eyes: THREE.Group[] = [];
  const brows: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    // 눈. 깜빡일 때 이 묶음의 Y 크기를 줄인다.
    const eye = place(group("eye"), side * 0.083, -0.012, -0.182, head);
    eye.add(scale(turn(capsule(0.021, 0.062 * look.eyeWidth, eyeMat, 16), 0, 0, 90), 1, 1, 0.55));
    // 눈동자 빛. 두 눈 모두 같은 쪽 위에 둬야 한 곳에서 빛이 오는 것처럼 보인다.
    place(scale(sphere(0.0072, shine, 12), 1, 1, 0.35), 0.011, 0.007, -0.0108, eye);
    eyes.push(eye);

    // 눈썹. 바깥 끝 높이로 인상을 나눈다.
    const brow = place(group("brow"), side * 0.083, 0.046, -0.181, head);
    const tilt = 90 - side * look.browTilt;
    brow.add(scale(turn(capsule(0.0085 * look.browWeight, 0.05, browMat, 12), 0, 0, tilt), 1, 1, 0.5));
    brows.push(brow);
  }
  const cheek = matte("#EE8F8F", 0.8);
  for (const side of [-1, 1]) place(scale(sphere(0.034, cheek, 16), 1.25, 0.7, 0.35), side * 0.125, -0.058, -0.158, head);
  const mouth = place(group("mouth"), 0, -0.07, -0.19, head);
  mouth.add(scale(turn(capsule(0.011, 0.04, matte("#8A4A4A", 0.6), 12), 0, 0, 90), 1, 1, 0.6));
  return { eyes, brows, mouth };
}

// MARK: - 머리 모양

function buildHair(head: THREE.Group, look: CrewLook) {
  const hair = satin(look.hair, 0.5);
  hair.side = THREE.DoubleSide;
  /** 이마 앞머리 덩어리들(x, y, 크기, 기울기). */
  const bangs = (pieces: [number, number, number, number][]) => {
    for (const [x, y, size, tilt] of pieces) {
      place(turn(scale(sphere(size, hair, 32), 1.35, 0.62, 0.55), 0, 0, tilt), x, y - 0.008, -0.165, head);
    }
  };

  switch (look.hairStyle) {
    case "bun": {
      head.add(hairCap(0.1, -0.12, hair));
      bangs([[-0.07, 0.118, 0.07, -14], [0.055, 0.128, 0.064, 18], [0, 0.14, 0.05, 0]]);
      place(sphere(0.088, hair, 32), 0, 0.212, 0.055, head);
      place(turn(torus(0.056, 0.017, satin("#2F6B4F", 0.4)), 70), 0, 0.165, 0.04, head);
      break;
    }
    case "sidePart": {
      head.add(hairCap(0.105, -0.13, hair, 0.212));
      // 가르마 반대쪽으로 넘긴 앞머리 한 덩어리. 옆에 붙은 혹은 없앤다(귀처럼 보였다).
      place(turn(scale(sphere(0.12, hair, 32), 1.25, 0.48, 0.9), 0, 0, -16), 0.04, 0.152, -0.085, head);
      break;
    }
    case "neat": {
      head.add(hairCap(0.118, -0.14, hair, 0.211));
      place(turn(scale(sphere(0.115, hair, 32), 1.3, 0.42, 0.85), 0, 0, 8), -0.02, 0.16, -0.085, head);
      // 짧은 구레나룻
      for (const side of [-1, 1]) place(scale(sphere(0.04, hair, 16), 0.45, 1.1, 0.9), side * 0.2, 0.025, -0.03, head);
      break;
    }
    case "quiff": {
      head.add(hairCap(0.115, -0.13, hair, 0.211));
      // 이마에서 위로 솟아 뒤로 넘어가는 앞머리. 앞쪽이 가장 높고 정수리 쪽으로 낮아진다.
      // 납작한 덩어리 하나를 얹으면 베레모처럼 보여서, 이마에서 시작하는 굵은 말림과 그 뒤 덩어리로 나눈다.
      place(turn(scale(sphere(0.07, hair, 32), 1.55, 0.95, 0.9), -35, 0, 0), 0, 0.165, -0.135, head);
      place(turn(scale(sphere(0.09, hair, 32), 1.4, 0.75, 1.1), -15, 0, 0), 0, 0.185, -0.065, head);
      break;
    }
    case "hoodUp": {
      // 후드: 얼굴 앞을 크게 비운 껍데기. 공 하나로 감싸면 볼을 파고들었다.
      const hood = matte(look.top, 0.92);
      hood.side = THREE.DoubleSide;
      head.add(scale(capShell(0.24, deg(72), -0.12, hood, 0.02), 1.08, 1, 1));
      // 앞머리는 이마를 가로지르는 한 덩어리.
      place(turn(scale(sphere(0.12, hair, 32), 1.25, 0.42, 0.6), 0, 0, -6), 0.01, 0.112, -0.138, head);
      head.add(hairCap(0.1, -0.1, hair, 0.205));
      break;
    }
    case "bob": {
      head.add(hairCap(0.1, -0.08, hair));
      head.add(hairBell(-0.115, hair, 116));
      bangs([[-0.06, 0.12, 0.072, -8], [0.045, 0.124, 0.07, 10], [0.12, 0.09, 0.05, 30], [-0.005, 0.15, 0.06, 0]]);
      break;
    }
    case "halfUp": {
      head.add(hairCap(0.1, -0.08, hair));
      head.add(hairBell(-0.15, hair, 118));
      bangs([[-0.075, 0.12, 0.07, -12], [0.06, 0.13, 0.068, 14], [0, 0.15, 0.055, 0]]);
      // 뒤통수에 작게 묶은 머리와 머리끈
      place(scale(sphere(0.066, hair, 24), 1.1, 0.9, 1), 0, 0.105, 0.205, head);
      place(turn(torus(0.034, 0.012, satin("#2B3A67", 0.4)), 20), 0, 0.11, 0.17, head);
      break;
    }
    case "lowTail": {
      head.add(hairCap(0.1, -0.16, hair));
      bangs([[-0.08, 0.12, 0.072, -16], [0.075, 0.125, 0.07, 18], [0, 0.15, 0.055, 0]]);
      // 목덜미에서 낮게 묶어 등으로 내려온 머리
      place(turn(capsule(0.058, 0.27, hair, 20), 14, 0, 0), 0, -0.17, 0.2, head);
      place(turn(torus(0.05, 0.014, satin("#E9B94F", 0.4)), 10, 0, 0), 0, -0.07, 0.205, head);
      break;
    }
    case "curly": {
      // 짧은 곱슬머리: 껍데기 위에 작은 덩어리를 고르게 흩뿌린다(정수리·옆·뒤). 같은 자리라야 늘 같은 모양이 된다.
      head.add(hairCap(0.11, -0.12, hair, 0.212));
      const lumps: [number, number, number][] = [];
      for (let ring = 0; ring < 4; ring++) {
        const polar = 0.18 + ring * 0.36;
        const count = 5 + ring * 3;
        for (let i = 0; i < count; i++) {
          const az = (i / count) * Math.PI * 2 + ring * 0.5;
          const x = Math.sin(polar) * Math.sin(az), y = Math.cos(polar), z = Math.sin(polar) * Math.cos(az);
          // 얼굴 앞쪽 아래는 비운다(이마·눈 위를 덮지 않게).
          if (z < -0.55 && y < 0.75) continue;
          lumps.push([x * 0.215 * 1.08, y * 0.215 + 0.005, z * 0.215]);
        }
      }
      for (const [x, y, z] of lumps) place(sphere(0.042, hair, 16), x, y, z, head);
      // 이마 위 잔머리
      bangs([[-0.06, 0.13, 0.05, -10], [0.05, 0.135, 0.05, 12], [0, 0.15, 0.045, 0]]);
      break;
    }
    case "cap": {
      head.add(hairCap(0.03, -0.13, hair, 0.21));
      const fabric = matte(new THREE.Color(look.top).multiplyScalar(0.8).getStyle(), 0.85);
      fabric.side = THREE.DoubleSide;
      // 모자 윗부분과 앞으로 나온 챙(반원판)
      head.add(scale(capShell(0.222, deg(-12), 0.07, fabric, 0.008), 1.08, 1, 1));
      // 챙은 이마 앞으로 9cm쯤 나와야 옆에서 야구 모자로 읽힌다.
      // 앞으로 숙여야 눈높이 구도에서도 챙 윗면이 보인다.
      const brim = mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.02, 40, 1, false, Math.PI / 2, Math.PI), fabric);
      head.add(place(scale(turn(brim, 20, 0, 0), 1.05, 1, 1.2), 0, 0.085, -0.15));
      place(sphere(0.017, fabric, 12), 0, 0.222, 0.01, head);
      break;
    }
  }
}

// MARK: - 옷과 소품

/** 사원증. 노란 목줄이 목 뒤로 돌아가고, 카드는 옷 위에 띄운다. */
function addBadge(torso: THREE.Group, cardY: number, strapColor: string): THREE.Group {
  const strap = matte(strapColor, 0.7);
  // 목 뒤 고리: 몸통보다 조금 크게, 앞이 살짝 내려가게.
  place(turn(scale(torus(0.106, 0.009, strap), 1, 1.18, 1), 90 - 16, 0, 0), 0, 0.335, 0.005, torso);
  const cardTop = cardY + 0.065;
  const front = (y: number) => -(torsoRadius(y) + 0.022);
  // 목줄 앞 두 가닥: 목 옆에서 카드 윗모서리까지.
  for (const side of [-1, 1]) {
    const from = new THREE.Vector3(side * 0.062, 0.333, -(torsoRadius(0.333) * 0.82 + 0.006));
    const to = new THREE.Vector3(side * 0.022, cardTop, front(cardTop) + 0.004);
    const piece = capsule(0.0065, from.distanceTo(to) + 0.013, strap, 8);
    piece.position.copy(from).add(to).multiplyScalar(0.5);
    piece.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    torso.add(piece);
  }
  // 카드: 몸 기울기에 맞춰 위가 뒤로 조금 눕는다.
  const map = badgeMap();
  const cardMat = map ? new THREE.MeshStandardMaterial({ map, roughness: 0.5 }) : matte("#FBF8F1", 0.5);
  const chest = place(group("badgeChest"), 0, 0, 0, torso);
  const card = box(0.1, 0.13, 0.008, 0.01, cardMat);
  const slope = Math.atan2(torsoRadius(cardY - 0.06) - torsoRadius(cardY + 0.06), 0.12);
  place(card, 0, cardY, front(cardY), chest).rotation.x = -slope;
  // 카드 집게
  place(box(0.03, 0.016, 0.012, 0.004, metal("#C9C4B8")), 0, cardTop - 0.004, front(cardTop) - 0.002, chest);
  return chest;
}

/** 단말기에 찍을 때 손에 드는 사원증. 카드 면이 앞(단말기)을 본다. */
function buildBadgeInHand(hand: THREE.Group): THREE.Group {
  const g = place(group("badgeHand"), 0, -0.02, -0.06, hand);
  const map = badgeMap();
  const mat = map ? new THREE.MeshStandardMaterial({ map, roughness: 0.5 }) : matte("#FBF8F1", 0.5);
  g.add(turn(box(0.1, 0.13, 0.008, 0.01, mat), 0, 180, 0));
  g.visible = false;
  return g;
}

/** 셔츠 깃(넥타이 없이). 단정한 셔츠로 다른 부서임을 보인다. */
function addCollar(torso: THREE.Group, look: CrewLook) {
  const shirt = matte(new THREE.Color(look.top).lerp(new THREE.Color("#FFFFFF"), 0.35).getStyle(), 0.85);
  for (const side of [-1, 1]) {
    place(turn(box(0.065, 0.032, 0.02, 0.009, shirt), 0, side * 18, side * 28), side * 0.04, 0.333, -torsoRadius(0.333) - 0.004, torso);
  }
  // 앞 단추 줄
  for (const y of [0.13, 0.2, 0.27]) place(sphere(0.008, satin("#FBF8F1", 0.3), 10), 0.0, y, -torsoRadius(y) - 0.003, torso);
}

/** 머리띠 헤드셋: 정수리를 넘는 띠, 왼쪽 귀 덮개, 입가로 오는 마이크. */
function addHeadset(head: THREE.Group, look: CrewLook) {
  const band = satin("#2A2A30", 0.4);
  const accent = satin(new THREE.Color(look.top).lerp(new THREE.Color("#FFFFFF"), 0.2).getStyle(), 0.4);
  // 띠: 머리 위를 좌우로 넘는 반원(머리카락 위로 살짝 띄운다)
  const arc = mesh(new THREE.TorusGeometry(0.232, 0.011, 10, 40, Math.PI), band);
  arc.scale.set(1.08, 1, 1);
  place(arc, 0, 0.0, 0.0, head);
  // 귀 덮개(왼쪽)와 오른쪽 받침
  place(turn(scale(cylinder(0.05, 0.03, accent, 24), 1, 1, 1), 0, 0, 90), -0.245, 0.0, 0.0, head);
  place(turn(scale(cylinder(0.035, 0.02, band, 20), 1, 1, 1), 0, 0, 90), 0.245, 0.0, 0.0, head);
  // 마이크 줄과 끝
  const boom = capsule(0.006, 0.17, band, 8);
  boom.position.set(-0.2, -0.07, -0.1);
  boom.rotation.set(deg(-55), 0, deg(-35));
  head.add(boom);
  place(sphere(0.016, accent, 12), -0.12, -0.11, -0.17, head);
}

/** 왼손 태블릿: 어두운 테두리, 화면에 막대그래프와 오르는 선. 듣거나 끄덕일 때 든다(메모장 자리를 같이 쓴다). */
function buildTablet(hand: THREE.Group): THREE.Group {
  const pad = place(group("tablet"), 0, -0.02, -0.06, hand);
  pad.add(box(0.15, 0.11, 0.012, 0.01, satin("#2A2A30", 0.35)));
  place(box(0.135, 0.095, 0.004, 0.004, new THREE.MeshBasicMaterial({ color: "#F4F1EA" })), 0, 0, -0.007, pad);
  const bar = new THREE.MeshBasicMaterial({ color: "#2F6B4F" });
  [0.025, 0.04, 0.032, 0.055].forEach((h, i) => {
    place(box(0.016, h, 0.002, 0.001, bar), -0.045 + i * 0.026, -0.04 + h / 2, -0.01, pad);
  });
  const line = new THREE.MeshBasicMaterial({ color: "#E07A3F" });
  place(turn(box(0.11, 0.004, 0.002, 0.001, line), 0, 0, 18), 0.0, 0.015, -0.011, pad);
  pad.visible = false;
  return pad;
}

/** 왼손 메모장과 펜. */
function buildNotepad(hand: THREE.Group): THREE.Group {
  const pad = place(group("notepad"), 0, -0.02, -0.06, hand);
  pad.add(box(0.11, 0.15, 0.014, 0.006, matte("#E07A3F", 0.7)));
  place(box(0.1, 0.14, 0.006, 0.003, matte("#FFFDF5", 0.8)), 0, -0.003, -0.009, pad);
  for (const y of [0.03, 0.0, -0.03]) place(box(0.07, 0.004, 0.002, 0.001, matte("#B9B2A2")), -0.005, y, -0.013, pad);
  place(turn(capsule(0.005, 0.13, satin("#2B3A67", 0.4), 8), 0, 0, -30), 0.07, 0.0, -0.01, pad);
  pad.visible = false;
  return pad;
}

/** 등에 메는 가방과 어깨 멜빵. */
function addBackpack(torso: THREE.Group, color: string) {
  const bag = place(group("backpack"), 0, 0.17, 0.175, torso);
  const body = matte(color, 0.85);
  bag.add(box(0.31, 0.3, 0.13, 0.06, body));
  place(box(0.22, 0.13, 0.05, 0.03, matte(new THREE.Color(color).lerp(new THREE.Color("#FFFFFF"), 0.12).getStyle(), 0.85)), 0, -0.06, 0.075, bag);
  place(turn(capsule(0.011, 0.11, metal("#B8913F")), 0, 0, 90), 0, 0, 0.1, bag);
  place(torus(0.04, 0.012, body), 0, 0.16, 0, bag).rotation.y = Math.PI / 2;
  const straps = place(group("straps"), 0, 0, 0, torso);
  const strapMat = matte(new THREE.Color(color).multiplyScalar(0.85).getStyle(), 0.85);
  for (const side of [-1, 1]) {
    // 어깨에 걸쳐 앞가슴으로 내려오는 멜빵.
    place(turn(scale(torus(0.075, 0.013, strapMat), 1, 1.25, 0.65), 0, 90, 0), side * 0.085, 0.255, 0.005, straps);
  }
  return { bag, straps };
}

/** 한 손에 드는 토트백. 손잡이가 손 안에 있고 가방은 아래로 늘어진다. */
function buildTote(hand: THREE.Group, color: string): THREE.Group {
  const bag = place(group("tote"), 0, 0, 0, hand);
  const leather = matte(color, 0.75);
  // 넓은 면이 옆(X)을 보게 들어 다리에 부딪히지 않게 한다.
  place(scale(box(0.075, 0.2, 0.25, 0.03, leather), 1, 1, 1), 0, -0.175, 0, bag);
  for (const z of [-0.05, 0.05]) {
    const handle = torus(0.06, 0.008, matte(new THREE.Color(color).multiplyScalar(0.7).getStyle(), 0.7));
    handle.rotation.y = Math.PI / 2;
    handle.scale.set(1, 1.1, 1);
    place(handle, 0, -0.07, z, bag);
  }
  bag.visible = false;
  return bag;
}

/** 서류가방. 짧은 손잡이와 금속 잠금쇠. */
function buildBriefcase(hand: THREE.Group, color: string): THREE.Group {
  const bag = place(group("briefcase"), 0, 0, 0, hand);
  const leather = satin(color, 0.55);
  place(box(0.07, 0.21, 0.3, 0.02, leather), 0, -0.165, 0, bag);
  const handle = torus(0.035, 0.009, leather);
  handle.rotation.y = Math.PI / 2;
  handle.scale.set(1, 0.7, 1);
  place(handle, 0, -0.06, 0, bag);
  for (const z of [-0.08, 0.08]) place(box(0.078, 0.025, 0.03, 0.005, metal("#C9A75A")), 0, -0.09, z, bag);
  bag.visible = false;
  return bag;
}

function buildMug(hand: THREE.Group, color: string): THREE.Group {
  const mug = place(group("mug"), 0, -0.005, -0.055, hand);
  const glaze = satin(color, 0.3);
  place(cylinder(0.036, 0.085, glaze), 0, 0.02, 0, mug);
  place(cylinder(0.031, 0.002, satin("#5A3A28", 0.2)), 0, 0.058, 0, mug);
  const handle = torus(0.022, 0.007, glaze);
  handle.rotation.y = Math.PI / 2;
  place(handle, 0.04, 0.02, 0, mug);
  mug.visible = false;
  return mug;
}

function buildPaperCup(hand: THREE.Group): THREE.Group {
  const cup = place(group("paperCup"), 0, -0.02, -0.05, hand);
  const paper = matte("#FBF8F1", 0.7);
  place(mesh(new THREE.CylinderGeometry(0.042, 0.032, 0.1, 28), paper), 0, 0.05, 0, cup);
  place(mesh(new THREE.TorusGeometry(0.042, 0.004, 8, 28), paper), 0, 0.1, 0, cup).rotation.x = Math.PI / 2;
  place(cylinder(0.039, 0.003, satin("#BFE3F2", 0.1)), 0, 0.088, 0, cup);
  cup.visible = false;
  return cup;
}

function buildSnack(hand: THREE.Group): THREE.Group {
  const bag = place(group("snack"), 0, -0.03, -0.06, hand);
  bag.add(box(0.11, 0.14, 0.04, 0.018, satin("#E5603F", 0.35)));
  place(box(0.112, 0.03, 0.042, 0.008, satin("#F4C534", 0.35)), 0, 0.035, 0, bag);
  bag.visible = false;
  return bag;
}

function buildPaperFile(hand: THREE.Group): THREE.Group {
  const file = place(group("paper"), 0, -0.05, -0.07, hand);
  file.add(box(0.2, 0.26, 0.018, 0.006, matte("#4E8A6A", 0.7)));
  place(box(0.18, 0.24, 0.01, 0.003, matte("#FBF8F1", 0.8)), 0.004, 0.004, -0.012, file);
  file.visible = false;
  return file;
}

function buildPhone(hand: THREE.Group): THREE.Group {
  const phone = place(group("phone"), 0.02, 0, -0.01, hand);
  phone.add(box(0.06, 0.11, 0.014, 0.01, satin("#2E2E33", 0.3)));
  phone.rotation.y = Math.PI / 2;
  phone.visible = false;
  return phone;
}

function buildBox(torso: THREE.Group): THREE.Group {
  const parcel = place(group("box"), 0, 0.12, -0.27, torso);
  parcel.add(box(0.34, 0.24, 0.26, 0.015, matte("#C9A06A", 0.9)));
  place(box(0.345, 0.03, 0.08, 0.004, matte("#E8D9B8", 0.7)), 0, 0.11, 0, parcel);
  place(box(0.1, 0.07, 0.005, 0.003, matte("#FBF8F1")), 0.08, 0.02, -0.132, parcel);
  parcel.visible = false;
  return parcel;
}

/** 카디건 앞섶(흰 셔츠가 보이는 띠)과 단추. */
function addCardigan(torso: THREE.Group) {
  const shirt = matte("#FBF8F1", 0.85);
  torso.add(lathe(smooth([[0.147, 0.06], [0.152, 0.17], [0.131, 0.28], [0.095, 0.345]]), shirt, 40, 26, 0));
  for (const y of [0.1, 0.16, 0.26]) {
    // 단추는 카드 옆(x 0.06)에 둬 사원증과 겹치지 않게.
    const x = 0.058;
    place(sphere(0.011, satin("#B8913F", 0.35), 12), x, y, -Math.sqrt(Math.max(0, torsoRadius(y) ** 2 - x * x)) - 0.004, torso);
  }
}

/** 넥타이. 정장이면 앞섶을 열어 흰 셔츠를 보이고, 셔츠면 깃을 단다. */
function addTie(torso: THREE.Group, look: CrewLook, suit: boolean) {
  const shirt = matte(suit ? "#FBF8F1" : new THREE.Color(look.top).lerp(new THREE.Color("#FFFFFF"), 0.2).getStyle(), 0.85);
  if (suit) {
    torso.add(lathe(smooth([[0.148, 0.12], [0.152, 0.2], [0.131, 0.285], [0.095, 0.345]]), shirt, 40, 40, 0));
  } else {
    for (const side of [-1, 1]) {
      place(turn(box(0.06, 0.03, 0.02, 0.008, shirt), 0, 0, side * 25), side * 0.035, 0.335, -0.1, torso);
    }
  }
  const tie = satin("#2B3A67", 0.5);
  place(box(0.034, 0.03, 0.02, 0.008, tie), 0, 0.315, -torsoRadius(0.315) - 0.008, torso);
  place(turn(box(0.04, 0.11, 0.012, 0.012, tie), -12, 0, 0), 0, 0.245, -torsoRadius(0.245) - 0.008, torso);
}

function addGlasses(head: THREE.Group) {
  const frame = satin("#3A3330", 0.3);
  for (const side of [-1, 1]) place(torus(0.042, 0.0065, frame), side * 0.083, -0.012, -0.195, head);
  place(turn(capsule(0.006, 0.05, frame, 8), 0, 0, 90), 0, -0.004, -0.203, head);
  // 다리: 옆머리 쪽으로
  for (const side of [-1, 1]) place(turn(capsule(0.005, 0.15, frame, 8), 90, 0, 0), side * 0.128, -0.006, -0.12, head);
}

function addHoodiePocket(torso: THREE.Group, look: CrewLook) {
  const pocket = lathe(smooth([[0.153, 0.06], [0.153, 0.13], [0.146, 0.18]]), matte(new THREE.Color(look.top).multiplyScalar(0.92).getStyle(), 0.92), 40, 70, 0);
  pocket.scale.set(1.03, 1, 1.03);
  torso.add(pocket);
}

/** 등 뒤로 내린 후드와 후드 끈. 끈은 사원증 바깥쪽으로 내린다. */
function addHoodDown(torso: THREE.Group, look: CrewLook) {
  const hood = matte(new THREE.Color(look.top).multiplyScalar(0.94).getStyle(), 0.92);
  place(scale(sphere(0.13, hood, 28), 1.35, 0.8, 0.75), 0, 0.32, 0.105, torso);
  for (const side of [-1, 1]) {
    const y = 0.27;
    place(capsule(0.008, 0.075, matte("#FBF8F1"), 10), side * 0.075, y, -torsoRadius(y) - 0.012, torso);
  }
}

function addVest(torso: THREE.Group) {
  torso.add(lathe(smooth([[0.156, 0.05], [0.159, 0.17], [0.136, 0.28], [0.1, 0.34]]), matte("#2F4F5A", 0.9), 40));
  torso.add(lathe([new THREE.Vector2(0.161, 0.12), new THREE.Vector2(0.162, 0.15)], matte("#E8F05A", 0.5), 40));
}

function addFolder(hand: THREE.Group): THREE.Group {
  // 팔을 내린 손에 쥐고 옆구리에 붙인 서류철. 판이 몸 옆면과 나란해야 다리를 가리지 않는다.
  const folder = place(group("folder"), 0.035, -0.05, 0.01, hand);
  folder.add(box(0.016, 0.26, 0.2, 0.006, matte("#E9B94F", 0.7)));
  place(box(0.008, 0.24, 0.18, 0.003, matte("#FBF8F1", 0.8)), -0.01, 0.004, 0, folder);
  folder.visible = false;
  return folder;
}
