"use client";
/**
 * 3D 사무실. 서버가 준 officeView만 보고 그린다(규칙은 다시 계산하지 않는다).
 * - 시각: view.clock.now. 다음 응답이 올 때까지 실제 시간만큼 흘려 부드럽게 움직인다.
 * - 나: view.phase.value로 자리를 정한다(출근 전=문 밖 단말기 앞, 아침보고=회의실, 수행·마감=내 자리, 공유=기획팀, off=퇴근).
 * - 활동 시간: view.profile.activityStart/End. 옛 모양(view.state.now, view.seat)도 readView가 함께 읽는다.
 * - 연출: beforeCheckIn → 다른 단계가 되면 출근 입장(onEntranceEnd), off가 되면 퇴근(onLeaveEnd),
 *   sharing이 되면 타 부서 담당자(기획팀·디자인팀 1명씩)가 들어와 회의실에 앉고 내가 발표 자리에 선다(onShareReady),
 *   sharing이 끝나면 손님은 인사하고 나가고 나는 자리로 돌아온다.
 * - 동료: crew/schedule.ts가 그 시각의 위치·자세·소품을 정한다.
 * - 장소를 누르면 카메라가 다가가고, 2D 패널이 있는 곳(door·desk·manager·meeting)은 onPlace로 알린다.
 */
import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type React from "react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { type AmbientLight, Color, type DirectionalLight, type HemisphereLight, NeutralToneMapping, Object3D, PerspectiveCamera, Vector3 } from "three";
import { CrewLayer, type CrewFrame } from "./crew/CrewLayer";
import { DOOR_X, ROOM, type SeatId } from "./crew/layout";
import { GUESTS, managerPose, reviewAt, reviewSteady, shareArrivalAt, shareEndAt, shareSteady } from "./crew/share";
import { meAt } from "./crew/schedule";
import { separate } from "./crew/separate";
import { fitShot } from "./camera";
import { type ActivityWindow, crewAt, DEFAULT_WINDOW, type DeskProps, ENTRANCE, entranceAt, leaveAt, type SeatKind, type Snapshot } from "./crew/schedule";
import { type Light, lightAt } from "./room/daylight";
import type { TaskLine } from "./room/screens";
import { type ClickPlace, type MeetingMode, Room, useDeskDefaults } from "./room/Room";

export type OfficePlace = "door" | "desk" | "manager" | "meeting" | "share";
/** doorWait: 출근 전 문 앞 클로즈업(전체 샷 대신). */
export type Focus = "overview" | "doorWait" | ClickPlace;

/**
 * Office3D가 읽는 화면 상태. 서버 OfficeView(옛 모양)와 화면 api.ts OfficeView(새 모양) 어느 쪽이든 그대로 넘기면 된다.
 * 쓰는 값: clock.now(또는 state.now), phase.value, profile.activityStart/End(또는 state.profile), seat.kind(있으면).
 */
export type Office3DView = {
  clock?: { now?: number };
  state?: { now?: number; profile?: object };
  /** { activityStart, activityEnd } (자정 기준 분)을 읽는다. 다른 필드가 있어도 된다. */
  profile?: object | null;
  phase?: { value?: string };
  seat?: object;
  day?: object | null;
};

type Window2 = { activityStart?: unknown; activityEnd?: unknown };
type SeatLike = { kind?: unknown; reason?: unknown };

