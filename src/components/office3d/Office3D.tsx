"use client";
/**
 * 3D 사무실. 서버가 준 officeView만 보고 그린다(규칙은 다시 계산하지 않는다).
 * - 시각: view.state.now. 다음 응답이 올 때까지 실제 시간만큼 흘려 부드럽게 움직인다.
 * - 나: view.seat.kind(+자리 비움 사유), view.phase.value.
 * - 동료: crew/schedule.ts가 그 시각의 위치·자세·소품을 정한다.
 * - 장소를 누르면 카메라가 다가가고, 2D 패널이 있는 곳(door·desk·manager·meeting)은 onPlace로 알린다.
 */
import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { type DirectionalLight, NeutralToneMapping, Object3D, PerspectiveCamera, Vector3 } from "three";
import type { OfficeView } from "@/lib/server/view";
import { CrewLayer, type CrewFrame } from "./crew/CrewLayer";
import { DOOR_X, ROOM, type SeatId } from "./crew/layout";
import { crewAt, type DeskProps, type SeatKind } from "./crew/schedule";
import { lightAt } from "./room/daylight";
import { type ClickPlace, Room, useDeskDefaults } from "./room/Room";

export type OfficePlace = "door" | "desk" | "manager" | "meeting";
export type Focus = "overview" | ClickPlace;

export interface Office3DProps {
  view: OfficeView;
  onPlace?: (place: OfficePlace) => void;
  /** 시계 빠르기(확인 페이지용). 1이 실제 시간, 0이면 멈춤. */
  speed?: number;
  /** 처음 카메라 구도. */
  focus?: Focus;
  className?: string;
  style?: CSSProperties;
}

const KST = 9 * 3600_000;
const minuteOf = (now: number) => (((now + KST) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000;

/** 구도: 바라보는 점, 좌우각, 내려다보는 각, 거리, 화각(맥 앱 기획서 4장). */
const SHOTS: Record<Focus, { target: [number, number, number]; yaw: number; pitch: number; distance: number; fov: number }> = {
  overview: { target: [0.35, 0.2, 0.25], yaw: -33, pitch: 34, distance: 42, fov: 20 },
  door: { target: [-0.45, 1.3, 5.3], yaw: 14, pitch: 7, distance: 9.4, fov: 26 },
  desk: { target: [-0.6, 0.75, 1.5], yaw: -22, pitch: 47, distance: 14.5, fov: 20 },
  manager: { target: [3.7, 0.9, 1.0], yaw: -30, pitch: 30, distance: 14.5, fov: 20 },
  director: { target: [1.2, 0.9, -3.4], yaw: -20, pitch: 34, distance: 15, fov: 20 },
  meeting: { target: [-4.6, 0.9, -3.1], yaw: 24, pitch: 40, distance: 15, fov: 20 },
  pantry: { target: [-5.6, 0.8, 2.4], yaw: 62, pitch: 38, distance: 12, fov: 22 },
  restroom: { target: [5.6, 1.0, -3.0], yaw: -25, pitch: 30, distance: 14, fov: 20 },
};

function shotPosition(shot: (typeof SHOTS)[Focus]) {
  const yaw = (shot.yaw * Math.PI) / 180;
  const pitch = (shot.pitch * Math.PI) / 180;
  return new Vector3(
    shot.target[0] + Math.sin(yaw) * Math.cos(pitch) * shot.distance,
    shot.target[1] + Math.sin(pitch) * shot.distance,
    shot.target[2] + Math.cos(yaw) * Math.cos(pitch) * shot.distance,
  );
}

export function Office3D({ view, onPlace, speed = 1, focus: initialFocus = "overview", className, style }: Office3DProps) {
  const [focus, setFocus] = useState<Focus>(initialFocus);
  useEffect(() => setFocus(initialFocus), [initialFocus]);
  const handle = (place: ClickPlace) => {
    setFocus(place);
    if (place === "door" || place === "desk" || place === "manager" || place === "meeting") onPlace?.(place);
  };
  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%", ...style }} data-office3d-focus={focus}>
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 20, near: 2, far: 160, position: shotPosition(SHOTS.overview).toArray() }} gl={{ preserveDrawingBuffer: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1.15 }}>
        <Scene view={view} speed={speed} focus={focus} onClick={handle} />
      </Canvas>
      {focus !== "overview" && (
        <button type="button" onClick={() => setFocus("overview")} style={overviewButton}>
          전체 보기
        </button>
      )}
    </div>
  );
}

