"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CREW, LINEUP, type PersonId } from "./crew";
import { Person } from "./Person";
import { SEATED_ROOT_Y, type Holding, type Pose, type Vec3 } from "./pose";

/**
 * 캐릭터 확인 페이지(/lab/characters). 주소 뒤 값으로 장면을 고정할 수 있다.
 *   scene=lineup|desk|walk|poses(한 사람의 모든 자세, who=me)  angle=front|side|back|above|close|closeSide|closeBack  pose=stand  t=3.2(시각 고정)
 */

type Scene = "lineup" | "desk" | "walk" | "poses";
type Angle = "front" | "side" | "back" | "above" | "close" | "closeSide" | "closeBack";

const POSES: Pose[] = [
  "stand", "walk", "wave", "bow", "nod", "present", "phone", "stretch", "standMug", "drink", "fillCup",
  "reach", "packUp", "holdPaper", "offerPaper", "standBox", "offerBox", "sitListen", "sitEat", "sitReview", "sitExplain",
];

/** 확인용 책상: 섬 책상과 같은 치수(1.4×0.75, 상판 윗면 0.775). 키보드는 앞 가장자리에서 0.095, 마우스는 +0.32. */
const DESK = { width: 1.4, depth: 0.75, top: 0.775, toDesk: 0.55 };
function deskSpots(seat: THREE.Vector3, heading: number): { keyboard: Vec3; mouse: Vec3 } {
  const forward = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
  const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
  const edge = seat.clone().addScaledVector(forward, DESK.toDesk - DESK.depth / 2);
  const key = edge.clone().addScaledVector(forward, 0.095).addScaledVector(right, -0.06);
  const mouse = key.clone().addScaledVector(right, 0.32).addScaledVector(forward, -0.01);
  return { keyboard: [key.x, DESK.top + 0.026, key.z], mouse: [mouse.x, DESK.top + 0.035, mouse.z] };
}

function LabDesk({ seat, heading }: { seat: THREE.Vector3; heading: number }) {
  const forward = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
  const center = seat.clone().addScaledVector(forward, DESK.toDesk);
  const spots = deskSpots(seat, heading);
  return (
    <group>
      <group position={center} rotation-y={heading}>
        <mesh position={[0, DESK.top - 0.035, 0]} castShadow receiveShadow>
          <boxGeometry args={[DESK.width, 0.07, DESK.depth]} />
          <meshStandardMaterial color="#E8DCC4" roughness={0.6} />
        </mesh>
        {[-1, 1].map((sx) => [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * (DESK.width / 2 - 0.1), (DESK.top - 0.07) / 2, sz * (DESK.depth / 2 - 0.1)]} castShadow>
            <boxGeometry args={[0.055, DESK.top - 0.07, 0.055]} />
            <meshStandardMaterial color="#F4F1EA" roughness={0.45} />
          </mesh>
        )))}
        <group position={[-0.06, DESK.top, -DESK.depth / 2 + 0.2]}>
          <mesh position={[0, 0.01, 0]}><cylinderGeometry args={[0.13, 0.13, 0.02, 32]} /><meshStandardMaterial color="#5A5A60" /></mesh>
          <mesh position={[0, 0.13, -0.02]}><boxGeometry args={[0.05, 0.24, 0.04]} /><meshStandardMaterial color="#5A5A60" /></mesh>
          <mesh position={[0, 0.46, 0]} castShadow><boxGeometry args={[0.8, 0.5, 0.045]} /><meshStandardMaterial color="#2E2E33" roughness={0.35} /></mesh>
          <mesh position={[0, 0.465, 0.024]}><planeGeometry args={[0.74, 0.44]} /><meshBasicMaterial color="#DDEBF2" /></mesh>
        </group>
      </group>
      <mesh position={[spots.keyboard[0], DESK.top + 0.011, spots.keyboard[2]]} rotation-y={heading} castShadow>
        <boxGeometry args={[0.46, 0.022, 0.16]} />
        <meshStandardMaterial color="#F4F1EA" roughness={0.5} />
      </mesh>
      <mesh position={[spots.mouse[0], DESK.top + 0.015, spots.mouse[2]]} rotation-y={heading} scale={[1, 0.6, 1]} castShadow>
        <capsuleGeometry args={[0.034, 0.042, 6, 16]} />
        <meshStandardMaterial color="#F4F1EA" roughness={0.4} />
      </mesh>
      {/* 의자 좌판(0.47)과 등받이 */}
      <group position={seat} rotation-y={heading}>
        <mesh position={[0, 0.44, 0.04]} castShadow><boxGeometry args={[0.46, 0.06, 0.44]} /><meshStandardMaterial color="#2F6B4F" roughness={0.8} /></mesh>
        <mesh position={[0, 0.72, 0.27]} castShadow><boxGeometry args={[0.42, 0.4, 0.06]} /><meshStandardMaterial color="#2F6B4F" roughness={0.8} /></mesh>
        <mesh position={[0, 0.2, 0.04]}><cylinderGeometry args={[0.03, 0.03, 0.4, 12]} /><meshStandardMaterial color="#9A9A9F" /></mesh>
      </group>
    </group>
  );
}