export interface Office3DProps {
  view: Office3DView;
  onPlace?: (place: OfficePlace) => void;
  /** 시계 빠르기(확인 페이지용). 1이 실제 시간, 0이면 멈춤. */
  speed?: number;
  /** 처음 카메라 구도. */
  focus?: Focus;
  /** 출근 입장 연출(사원증 찍기 → 문 열림 → 자리까지 걷기 → 전체 샷)이 끝나면 부른다. */
  onEntranceEnd?: () => void;
  /** 퇴근 연출(짐 챙기기 → 가방 메고 문으로 나감 → 전체 샷)이 끝나면 부른다. */
  onLeaveEnd?: () => void;
  /** 타 부서 공유 연출에서 손님 둘이 회의실에 앉고 내가 화면 앞에 서서 발표를 시작하는 순간 부른다. */
  onShareReady?: () => void;
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
  // 타 부서 공유는 회의실에서: 손님 둘과 화면 옆의 나를 함께 본다.
  share: { target: [-4.7, 0.9, -3.2], yaw: 24, pitch: 40, distance: 14, fov: 20 },
  // 문 앞 클로즈업: 문 밖 오른쪽 앞에서 단말기 앞에 선 나와 닫힌 자동문을 본다.
  doorWait: { target: [-0.25, 1.25, 5.3], yaw: 20, pitch: 6, distance: 8.2, fov: 28 },
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

export function Office3D({ view, onPlace, speed = 1, focus: initialFocus = "overview", onEntranceEnd, onLeaveEnd, onShareReady, className, style }: Office3DProps) {
  const [focus, setFocus] = useState<Focus>(initialFocus);
  // 이름표(drei Html)를 붙일 곳을 고정한다. 지정하지 않으면 이벤트 연결 시점에 붙일 곳이 바뀌어 이름표마다 root를 다시 만든다.
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => setFocus(initialFocus), [initialFocus]);
  const handle = (place: ClickPlace) => {
    setFocus(place);
    if (place === "door" || place === "desk" || place === "manager" || place === "meeting" || place === "share") onPlace?.(place);
  };
  return (
    <div ref={host} className={className} style={{ position: "relative", width: "100%", height: "100%", ...style }} data-office3d-focus={focus}>
      <Canvas shadows dpr={[1, 2]} resize={{ offsetSize: true }} camera={{ fov: 20, near: 2, far: 160, position: shotPosition(SHOTS.overview).toArray() }} gl={{ preserveDrawingBuffer: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1.6 }}>
        <Scene view={view} speed={speed} focus={focus} onClick={handle} onEntranceStart={() => setFocus("overview")} onEntranceEnd={onEntranceEnd} onLeaveEnd={onLeaveEnd} onShareReady={onShareReady} onShareSeated={() => setFocus("share")} labelHost={host} />
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

interface SceneProps {
  view: Office3DView;
  speed: number;
  focus: Focus;
  onClick: (p: ClickPlace) => void;
  onEntranceStart: () => void;
  onEntranceEnd?: () => void;
  onLeaveEnd?: () => void;
  onShareReady?: () => void;
  onShareSeated: () => void;
  labelHost: React.RefObject<HTMLDivElement | null>;
}

/** 카메라가 지금 따라갈 구도와 빠르기(클수록 빨리 붙는다). 장면이 매 프레임 정하고 CameraRig가 읽는다. */
export type CameraAim = { shot: Focus; rate: number };

function Scene({ view, speed, focus, onClick, onEntranceStart, onEntranceEnd, onLeaveEnd, onShareReady, onShareSeated, labelHost }: SceneProps) {
  const read = readView(view);
  // 가상 시계: 서버 시각에서 실제 시간만큼 흘린다.
  const anchor = useRef({ base: read.now, at: typeof performance === "undefined" ? 0 : performance.now() });
  useEffect(() => {
    anchor.current = { base: read.now, at: performance.now() };
  }, [read.now]);
  const speedRef = useRef(speed);
  useEffect(() => {
    // 빠르기를 바꿀 때 지금 시각을 기준점으로 다시 잡는다.
    const now = anchor.current.base + (performance.now() - anchor.current.at) * speedRef.current;
    anchor.current = { base: now, at: performance.now() };
    speedRef.current = speed;
  }, [speed]);
  const nowOf = () => anchor.current.base + (performance.now() - anchor.current.at) * speedRef.current;

  const seat = read.seat;
  const tasksKey = JSON.stringify(read.tasks);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const myTasks = useMemo(() => read.tasks, [tasksKey]);
  const phase = read.phase;
  const window = read.window;
  const frame = useRef<CrewFrame | null>(null);
  // 화면에 보이는 시각(분, 실수). 서버 시각을 그대로 따르되, '다음 정각'처럼 크게 건너뛰면 2~3초에 걸쳐 따라간다.
  const shown = useRef(minuteOf(read.now));
  const lightRef = useRef<Light>(lightAt(shown.current));
  // 시계 바늘·복도등·화면 밝기처럼 분 단위면 충분한 값은 React로(바뀔 때만 다시 그림).
  const [minute, setMinute] = useState(() => Math.floor(shown.current));
  const lastMinuteSet = useRef(0);
  const defaults = useDeskDefaults();
  const [desks, setDesks] = useState<Record<SeatId, DeskProps>>(defaults);
  const deskKey = useRef("");
  const [doors, setDoors] = useState({ entrance: 0, restroom: 0 });
  const [reader, setReader] = useState(0);
  const [facade, setFacade] = useState(phase === "beforeCheckIn" ? 1 : 0);
  const [frosted, setFrosted] = useState(phase === "beforeCheckIn" ? 1 : 0);
  const [cinematic, setCinematic] = useState(false);

  // 출근 전에는 문 앞 클로즈업. 출근(단계가 beforeCheckIn에서 바뀜)하면 입장 연출을 시작한다.
  const waiting = phase === "beforeCheckIn";
  const entrance = useRef<number | null>(null);
  const leaving = useRef<number | null>(null);
  // 타 부서 공유: 들어오는 연출(arrive)과 나가는 연출(end)의 시작 시각.
  const shareArrive = useRef<number | null>(null);
  const shareEnd = useRef<number | null>(null);
  const shareReadyRef = useRef(onShareReady);
  shareReadyRef.current = onShareReady;
  // 공유 안의 진행(view.day.share.stage, 4a 최종): review·confirm 팀장 사전 보고(팀장 앞) → meeting 부서 회의 → closed.
  // 장면은 review(confirm 포함) / meeting / closed 셋으로 본다. stage가 없으면(옛 화면) sharing이면 곧바로 회의.
  const rawStage = phase === "sharing" ? (read.shareStage ?? "meeting") : null;
  const shareStage: string | null = rawStage === "confirm" ? "review" : rawStage === "minutes" || rawStage === "done" ? "closed" : rawStage;
  const speaker = read.speaker;
  const reviewStart = useRef<number | null>(null);
  const arriveFrom = useRef<"seat" | "report">("seat");
  const lastStage = useRef(shareStage);
  const [meetingMode, setMeetingMode] = useState<MeetingMode>(shareStage === "meeting" ? "share" : "morning");
  useEffect(() => {
    const prev = lastStage.current;
    if (shareStage === "review" && prev !== "review") {
      reviewStart.current = performance.now();
    } else if (shareStage === "meeting" && prev !== "meeting") {
      // 회의가 시작되면 손님이 들어오고, 나는 (팀장 보고를 했으면) 팀장 자리 앞에서 회의실로 간다.
      arriveFrom.current = prev === "review" ? "report" : "seat";
      reviewStart.current = null;
      shareArrive.current = performance.now();
      shareEnd.current = null;
      onEntranceStart();
    } else if (prev === "meeting" && shareStage !== "meeting") {
      // 회의가 끝나면(회의록 정리·완료·공유 종료) 손님이 나가고 나는 자리로.
      shareArrive.current = null;
      shareEnd.current = performance.now();
    }
    if (shareStage !== "review") reviewStart.current = shareStage === null ? null : reviewStart.current;
    lastStage.current = shareStage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareStage]);
  const lastPhase = useRef(phase);
  const endRef = useRef(onEntranceEnd);
  endRef.current = onEntranceEnd;
  const leaveEndRef = useRef(onLeaveEnd);
  leaveEndRef.current = onLeaveEnd;
  useEffect(() => {
    const prev = lastPhase.current;
    if (prev === "beforeCheckIn" && phase !== "beforeCheckIn") {
      entrance.current = performance.now();
      onEntranceStart();
    }
    if (phase === "off" && prev !== "off" && prev !== "beforeCheckIn") {
      // 하루 마감 확정: 짐을 챙겨 문으로 나간다.
      leaving.current = performance.now();
      onEntranceStart();
    }
    lastPhase.current = phase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const aim = useRef<CameraAim>({ shot: waiting ? "doorWait" : focus, rate: 4 });

  useFrame((_, dt) => {
    const now = nowOf();
    // 빛: 반올림 없이 연속 시각으로 매 프레임. 크게 건너뛰면 감쇠 보간.
    let diff = minuteOf(now) - shown.current;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    shown.current = Math.abs(diff) > 5 ? shown.current + diff * (1 - Math.exp(-dt * 1.6)) : shown.current + diff;
    shown.current = ((shown.current % 1440) + 1440) % 1440;
    lightRef.current = lightAt(shown.current);
    const whole = Math.floor(shown.current);
    if (whole !== minute && performance.now() - lastMinuteSet.current > 120) {
      lastMinuteSet.current = performance.now();
      setMinute(whole);
    }
    const crew = crewAt(now, seat, phase, window);
    let entranceDoor = false;
    let flash = 0;
    if (entrance.current != null) {
      const t = (performance.now() - entrance.current) / 1000;
      const e = entranceAt(t);
      crew.me = { snapshot: e.snapshot, desk: { ...crew.me.desk, bagAtDesk: e.done, mugOnDesk: true } };
      entranceDoor = e.doorOpen;
      flash = e.readerFlash;
      // 문이 열리기 시작하면 클로즈업이 천천히 풀리며 전체 샷으로 간다.
      aim.current = t < ENTRANCE.tap ? { shot: "doorWait", rate: 4 } : { shot: "overview", rate: 0.75 };
      // 문 앞에서는 건물 정면(앞벽을 올림). 문이 열려 걸어 들어가기 시작하면 카메라가 풀리는 것과 함께 벽이 스르륵 내려간다.
      const f = t < ENTRANCE.tap + ENTRANCE.open ? 1 : 0;
      if (f !== facade) setFacade(f);
      // 유리는 문이 열리는 순간 맑아진다.
      const g = t < ENTRANCE.tap ? 1 : 0;
      if (g !== frosted) setFrosted(g);
      if (e.done) {
        entrance.current = null;
        endRef.current?.();
      }
    } else if (leaving.current != null) {
      const t = (performance.now() - leaving.current) / 1000;
      const e = leaveAt(t);
      crew.me = { snapshot: e.snapshot, desk: { mugOnDesk: true, bagAtDesk: false, screenOn: e.phase === "pack" } };
      // 짐 챙기는 동안은 내 책상, 걸어 나갈 땐 문 쪽에서 맞이하고, 나간 뒤엔 사무실 전체로 물러난다.
      aim.current = e.phase === "pack" ? { shot: "desk", rate: 2.5 } : e.phase === "walk" ? { shot: "door", rate: 1.3 } : { shot: "overview", rate: 0.8 };
      if (e.done) {
        leaving.current = null;
        leaveEndRef.current?.();
      }
    } else {
      aim.current = waiting ? { shot: "doorWait", rate: 4 } : { shot: focus, rate: 4 };
      const f = waiting ? 1 : 0;
      if (f !== facade) setFacade(f);
      if (f !== frosted) setFrosted(f);
    }
    // 타 부서 손님(기획팀·디자인팀 담당자 1명씩).
    const clockSec = performance.now() / 1000;
    let guests: Record<string, { snapshot: Snapshot }> = {};
    if (shareStage === "review") {
      // ① 팀장 사전 보고: 팀장 자리 앞으로 가서 서서 보고. 팀장은 마지막에 자기가 말했으면 설명, 아니면 듣는다.
      const r = reviewStart.current != null ? reviewAt((performance.now() - reviewStart.current) / 1000) : { me: reviewSteady(), arrived: true };
      crew.me = { snapshot: r.me, desk: { ...crew.me.desk, screenOn: true, bagAtDesk: true } };
      const m = crew.manager.snapshot;
      if (m.visible && m.pose.startsWith("sit")) crew.manager = { ...crew.manager, snapshot: { ...m, pose: managerPose(speaker, clockSec), holding: {}, doing: "사전 보고 듣기" } };
    } else if (shareArrive.current != null) {
      const t = (performance.now() - shareArrive.current) / 1000;
      const a = shareArrivalAt(t, arriveFrom.current, speaker);
      for (const g of GUESTS) guests[g] = { snapshot: a.guests[g] };
      crew.me = { snapshot: a.me, desk: { ...crew.me.desk, screenOn: true, bagAtDesk: true } };
      // 걸어오는 동안은 사무실 전체, 내가 발표 자리에 서면 회의실로 다가간다.
      aim.current = a.ready ? { shot: "share", rate: 2 } : { shot: "overview", rate: 2 };
      if (a.ready) {
        shareArrive.current = null;
        onShareSeated();
        shareReadyRef.current?.();
      }
    } else if (shareStage === "meeting") {
      const st = shareSteady(clockSec, speaker);
      for (const g of GUESTS) guests[g] = { snapshot: st.guests[g] };
    } else if (shareEnd.current != null) {
      const t = (performance.now() - shareEnd.current) / 1000;
      const e = shareEndAt(t);
      for (const g of GUESTS) guests[g] = { snapshot: e.guests[g] };
      if (leaving.current == null) crew.me = { snapshot: e.me, desk: { ...crew.me.desk, screenOn: true, bagAtDesk: true } };
      if (e.done) shareEnd.current = null;
    } else if (shareStage === "closed") {
      // 회의 정리·회의록까지 끝: 손님은 나갔고 나는 내 자리에서 일한다.
      crew.me = meAt(now, { kind: "seated" }, "working");
    }
    const mode: MeetingMode = shareStage === "meeting" || shareEnd.current != null ? "share" : "morning";
    if (mode !== meetingMode) setMeetingMode(mode);
    const nowCinematic = waiting || entrance.current != null || leaving.current != null || shareArrive.current != null;
    if (nowCinematic !== cinematic) setCinematic(nowCinematic);
    if (flash !== reader) setReader(flash);
    // 모두의 위치가 정해진 뒤 겹치지 않게 떼어 놓는다(걷는 사람이 옆으로 비켜섬).
    const everyone = { ...crew, ...guests };
    separate(Object.values(everyone).map((e) => e.snapshot));
    frame.current = everyone;
    const nextDesks = {} as Record<SeatId, DeskProps>;
    let key = "";
    for (const id of Object.keys(crew) as SeatId[]) {
      nextDesks[id] = crew[id].desk;
      key += `${id}:${+crew[id].desk.mugOnDesk}${+crew[id].desk.bagAtDesk}${+crew[id].desk.screenOn}${+!!crew[id].desk.typing};`;
    }
    if (key !== deskKey.current) {
      deskKey.current = key;
      setDesks(nextDesks);
    }
    // 문: 사람이 가까이 오면 연다. 출근 전 단말기 앞에서 기다리는 나에게는 열리지 않는다(사원증을 찍어야 열린다).
    let door = entranceDoor ? 1 : 0;
    let restroom = 0;
    // 손님(타 부서 담당자)도 문을 지나면 자동문이 열린다.
    for (const [id, { snapshot: s }] of Object.entries(everyone)) {
      if (!s.visible) continue;
      if (id === "me" && (waiting || entrance.current != null)) continue; // 퇴근할 때는 나에게도 열린다
      if (Math.hypot(s.position[0] - DOOR_X, s.position[2] - ROOM.halfDepth) < 1.5) door = 1;
      if (Math.hypot(s.position[0] - ROOM.restroomX, s.position[2] - ROOM.restroomZ1) < 1.4) restroom = 1;
    }
    if (door !== doors.entrance || restroom !== doors.restroom) setDoors({ entrance: door, restroom });
  });

  const light = useMemo(() => lightAt(minute), [minute]);
  return (
    <>
      <Lights lightRef={lightRef} />
      <CameraRig aim={aim} />
      <Room light={light} lightRef={lightRef} minute={minute} desks={desks} doors={doors} reader={reader} facade={facade} frosted={frosted} meetingMode={meetingMode} myTasks={myTasks} onClick={onClick} />
      <CrewLayer frame={frame} labelHost={labelHost} onPick={(id) => (id === "me" ? onClick("desk") : id === "manager" ? onClick("manager") : GUESTS.includes(id as (typeof GUESTS)[number]) ? onClick("share") : undefined)} />
      {/* 이름표는 늘 붙여 두고 연출 중엔 감추기만 한다. 지웠다 다시 만들면 drei Html이 렌더 도중 떼어져 React 경고가 난다. */}
      <Labels onClick={onClick} hidden={cinematic} host={labelHost} meetingMode={meetingMode} reviewing={shareStage === "review"} focus={focus} />
    </>
  );
}

/** 화면 상태에서 3D가 쓰는 값만 꺼낸다. 옛 모양과 새 모양을 둘 다 읽는다. */
export function readView(v: Office3DView): { now: number; phase: string; seat: { kind: SeatKind; reason?: string }; window: ActivityWindow; tasks: TaskLine[]; shareStage: string | null; speaker: string | null } {
  const now = v.clock?.now ?? v.state?.now ?? Date.now();
  const phase = v.phase?.value ?? "working";
  const profile = (v.profile ?? v.state?.profile ?? undefined) as Window2 | undefined;
  const start = typeof profile?.activityStart === "number" ? profile.activityStart : DEFAULT_WINDOW.start;
  const end = typeof profile?.activityEnd === "number" ? profile.activityEnd : DEFAULT_WINDOW.end;
  const oldSeat = v.seat as SeatLike | undefined;
  let seat: { kind: SeatKind; reason?: string };
  // 자리 비움·점심은 개정판에서 빠졌다. 단계로 자리를 정하고, 옛 seat.kind가 있으면 그것을 따른다.
  if (typeof oldSeat?.kind === "string") seat = { kind: oldSeat.kind as SeatKind, reason: typeof oldSeat.reason === "string" ? oldSeat.reason : undefined };
  else if (phase === "beforeCheckIn") seat = { kind: "beforeCheckIn" };
  else if (phase === "off") seat = { kind: "off" };
  else seat = { kind: "seated" };
  // 오늘의 과제(view.day.tasks): 제목과 상태. 제출(submitted)·검토(reviewed)·완료면 체크.
  const rawTasks = (v.day as { tasks?: unknown } | null | undefined)?.tasks;
  const tasks: TaskLine[] = Array.isArray(rawTasks)
    ? rawTasks.flatMap((t) => {
        const o = t as { title?: unknown; status?: unknown; done?: unknown };
        if (typeof o?.title !== "string") return [];
        const done = o.done === true || o.status === "submitted" || o.status === "reviewed" || o.status === "done";
        return [{ title: o.title, done }];
      })
    : [];
  // 공유 진행 단계와 마지막으로 말한 동료(4a 최종: turns에서 role이 "colleague"인 마지막 턴의 dept, 팀장은 "dev_lead").
  // 앞서 정했던 turns[].speaker도 함께 읽는다.
  const share = (v.day as { share?: { stage?: unknown; turns?: unknown } } | null | undefined)?.share;
  const shareStage = typeof share?.stage === "string" ? share.stage : null;
  let speaker: string | null = null;
  if (Array.isArray(share?.turns)) {
    for (let i = share.turns.length - 1; i >= 0; i--) {
      const turn = share.turns[i] as { role?: unknown; dept?: unknown; speaker?: unknown };
      if (turn?.role === "colleague" && typeof turn.dept === "string") { speaker = turn.dept; break; }
      if (typeof turn?.speaker === "string" && turn.speaker !== "user") { speaker = turn.speaker; break; }
    }
  }
  return { now, phase, seat, window: end > start ? { start, end } : DEFAULT_WINDOW, tasks, shareStage, speaker };
}

/** 조명·배경색을 매 프레임 lightRef(연속 시각의 빛)로 맞춘다. React를 다시 그리지 않아 가볍다. */
function Lights({ lightRef }: { lightRef: React.MutableRefObject<Light> }) {
  const scene = useThree((s) => s.scene);
  const sun = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const ceiling = useRef<DirectionalLight>(null);
  const ambient = useRef<AmbientLight>(null);
  const hemi = useRef<HemisphereLight>(null);
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
  const dir = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const light = lightRef.current;
    if (!(scene.background instanceof Color)) scene.background = new Color();
    (scene.background as Color).copy(light.background);
    if (ambient.current) { ambient.current.intensity = light.ambientIntensity; ambient.current.color.copy(light.ambientColor); }
    if (hemi.current) hemi.current.intensity = 0.3 + 0.3 * light.night;
    if (sun.current) {
      // 해는 늘 같은 자리에서 방 가운데를 34m 밖에서 비춘다(기획서 4장). 방향·세기·색이 시각에 따라 이어서 바뀐다.
      dir.set(...light.sunDirection).normalize();
      sun.current.position.copy(target.position).addScaledVector(dir, -34);
      sun.current.intensity = light.sunIntensity;
      sun.current.color.copy(light.sunColor);
      sun.current.castShadow = light.sunIntensity > 0.01;
    }
    if (fill.current) { fill.current.intensity = light.fillIntensity; fill.current.color.copy(light.fillColor); }
    if (ceiling.current) ceiling.current.intensity = light.ceiling * 0.9;
  });
  return (
    <>
      <primitive object={target} />
      <primitive object={fillTarget} />
      <primitive object={ceilingTarget} />
      <ambientLight ref={ambient} />
      <hemisphereLight ref={hemi} args={["#FFF8EC", "#C9C2B4", 0.3]} />
      <directionalLight
        ref={sun}
        target={target}
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
      <directionalLight ref={fill} position={[-12, 7.5, 14]} target={fillTarget} />
      <directionalLight ref={ceiling} position={[2, 20, 4]} target={ceilingTarget} color="#FFF3DE" />
    </>
  );
}

function CameraRig({ aim }: { aim: React.MutableRefObject<CameraAim> }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const fit = useRef<{ aspect: number; shot: (typeof SHOTS)["overview"] } | null>(null);
  const fitted = (aspect: number) => {
    const key = Math.round(aspect * 100) / 100;
    if (!fit.current || fit.current.aspect !== key) fit.current = { aspect: key, shot: fitShot(SHOTS.overview, key) };
    return fit.current.shot;
  };
  const lookAt = useRef(new Vector3(...SHOTS[aim.current.shot].target));
  const placed = useRef(false);
  useFrame((_, dt) => {
    // 전체 구도는 캔버스 비율에 맞춰 사무실 전체가 늘 들어오게(오른쪽 패널이 열려 좁아져도 잘리지 않게).
    const shot = aim.current.shot === "overview" ? fitted(camera.aspect) : SHOTS[aim.current.shot];
    // 처음 한 번은 바로 그 구도에 놓는다(출근 전 화면이 전체 샷에서 날아오지 않게).
    const k = placed.current ? 1 - Math.exp(-dt * aim.current.rate) : 1;
    placed.current = true;
    camera.position.lerp(shotPosition(shot), k);
    lookAt.current.lerp(new Vector3(...shot.target), k);
    camera.fov += (shot.fov - camera.fov) * k;
    camera.updateProjectionMatrix();
    camera.lookAt(lookAt.current);
  });
  return null;
}

// 이름표도 누를 수 있다. 이름표는 물체 위 공중에 떠 있어 클릭을 통과시키면 아래에 누를 물체가 없다.
// 개정 기획서: 핵심 흐름을 여는 다섯 곳에만 이름표를 단다(탕비실·화장실·부장 자리는 눌러서 다가가기만).
// 회의실 이름표는 단계에 따라 문구와 여는 곳이 바뀐다(아침보고 → meeting, 타 부서 공유 → share). key는 고정한다.
const LABELS: { key: string; text: string; at: [number, number, number]; place: ClickPlace }[] = [
  { key: "door", text: "출입문", at: [DOOR_X, 2.65, ROOM.halfDepth], place: "door" },
  { key: "meeting-room", text: "회의실 · 아침보고", at: [-6.1, 2.6, -1.2], place: "meeting" }, // 손님 머리 위 팀 이름과 겹치지 않게 유리벽 왼쪽 위
  { key: "desk", text: "내 책상", at: [-0.9, 1.95, 2.25], place: "desk" },
  { key: "manager", text: "팀장 자리", at: [4.5, 1.75, 1.0], place: "manager" },
];

function Labels({ onClick, hidden, host, meetingMode, reviewing, focus }: { onClick: (p: ClickPlace) => void; hidden: boolean; host: React.RefObject<HTMLDivElement | null>; meetingMode: MeetingMode; reviewing: boolean; focus: Focus }) {
  // 회의실: 아침보고 때만 이름표를 띄운다. 부서 회의 중에는 손님 머리 위 팀 이름과 겹치고 굳이 필요 없어 감춘다(사용자 요청).
  // 팀장 자리: 사전 보고 중이면 공유 흐름(share)을 연다. key는 고정하고, 감출 때도 떼지 않는다(Html을 지웠다 만들면 React 경고).
  const labels = LABELS.map((l) => {
    if (l.key === "meeting-room" && meetingMode === "share") return { ...l, text: "회의실 · 부서 회의", place: "share" as ClickPlace, off: true };
    if (l.key === "manager" && reviewing) return { ...l, text: "팀장 자리 · 사전 보고", place: "share" as ClickPlace };
    return l;
  });
  return (
    <>
      {labels.map((l) => {
        // 이미 그곳을 가까이 보고 있으면 그 이름표는 감춘다(오른쪽 패널 제목과 같은 말이고, 가까이 보면 화면 끝에 걸려 잘린다).
        const here = l.place === focus || (l.key === "meeting-room" && (focus === "meeting" || focus === "share"));
        const off = hidden || here || ("off" in l && l.off === true);
        return (
          <Html key={l.key} portal={host as React.MutableRefObject<HTMLElement>} position={l.at} center zIndexRange={[10, 0]} style={{ visibility: off ? "hidden" : "visible" }}>
            <button type="button" style={labelStyle} onClick={() => onClick(l.place)} tabIndex={off ? -1 : 0} aria-hidden={off}>
              {l.text}
            </button>
          </Html>
        );
      })}
    </>
  );
}

const labelStyle: CSSProperties = {
  display: "inline-block", whiteSpace: "nowrap", padding: "3px 10px", borderRadius: 12,
  background: "rgba(251,250,245,0.92)", color: "#1F5A45", border: "1px solid #C9D3CD",
  fontSize: 13, fontWeight: 700, fontFamily: "system-ui, sans-serif", boxShadow: "0 1px 2px rgba(0,0,0,0.08)", cursor: "pointer",
};

export default Office3D;
