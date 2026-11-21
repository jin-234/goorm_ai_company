"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CREW, type PersonId } from "./crew";
import { buildPerson, type Rig } from "./model";
import {
  bodyFor, faceFor, HIP_HEIGHT, mixBody, mugInHand, paperCupInHand, smoothstep, STRIDE,
  type Arm, type Body, type Holding, type Pose, type Vec3,
} from "./pose";

export interface PersonProps {
  who: PersonId;
  pose: Pose;
  holding?: Holding;
  /** 키보드 윗면 가운데와 마우스 윗면의 월드 좌표. 주면 앉아 타자할 때 손이 그 위에 간다. */
  desk?: { keyboard: Vec3; mouse: Vec3 } | null;
  /** 시각(초). 생략하면 내부 시계. 스크린샷을 늘 같게 뽑을 때만 넣는다. */
  time?: number;
  /** 손에 든 머그가 보이는지 바뀔 때. */
  onMugInHand?: (visible: boolean) => void;
}

const BLEND_SECONDS = 0.3;
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

const armQuaternion = (a: Arm, out = new THREE.Quaternion()) => {
  const yaw = new THREE.Quaternion().setFromAxisAngle(Y, -a.yaw);
  const pitch = new THREE.Quaternion().setFromAxisAngle(X, a.pitch);
  const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a.roll);
  return out.copy(yaw).multiply(pitch).multiply(roll);
};

/**
 * 사무실 사람 한 명. 위치와 방향은 부모 group이 정한다(원점은 발 가운데, 앞은 −Z).
 * 앉을 때는 부모 group의 y를 SEATED_ROOT_Y로 올린다.
 */