function CameraRig({ scene, angle }: { scene: Scene; angle: Angle }) {
  const { camera } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const target = new THREE.Vector3(0, 0.6, 0);
    let yaw = 0, pitch = 12, distance = 13, fov = 24;
    if (scene === "lineup") {
      ({ yaw, pitch, distance, fov } = {
        front: { yaw: 0, pitch: 12, distance: 13, fov: 24 },
        side: { yaw: 50, pitch: 12, distance: 13, fov: 24 },
        back: { yaw: 180, pitch: 30, distance: 13, fov: 24 },
        above: { yaw: 0, pitch: 40, distance: 13, fov: 24 },
        close: { yaw: 0, pitch: 6, distance: 13, fov: 9 },
        closeSide: { yaw: 50, pitch: 10, distance: 13, fov: 9 },
        closeBack: { yaw: 180, pitch: 22, distance: 13, fov: 9 },
      }[angle]);
    } else if (scene === "desk") {
      target.set(0, 0.7, 0);
      ({ yaw, pitch, distance, fov } = {
        front: { yaw: 25, pitch: 38, distance: 8, fov: 32 },
        side: { yaw: 90, pitch: 14, distance: 8, fov: 32 },
        back: { yaw: 0, pitch: 45, distance: 8, fov: 32 },
        above: { yaw: 0, pitch: 75, distance: 8, fov: 32 },
        close: { yaw: 35, pitch: 40, distance: 5.5, fov: 13 },
        closeSide: { yaw: 90, pitch: 12, distance: 5.5, fov: 13 },
        closeBack: { yaw: 0, pitch: 55, distance: 5.5, fov: 13 },
      }[angle]);
      // 가까운 구도는 고른 사람(focus=me 등)을 본다.
      if (angle.startsWith("close")) {
        const focus = new URLSearchParams(window.location.search).get("focus") ?? "me";
        const x = { manager: -2.25, me: -0.75, senior: 0.75, director: 2.25 }[focus] ?? -0.75;
        target.set(x, 0.72, -0.05);
      }
    } else if (scene === "poses") {
      target.set(0, 0.5, 0.75);
      ({ yaw, pitch, distance, fov } = { yaw: angle === "side" ? 60 : angle === "back" ? 180 : 0, pitch: 28, distance: 12, fov: 30 });
    } else {
      target.set(0, 0.45, 0);
      ({ yaw, pitch, distance, fov } = { yaw: angle === "side" ? 90 : 20, pitch: 35, distance: 9, fov: 30 });
    }
    const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
    cam.fov = fov;
    cam.position.set(target.x + distance * Math.cos(p) * Math.sin(y), target.y + distance * Math.sin(p), target.z + distance * Math.cos(p) * Math.cos(y));
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  }, [camera, scene, angle]);
  return null;
}

/** 원을 따라 걷는 사람. 위치를 옮기면 Person이 이동 속도로 걸음 박자를 센다. */
function Walker({ who, index, count, fixed, holding }: { who: PersonId; index: number; count: number; fixed?: number; holding: Holding }) {
  const ref = useRef<THREE.Group>(null);
  const speed = 0.7 + 0.12 * (index % 4);
  useFrame((frame) => {
    const t = fixed ?? frame.clock.elapsedTime;
    const radius = 1.3 + 0.75 * (index % 3);
    const angle = (index / count) * Math.PI * 2 + (t * speed) / radius;
    const g = ref.current;
    if (!g) return;
    g.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    // 진행 방향(반시계)을 본다. 앞이 −Z라 방향을 맞춘다.
    const dx = -Math.sin(angle), dz = Math.cos(angle);
    g.rotation.y = Math.atan2(-dx, -dz);
  });
  return (
    <group ref={ref}>
      <Person who={who} pose="walk" holding={holding} time={fixed} />
    </group>
  );
}

/** 시각을 고정하면 걷는 장면은 매 화면 조금씩 시간을 흘려 걸음 박자를 만든다. */
function FixedClock({ start, onTick }: { start: number; onTick: (t: number) => void }) {
  const t = useRef(start - 1.5);
  useFrame(() => {
    if (t.current < start) {
      t.current = Math.min(start, t.current + 1 / 30);
      onTick(t.current);
    }
  });
  return null;
}