const overviewButton: CSSProperties = {
  position: "absolute", right: 16, bottom: 16, height: 38, padding: "0 16px", borderRadius: 19,
  border: "1px solid #C9D3CD", background: "#FBFAF5", color: "#1F5A45", fontSize: 15, fontWeight: 600, cursor: "pointer",
};

function Scene({ view, speed, focus, onClick }: { view: OfficeView; speed: number; focus: Focus; onClick: (p: ClickPlace) => void }) {
  // 가상 시계: 서버 시각에서 실제 시간만큼 흘린다.
  const anchor = useRef({ base: view.state.now, at: typeof performance === "undefined" ? 0 : performance.now() });
  useEffect(() => {
    anchor.current = { base: view.state.now, at: performance.now() };
  }, [view.state.now]);
  const speedRef = useRef(speed);
  useEffect(() => {
    // 빠르기를 바꿀 때 지금 시각을 기준점으로 다시 잡는다.
    const now = anchor.current.base + (performance.now() - anchor.current.at) * speedRef.current;
    anchor.current = { base: now, at: performance.now() };
    speedRef.current = speed;
  }, [speed]);
  const nowOf = () => anchor.current.base + (performance.now() - anchor.current.at) * speedRef.current;

  const seat = view.seat as { kind: SeatKind; reason?: string };
  const phase = view.phase.value;
  const frame = useRef<CrewFrame | null>(null);
  const [minute, setMinute] = useState(() => Math.round(minuteOf(view.state.now) * 4) / 4);
  const defaults = useDeskDefaults();
  const [desks, setDesks] = useState<Record<SeatId, DeskProps>>(defaults);
  const deskKey = useRef("");
  const [doors, setDoors] = useState({ entrance: 0, restroom: 0 });

  useFrame(() => {
    const now = nowOf();
    const crew = crewAt(now, seat, phase);
    frame.current = crew;
    const m = Math.round(minuteOf(now) * 4) / 4;
    if (m !== minute) setMinute(m);
    const nextDesks = {} as Record<SeatId, DeskProps>;
    let key = "";
    for (const id of Object.keys(crew) as SeatId[]) {
      nextDesks[id] = crew[id].desk;
      key += `${id}:${+crew[id].desk.mugOnDesk}${+crew[id].desk.bagAtDesk}${+crew[id].desk.screenOn};`;
    }
    if (key !== deskKey.current) {
      deskKey.current = key;
      setDesks(nextDesks);
    }
    // 문: 사람이 가까이 오면 연다.
    let entrance = 0;
    let restroom = 0;
    for (const { snapshot: s } of Object.values(crew)) {
      if (!s.visible) continue;
      if (Math.hypot(s.position[0] - DOOR_X, s.position[2] - ROOM.halfDepth) < 1.5) entrance = 1;
      if (Math.hypot(s.position[0] - ROOM.restroomX, s.position[2] - ROOM.restroomZ1) < 1.4) restroom = 1;
    }
    if (entrance !== doors.entrance || restroom !== doors.restroom) setDoors({ entrance, restroom });
  });

  const light = useMemo(() => lightAt(minute), [minute]);
  return (
    <>
      <color attach="background" args={[light.background]} />
      <Lights light={light} />
      <CameraRig focus={focus} />
      <Room light={light} minute={minute} desks={desks} doors={doors} onClick={onClick} />
      <CrewLayer frame={frame} onPick={(id) => (id === "me" ? onClick("desk") : id === "manager" ? onClick("manager") : undefined)} />
      <Labels onClick={onClick} />
    </>
  );
}