export function Person({ who, pose, holding = {}, desk = null, time, onMugInHand }: PersonProps) {
  const look = CREW[who];
  const rig = useMemo<Rig>(() => buildPerson(look), [look]);
  useEffect(() => () => rig.dispose(), [rig]);

  const state = useRef({
    pose: pose as Pose,
    poseStart: 0,
    from: null as Body | null,
    last: null as Body | null,
    lastWorld: null as THREE.Vector3 | null,
    cycle: 0,
    speed: 0,
    mugShown: false,
  });
  const latest = useRef({ pose, holding, desk, time, onMugInHand });
  latest.current = { pose, holding, desk, time, onMugInHand };

  useFrame((frame, rawDelta) => {
    const s = state.current;
    const p = latest.current;
    const delta = Math.min(0.1, Math.max(0, rawDelta));
    const t = p.time ?? frame.clock.elapsedTime;
    const root = rig.root;
    root.visible = p.pose !== "hidden";

    // 자세가 바뀌면 직전 모습에서 0.3초에 걸쳐 넘어간다.
    if (p.pose !== s.pose) {
      s.from = s.last;
      s.pose = p.pose;
      s.poseStart = t;
    }
    if (p.pose === "hidden") return;

    // 실제 이동 거리로 걸음 박자를 센다. 누가 옮기든 발이 미끄러지지 않는다.
    const world = root.getWorldPosition(new THREE.Vector3());
    const moved = s.lastWorld ? Math.hypot(world.x - s.lastWorld.x, world.z - s.lastWorld.z) : 0;
    s.lastWorld = world;
    const step = moved > 0.5 ? 0 : moved; // 순간 이동은 걸음으로 치지 않는다.
    s.cycle += (step / STRIDE) * Math.PI * 2;
    const speedNow = delta > 0 ? step / delta : s.speed;
    s.speed += (speedNow - s.speed) * (1 - Math.exp(-delta * 8));

    const bag = p.holding.bag ?? null;
    const carriesHandBag = bag != null && look.bagKind !== "backpack";
    let deskLocal: { keyboard: Vec3; mouse: Vec3 } | null = null;
    if (p.desk) {
      const toLocal = (v: Vec3): Vec3 => {
        const l = root.worldToLocal(new THREE.Vector3(v[0], v[1], v[2]));
        return [l.x, l.y, l.z];
      };
      deskLocal = { keyboard: toLocal(p.desk.keyboard), mouse: toLocal(p.desk.mouse) };
      // 다른 책상 좌표가 잘못 들어오면(1m 넘게 멀면) 손을 맞추지 않는다.
      if (Math.hypot(deskLocal.keyboard[0], deskLocal.keyboard[2]) > 1) deskLocal = null;
    }
    const sincePoseStart = t - s.poseStart;
    const ctx = {
      rate: look.rate, phase: look.phase, holding: p.holding, desk: deskLocal,
      gait: { cycle: s.cycle, amount: Math.min(1.15, s.speed / 0.9) },
      carriesHandBag, sincePoseStart,
    };
    let body = bodyFor(p.pose, t, ctx);
    if (s.from && sincePoseStart < BLEND_SECONDS) body = mixBody(s.from, body, smoothstep(0, BLEND_SECONDS, sincePoseStart));
    s.last = body;
    const face = faceFor(p.pose, t, ctx);

    // 몸
    const tt = t * look.rate + look.phase;
    const breath = Math.sin((tt * 2 * Math.PI) / 3.7);
    rig.torso.scale.set(1 - 0.01 * breath, 1 + 0.022 * breath, 1 - 0.01 * breath);
    rig.hips.position.y = HIP_HEIGHT + body.bounce;
    rig.hips.rotation.set(body.torsoPitch, 0, body.hipRoll);
    rig.legL.rotation.set(body.legL - body.torsoPitch, 0, 0);
    rig.legR.rotation.set(body.legR - body.torsoPitch, 0, 0);
    armQuaternion(body.left, rig.armL.quaternion);
    armQuaternion(body.right, rig.armR.quaternion);
    rig.handL.position.y = -body.reachL;
    rig.handR.position.y = -body.reachR;
    rig.headPivot.quaternion
      .setFromAxisAngle(Y, body.headYaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, body.headPitch - body.torsoPitch * 0.6));

    // 얼굴
    for (const eye of rig.eyes) eye.scale.y = Math.max(0.08, 1 - face.blink);
    for (const brow of rig.brows) brow.position.y = 0.046 + face.browLift - 0.004 * face.blink;
    rig.mouth.scale.set(1 + 0.35 * face.smile - 0.15 * face.mouthOpen, 1 + 1.7 * face.mouthOpen + 0.3 * face.smile, 1);

    // 소품
    const props = rig.props;
    const mug = mugInHand(p.pose, p.holding);
    props.mug.visible = mug;
    if (mug !== s.mugShown) {
      s.mugShown = mug;
      p.onMugInHand?.(mug);
    }
    props.paperCup.visible = paperCupInHand(p.pose, p.holding);
    props.snack.visible = p.pose === "sitEat";
    props.phone.visible = p.pose === "phone";
    props.box.visible = p.pose === "standBox" || p.pose === "offerBox" || (!!p.holding.box && (p.pose === "walk" || p.pose === "stand"));
    props.box.position.set(0, p.pose === "offerBox" ? 0.17 : 0.12, p.pose === "offerBox" ? -0.33 : -0.27);
    const paper = !!p.holding.paper || p.pose === "holdPaper" || p.pose === "offerPaper" || p.pose === "sitReview";
    props.paperFile.visible = paper;
    if (props.folder) props.folder.visible = !paper && (p.pose === "stand" || p.pose === "wave") && !carriesHandBag;
    const worn = bag != null && look.bagKind === "backpack";
    if (props.backpack) props.backpack.visible = worn;
    if (props.straps) props.straps.visible = worn;
    if (props.handBag) props.handBag.visible = carriesHandBag && !["sitType", "sitMug", "sitListen", "sitEat", "sitReview", "sitExplain"].includes(p.pose);

    // 컵·가방은 팔이 어떻게 돌아도 똑바로 선 채로 든다(마실 때만 입 쪽으로 기울인다).
    const upright = new THREE.Quaternion().copy(rig.hips.quaternion).multiply(rig.armR.quaternion).invert();
    const sip = p.pose === "drink" ? Math.max(0, (body.right.pitch - 1.05) / 1.25) : 0;
    props.mug.quaternion.copy(upright);
    props.paperCup.quaternion.copy(upright).multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.6 * sip));
    props.snack.quaternion.copy(upright);
    if (props.handBag) props.handBag.quaternion.copy(upright);
    // 서류철은 손에서 몸 쪽으로 세워 들고, 읽을 때는 얼굴 쪽으로 기울인다.
    props.paperFile.quaternion.copy(upright).multiply(new THREE.Quaternion().setFromAxisAngle(X, p.pose === "sitReview" ? 0.9 : 0.25));
  });

  return <primitive object={rig.root} />;
}