export default function CharacterLab() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => setParams(new URLSearchParams(window.location.search)), []);
  const scene = (params?.get("scene") as Scene) ?? "lineup";
  const angle = (params?.get("angle") as Angle) ?? "front";
  const [pose, setPose] = useState<Pose>("stand");
  useEffect(() => {
    const p = params?.get("pose") as Pose | null;
    if (p) setPose(p);
  }, [params]);
  const fixed = params?.get("t") != null ? Number(params.get("t")) : undefined;
  // only=courier,me 처럼 몇 사람만 세울 수 있다.
  const only = params?.get("only")?.split(",").filter((id): id is PersonId => id in CREW);
  const lineup = only && only.length > 0 ? only : LINEUP;
  const [walkTime, setWalkTime] = useState<number | undefined>(undefined);
  const timeFor = scene === "walk" ? walkTime : fixed;

  const deskSeats = useMemo(() => {
    // 모두 같은 쪽(−Z)을 보고 한 줄로 앉는다. 카메라를 뒤·옆에 두면 손이 모니터에 가리지 않는다.
    const list: { who: PersonId; pose: Pose; seat: THREE.Vector3; heading: number }[] = [
      { who: "manager", pose: "sitType", seat: new THREE.Vector3(-2.25, 0, 0.3), heading: 0 },
      { who: "me", pose: "sitType", seat: new THREE.Vector3(-0.75, 0, 0.3), heading: 0 },
      { who: "senior", pose: "sitMug", seat: new THREE.Vector3(0.75, 0, 0.3), heading: 0 },
      { who: "director", pose: "sitType", seat: new THREE.Vector3(2.25, 0, 0.3), heading: 0 },
    ];
    return list;
  }, []);

  if (!params) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#EFE7D6" }}>
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ position: [0, 3, 13], fov: 24 }}>
        <color attach="background" args={["#EFE7D6"]} />
        <hemisphereLight args={["#FFF8EC", "#B9B0A0", 0.9]} />
        <directionalLight position={[-3, 6, 5]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
          shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} />
        <directionalLight position={[4, 3, -4]} intensity={0.5} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#FBE0B2" roughness={0.75} />
        </mesh>
        <CameraRig scene={scene} angle={angle} />
        {scene === "walk" && fixed != null && <FixedClock start={fixed} onTick={setWalkTime} />}

        {scene === "lineup" && lineup.map((who, i) => {
          const seated = pose.startsWith("sit");
          return (
            <group key={who} position={[i * 0.62 - (lineup.length - 1) * 0.31, seated ? SEATED_ROOT_Y : 0, 0]} rotation-y={Math.PI}>
              <Person who={who} pose={pose} time={fixed ?? undefined} holding={{ bag: null }} />
            </group>
          );
        })}

        {scene === "desk" && deskSeats.map(({ who, pose: p, seat, heading }) => {
          const spots = deskSpots(seat, heading);
          return (
            <group key={who}>
              <LabDesk seat={seat} heading={heading} />
              <group position={[seat.x - Math.sin(heading) * 0.05, SEATED_ROOT_Y, seat.z - Math.cos(heading) * 0.05]} rotation-y={heading}>
                <Person who={who} pose={p} desk={spots} time={fixed} />
              </group>
            </group>
          );
        })}

        {scene === "poses" && POSES.map((p, i) => {
          const who = (params.get("who") as PersonId) ?? "me";
          const col = i % 7, row = Math.floor(i / 7);
          return (
            <group key={p} position={[(col - 3) * 0.95, p.startsWith("sit") ? SEATED_ROOT_Y : 0, row * 1.0]} rotation-y={Math.PI}>
              <Person who={CREW[who] ? who : "me"} pose={p} time={fixed} holding={{}} />
            </group>
          );
        })}

        {scene === "walk" && LINEUP.map((who, i) => (
          <Walker key={who} who={who} index={i} count={LINEUP.length} fixed={timeFor}
            holding={{ bag: who === "courier" ? null : "carried", box: who === "courier" }} />
        ))}
        <OrbitControls makeDefault={false} enabled={fixed == null} />
      </Canvas>
      {fixed == null && (
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 760, fontSize: 15 }}>
          {(["lineup", "desk", "walk", "poses"] as Scene[]).map((s) => (
            <a key={s} href={`?scene=${s}`} style={{ padding: "6px 10px", background: s === scene ? "#2F6B4F" : "#FFF", color: s === scene ? "#FFF" : "#222", borderRadius: 6 }}>
              {{ lineup: "줄 세우기", desk: "책상 타자", walk: "걷기", poses: "자세 모음" }[s]}
            </a>
          ))}
          {scene === "lineup" && POSES.map((p) => (
            <button key={p} onClick={() => setPose(p)} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #CCC", background: p === pose ? "#F4C534" : "#FFF" }}>
              {p}
            </button>
          ))}
          <span style={{ padding: "6px 4px", color: "#555" }}>{scene === "lineup" ? LINEUP.map((id) => CREW[id].name).join(" · ") : ""}</span>
        </div>
      )}
    </div>
  );
}