function Lights({ light }: { light: ReturnType<typeof lightAt> }) {
  const sun = useRef<DirectionalLight>(null);
  const target = useMemo(() => {
    const o = new Object3D();
    o.position.set(0.3, 1.0, 0.6);
    return o;
  }, []);
  const fillTarget = useMemo(() => {
    const o = new Object3D();
    o.position.set(1, 0.5, -1);
    return o;
  }, []);
  const ceilingTarget = useMemo(() => {
    const o = new Object3D();
    o.position.set(0.3, 0, 0.3);
    return o;
  }, []);
  const d = new Vector3(...light.sunDirection).normalize();
  const sunPos = target.position.clone().addScaledVector(d, -34);
  return (
    <>
      <primitive object={target} />
      <primitive object={fillTarget} />
      <primitive object={ceilingTarget} />
      <ambientLight intensity={light.ambientIntensity} color={light.ambientColor} />
      <hemisphereLight args={[light.sky[1], "#C9C2B4", 0.45]} />
      {light.sunIntensity > 0.01 && (
        <directionalLight
          ref={sun}
          position={sunPos.toArray()}
          target={target}
          intensity={light.sunIntensity}
          color={light.sunColor}
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          shadow-camera-near={1}
          shadow-camera-far={90}
        />
      )}
      <directionalLight position={[-12, 7.5, 14]} target={fillTarget} intensity={light.fillIntensity} color={light.fillColor} />
      {light.ceiling > 0.01 && <directionalLight position={[2, 20, 4]} target={ceilingTarget} intensity={light.ceiling * 0.9} color="#FFF3DE" />}
    </>
  );
}

function CameraRig({ focus }: { focus: Focus }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const lookAt = useRef(new Vector3(...SHOTS.overview.target));
  useFrame((_, dt) => {
    const shot = SHOTS[focus];
    const k = 1 - Math.exp(-dt * 4);
    camera.position.lerp(shotPosition(shot), k);
    lookAt.current.lerp(new Vector3(...shot.target), k);
    camera.fov += (shot.fov - camera.fov) * k;
    camera.updateProjectionMatrix();
    camera.lookAt(lookAt.current);
  });
  return null;
}

// 이름표도 누를 수 있다. 이름표는 물체 위 공중에 떠 있어 클릭을 통과시키면 아래에 누를 물체가 없다.
const LABELS: { text: string; at: [number, number, number]; place: ClickPlace }[] = [
  { text: "회의실", at: [-4.6, 2.55, -1.2], place: "meeting" },
  { text: "탕비실", at: [-5.3, 1.35, 0.2], place: "pantry" },
  { text: "화장실", at: [6.0, 2.75, -3.4], place: "restroom" },
  { text: "출입문", at: [DOOR_X, 2.65, ROOM.halfDepth], place: "door" },
  { text: "내 자리", at: [-0.9, 1.95, 2.25], place: "desk" },
  { text: "팀장", at: [4.5, 1.65, 1.0], place: "manager" },
  { text: "부장", at: [1.2, 1.65, -4.2], place: "director" },
];

function Labels({ onClick }: { onClick: (p: ClickPlace) => void }) {
  return (
    <>
      {LABELS.map((l) => (
        <Html key={l.text} position={l.at} center zIndexRange={[10, 0]}>
          <button type="button" style={labelStyle} onClick={() => onClick(l.place)}>
            {l.text}
          </button>
        </Html>
      ))}
    </>
  );
}

const labelStyle: CSSProperties = {
  display: "inline-block", whiteSpace: "nowrap", padding: "3px 10px", borderRadius: 12,
  background: "rgba(251,250,245,0.92)", color: "#1F5A45", border: "1px solid #C9D3CD",
  fontSize: 13, fontWeight: 700, fontFamily: "system-ui, sans-serif", boxShadow: "0 1px 2px rgba(0,0,0,0.08)", cursor: "pointer",
};

export default Office3D;
