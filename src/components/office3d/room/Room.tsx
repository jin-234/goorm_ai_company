"use client";
/** 사무실 공간: 바닥·벽·창, 자리, 회의실, 탕비실, 화장실, 출입문. 사람은 crew 쪽에서 얹는다. */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { type ReactNode, type RefObject, useMemo, useRef } from "react";
import { BackSide, Color, type Group, RepeatWrapping } from "three";
import { CREW, type PersonId } from "../person";
import { BADGE_READER, DOOR_X, headingOf, MEETING, ROOM, SEATS, type SeatId } from "../crew/layout";
import type { DeskProps } from "../crew/schedule";
import type { Light } from "./daylight";
import {
  Box, Chair, Cylinder, Desk, DeskBag, FONT, Keyboard, Monitor, Mouse, Mug, PALETTE, Panel, PaperStack, Plant,
  roundRect, signTexture, useTextTexture,
} from "./parts";

export type ClickPlace = "door" | "desk" | "manager" | "meeting" | "share" | "pantry" | "restroom" | "director";

interface RoomProps {
  light: Light;
  /** 자정에서 지난 분(시계 바늘). */
  minute: number;
  desks: Record<SeatId, DeskProps>;
  /** 출입문·화장실 문이 열린 정도 0~1. */
  doors: { entrance: number; restroom: number };
  /** 사원증 단말기 불빛(0 평소 ~ 1 찍는 순간). */
  reader?: number;
  onClick: (place: ClickPlace) => void;
}

const { halfWidth: HW, halfDepth: HD, wallHeight: WH, lowWall: LW, thickness: T } = ROOM;

/** 문이 목표(0 닫힘 ~ 1 열림)를 따라 0.4초쯤에 걸쳐 열리고 닫힌다. apply가 그 값을 노드에 입힌다. */
function useDoorMotion<T extends Group>(target: number, apply: (node: T, open: number) => void): RefObject<T | null> {
  const ref = useRef<T>(null);
  const value = useRef(target);
  useFrame((_, dt) => {
    value.current += (target - value.current) * (1 - Math.exp(-dt * 7));
    if (ref.current) apply(ref.current, value.current);
  });
  return ref;
}

function clickable(place: ClickPlace, onClick: (p: ClickPlace) => void) {
  return {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(place); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = "pointer"; },
    onPointerOut: () => { document.body.style.cursor = ""; },
  };
}

export function Room({ light, minute, desks, doors, reader = 0, onClick }: RoomProps) {
  return (
    <group>
      <Shell light={light} />
      <Floors />
      {(Object.keys(SEATS) as SeatId[]).map((id) => (
        <Station key={id} id={id} props={desks[id]} night={light.night} lamp={light.lamp} onClick={onClick} />
      ))}
      <IslandPartition />
      <MeetingRoom night={light.night} onClick={onClick} />
      <Pantry onClick={onClick} />
      <Restroom open={doors.restroom} onClick={onClick} />
      <Entrance open={doors.entrance} hall={light.hall} reader={reader} onClick={onClick} />
      <Decor minute={minute} />
    </group>
  );
}

// ─── 벽·창 ──────────────────────────────────────────────────

function Shell({ light }: { light: Light }) {
  const sky = useTextTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#" + light.sky[0].getHexString());
    g.addColorStop(0.55, "#" + light.sky[1].getHexString());
    g.addColorStop(1, "#" + light.sky[2].getHexString());
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 8, 128, [light.sky[0].getHexString(), light.sky[1].getHexString(), light.sky[2].getHexString()]);
  const winH = ROOM.windowY1 - ROOM.windowY0;
  const winD = ROOM.windowZ1 - ROOM.windowZ0;
  const panes = 6;
  return (
    <group>
      {/* 뒷벽(가득), 왼벽·앞벽(낮게 잘라 안이 보이게) */}
      <Box size={[2 * HW + T, WH, T]} at={[0, WH / 2, -HD]} color={PALETTE.cream} rough={0.95} />
      <Box size={[2 * HW + T, 0.9, T + 0.01]} at={[0, 0.45, -HD]} color={PALETTE.creamLower} rough={0.95} shadow={false} />
      <Box size={[2 * HW + T, 0.06, T + 0.04]} at={[0, 0.92, -HD]} color={PALETTE.wallCap} shadow={false} />
      <Box size={[T, LW, 2 * HD]} at={[-HW, LW / 2, 0]} color={PALETTE.creamLower} rough={0.95} />
      <Box size={[T + 0.06, 0.06, 2 * HD + 0.06]} at={[-HW, LW + 0.03, 0]} color={PALETTE.wallCap} />
      <Box size={[HW + ROOM.doorX0, LW, T]} at={[(-HW + ROOM.doorX0) / 2, LW / 2, HD]} color={PALETTE.creamLower} rough={0.95} />
      <Box size={[HW - ROOM.doorX1, LW, T]} at={[(HW + ROOM.doorX1) / 2, LW / 2, HD]} color={PALETTE.creamLower} rough={0.95} />
      <Box size={[HW + ROOM.doorX0, 0.06, T + 0.06]} at={[(-HW + ROOM.doorX0) / 2, LW + 0.03, HD]} color={PALETTE.wallCap} />
      <Box size={[HW - ROOM.doorX1, 0.06, T + 0.06]} at={[(HW + ROOM.doorX1) / 2, LW + 0.03, HD]} color={PALETTE.wallCap} />
      {/* 오른벽: 창 아래·위·양옆 */}
      <Box size={[T, ROOM.windowY0, 2 * HD]} at={[HW, ROOM.windowY0 / 2, 0]} color={PALETTE.cream} rough={0.95} />
      <Box size={[T, WH - ROOM.windowY1, 2 * HD]} at={[HW, (WH + ROOM.windowY1) / 2, 0]} color={PALETTE.cream} rough={0.95} />
      <Box size={[T, winH, ROOM.windowZ0 + HD]} at={[HW, (ROOM.windowY0 + ROOM.windowY1) / 2, (-HD + ROOM.windowZ0) / 2]} color={PALETTE.cream} rough={0.95} />
      <Box size={[T, winH, HD - ROOM.windowZ1]} at={[HW, (ROOM.windowY0 + ROOM.windowY1) / 2, (HD + ROOM.windowZ1) / 2]} color={PALETTE.cream} rough={0.95} />
      <Box size={[0.34, 0.05, winD]} at={[HW - 0.1, ROOM.windowY0 - 0.02, (ROOM.windowZ0 + ROOM.windowZ1) / 2]} color={PALETTE.white} />
      {/* 창살 */}
      {Array.from({ length: panes + 1 }, (_, i) => (
        <Box key={i} size={[0.07, winH, 0.06]} at={[HW - 0.02, (ROOM.windowY0 + ROOM.windowY1) / 2, ROOM.windowZ0 + (winD * i) / panes]} color={PALETTE.white} />
      ))}
      <Box size={[0.07, 0.06, winD]} at={[HW - 0.02, ROOM.windowY0 + winH * 0.55, (ROOM.windowZ0 + ROOM.windowZ1) / 2]} color={PALETTE.white} />
      {/* 유리: 그림자를 드리우지 않는다(햇빛은 창으로 들어온다). */}
      <mesh position={[HW, (ROOM.windowY0 + ROOM.windowY1) / 2, (ROOM.windowZ0 + ROOM.windowZ1) / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[winD, winH]} />
        <meshStandardMaterial color={light.glass} transparent opacity={0.18} roughness={0.05} />
      </mesh>
      {/* 창밖 하늘 */}
      <mesh position={[HW + 0.35, (ROOM.windowY0 + ROOM.windowY1) / 2, (ROOM.windowZ0 + ROOM.windowZ1) / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[winD + 0.3, winH + 0.2]} />
        <meshBasicMaterial map={sky ?? undefined} color={sky ? "#ffffff" : light.sky[1]} toneMapped={false} />
      </mesh>
      {/* 그림자 가림판: 창 밖 위(오른벽 바깥면)에서 햇빛이 창으로만 들게. 방 안 카메라에는 뒷면이라 안 보인다. */}
      <mesh position={[HW + 0.13, (WH + 30) / 2, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <planeGeometry args={[32, 30 - WH]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} side={BackSide} />
      </mesh>
      {/* 바닥 받침(건물 단면) */}
      <Box size={[2 * HW + 0.5, 0.35, 2 * HD + 0.5]} at={[0, -0.2, 0]} color={PALETTE.base} rough={0.95} />
    </group>
  );
}

function Floors() {
  const planks = useTextTexture((ctx, w, h) => {
    ctx.fillStyle = PALETTE.oak;
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 16; row++) {
      const y = (row * h) / 16;
      ctx.fillStyle = row % 2 ? "#D7B98C" : "#DFC296";
      ctx.fillRect(0, y, w, h / 16 - 2);
      ctx.fillStyle = "#C9AA7C";
      ctx.fillRect(0, y + h / 16 - 2, w, 2);
      const offset = (row * 137) % 256;
      for (let x = offset; x < w; x += 256) ctx.fillRect(x, y, 2, h / 16);
    }
  }, 512, 512, []);
  if (planks) { planks.wrapS = planks.wrapT = RepeatWrapping; planks.repeat.set(5, 4); }
  const tiles = useTextTexture((ctx, w, h) => {
    ctx.fillStyle = "#F1EEE6";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#DAD4C7";
    ctx.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo((i * w) / 8, 0); ctx.lineTo((i * w) / 8, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * h) / 8); ctx.lineTo(w, (i * h) / 8); ctx.stroke();
    }
  }, 256, 256, []);
  const rug = useTextTexture((ctx, w, h) => {
    ctx.fillStyle = PALETTE.rug;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = PALETTE.rugLine;
    ctx.lineWidth = 8;
    ctx.strokeRect(20, 20, w - 40, h - 40);
    ctx.lineWidth = 3;
    ctx.strokeRect(40, 40, w - 80, h - 80);
  }, 512, 256, []);
  const pantryW = ROOM.pantryX1 + HW;
  const pantryD = HD - ROOM.pantryZ0;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2 * HW, 2 * HD]} />
        <meshStandardMaterial map={planks ?? undefined} color={planks ? "#ffffff" : PALETTE.oak} roughness={0.75} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-HW + pantryW / 2, 0.004, ROOM.pantryZ0 + pantryD / 2]} receiveShadow>
        <planeGeometry args={[pantryW, pantryD]} />
        <meshStandardMaterial map={tiles ?? undefined} roughness={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.05, 0.006, ROOM.islandZ]} receiveShadow>
        <planeGeometry args={[7.6, 3.7]} />
        <meshStandardMaterial map={rug ?? undefined} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(ROOM.meetingX0 + ROOM.meetingX1) / 2, 0.005, (ROOM.meetingZ0 + ROOM.meetingZ1) / 2]} receiveShadow>
        <planeGeometry args={[ROOM.meetingX1 - ROOM.meetingX0, ROOM.meetingZ1 - ROOM.meetingZ0]} />
        <meshStandardMaterial color="#CFDCD3" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ─── 자리 ───────────────────────────────────────────────────

/** 자리 하나: 의자, 책상, 모니터, 키보드·마우스, 자기 머그, 의자 옆 가방. 자리 좌표계에서 앉은 사람은 원점에서 −Z를 본다. */
/** 자리 주인의 모습(머그·가방 색). 기획자 캐릭터가 아직 없으면 선배 모습으로 대신한다. */
export const lookOf = (id: SeatId) => CREW[id as PersonId] ?? CREW.senior;

function Station({ id, props, night, lamp, onClick }: { id: SeatId; props: DeskProps; night: number; lamp: number; onClick: (p: ClickPlace) => void }) {
  const seat = SEATS[id];
  const look = lookOf(id);
  const front = seat.deskOffset - seat.deskDepth / 2;
  const isBoss = id === "manager" || id === "director";
  const place: ClickPlace | null = id === "me" ? "desk" : id === "manager" ? "manager" : id === "director" ? "director" : id === "planner" ? "share" : null;
  const handlers = place ? clickable(place, onClick) : {};
  return (
    <group position={[seat.chair[0], 0, seat.chair[1]]} rotation={[0, headingOf(seat.facing), 0]} {...handlers}>
      <group position={[0, 0, 0.02]}>
        <Chair color={isBoss ? PALETTE.greenDark : PALETTE.green} />
      </group>
      <group position={[0, 0, -seat.deskOffset]} rotation={[0, 0, 0]}>
        <Desk width={seat.deskWidth} depth={seat.deskDepth} lamp={isBoss} lampOn={props.screenOn ? lamp : 0} drawerLeft={id === "daeri" || id === "peerB"}>
          <group position={[seat.monitorShift, 0.76, -seat.deskDepth / 2 + 0.2]}>
            <Monitor on={props.screenOn} seed={id.length * 7 + id.charCodeAt(0)} checklist={id === "me"} night={night} />
          </group>
          {id === "manager" && <group position={[-0.55, 0.76, 0.05]}><PaperStack sheets={8} /></group>}
          {id === "director" && <group position={[-0.7, 0.76, 0.1]}><PaperStack sheets={5} /></group>}
          {id === "director" && <group position={[-0.85, 0.76, -0.3]}><Plant small /></group>}
          {(id === "daeri" || id === "kwajang") && <group position={[-0.45, 0.76, 0.05]} rotation={[0, 0.2, 0]}><PaperStack sheets={4} /></group>}
          {id === "peerB" && <group position={[-0.52, 0.76, -0.18]}><Plant small /></group>}
        </Desk>
      </group>
      <group position={[0, 0.76, -(front + 0.095)]}><Keyboard /></group>
      <group position={[0.32, 0.76, -(front + 0.095)]}><Mouse /></group>
      {props.mugOnDesk && <group position={[0.52, 0.76, -(front + 0.2)]} rotation={[0, -0.6, 0]}><Mug color={look.mugColor} /></group>}
      {props.bagAtDesk && <group position={[-0.5, 0, -0.05]} rotation={[0, 0.25, 0]}><DeskBag kind={look.bagKind} color={look.bagColor} /></group>}
      {id === "me" && <MyDeskPlate depth={seat.deskDepth} offset={seat.deskOffset} />}
      {id === "planner" && <TeamSign depth={seat.deskDepth} offset={seat.deskOffset} width={seat.deskWidth} />}
      {place && (
        // 누르기 쉬운 범위: 책상과 의자, 의자 뒤 조금까지 덮는 보이지 않는 상자.
        <mesh position={[0, 0.6, -(seat.deskOffset + seat.deskDepth / 2 - 0.45) / 2]}>
          <boxGeometry args={[seat.deskWidth, 1.2, seat.deskOffset + seat.deskDepth / 2 + 0.45]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function MyDeskPlate({ depth, offset }: { depth: number; offset: number }) {
  const tex = useTextTexture(signTexture("내 자리"), 256, 96, []);
  return (
    <group position={[-0.69, 0.76, -offset]}>
      {/* 옆자리와 나누는 낮은 칸막이(책상 왼쪽 끝) */}
      <Box size={[0.03, 0.3, depth - 0.04]} at={[0, 0.15, 0]} color={PALETTE.greenLight} round={0.01} />
      <group position={[0.018, 0.2, depth / 2 - 0.2]} rotation={[0, Math.PI / 2, 0]}>
        <Panel w={0.26} h={0.1} texture={tex} emissive={0.1} />
      </group>
    </group>
  );
}

/** 기획팀 책상 앞(통로 쪽) 가장자리에 세운 부서 팻말. 다른 부서 자리임을 보여 준다. */
function TeamSign({ depth, offset, width }: { depth: number; offset: number; width: number }) {
  const tex = useTextTexture((ctx, w, h) => {
    ctx.fillStyle = "#E58B3A";
    roundRect(ctx, 0, 0, w, h, 16);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText("서비스 기획팀", w / 2, h * 0.38);
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText("다른 부서 · AI 기획자", w / 2, h * 0.75);
  }, 320, 110, []);
  // 자리 좌표계: 앉은 사람 앞이 −Z. 책상 먼 가장자리(통로 쪽)는 z = −(offset + depth/2).
  return (
    <group position={[-width / 2 + 0.32, 0.76, -(offset + depth / 2) + 0.03]} rotation={[0, Math.PI, 0]}>
      <Box size={[0.5, 0.02, 0.1]} at={[0, 0.01, 0]} color={PALETTE.charcoal} />
      <group position={[0, 0.11, 0]} rotation={[-0.12, 0, 0]}>
        <Box size={[0.48, 0.17, 0.02]} at={[0, 0, -0.012]} color="#C86F27" round={0.01} />
        <Panel w={0.46} h={0.158} texture={tex} emissive={0.12} />
      </group>
    </group>
  );
}

function IslandPartition() {
  const x0 = ROOM.islandX[2] - ROOM.islandDeskWidth / 2;
  const x1 = ROOM.islandX[0] + ROOM.islandDeskWidth / 2;
  return <Box size={[x1 - x0, 0.32, 0.035]} at={[(x0 + x1) / 2, 0.76 + 0.16, ROOM.islandZ]} color="#2F6E56" round={0.012} rough={0.95} />;
}

// ─── 회의실 ─────────────────────────────────────────────────

function Glass({ size, at }: { size: [number, number, number]; at: [number, number, number] }) {
  return (
    <mesh position={at}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#DDEFEA" transparent opacity={0.22} roughness={0.05} depthWrite={false} />
    </mesh>
  );
}

function MeetingRoom({ night, onClick }: { night: number; onClick: (p: ClickPlace) => void }) {
  const screen = useTextTexture((ctx, w, h) => {
    ctx.fillStyle = "#FBFAF5";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PALETTE.green;
    ctx.fillRect(0, 0, w, 70);
    ctx.fillStyle = "#fff";
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText("아침 PT", 28, 50);
    const rows = [["3단계", "필수 마감"], ["2단계", "당일 완료"], ["1단계", "이월 가능"]];
    rows.forEach(([tag, text], i) => {
      const y = 110 + i * 62;
      ctx.fillStyle = i === 0 ? PALETTE.green : "#CFE3D8";
      roundRect(ctx, 28, y, 110, 40, 20);
      ctx.fill();
      ctx.fillStyle = i === 0 ? "#fff" : PALETTE.green;
      ctx.font = `700 22px ${FONT}`;
      ctx.fillText(tag, 50, y + 28);
      ctx.fillStyle = "#333";
      ctx.font = `500 24px ${FONT}`;
      ctx.fillText(text, 160, y + 28);
      ctx.fillStyle = "#C9D3CD";
      ctx.fillRect(340, y + 16, 220, 8);
    });
  }, 640, 320, []);
  const { meetingX0: X0, meetingX1: X1, meetingZ0: Z0, meetingZ1: Z1, meetingDoorX0: D0, meetingDoorX1: D1 } = ROOM;
  const glassH = 2.3;
  const frame = PALETTE.green;
  const posts = [X0 + 0.05, (X0 + D0) / 2, D0, D1, X1];
  return (
    <group {...clickable("meeting", onClick)}>
      <Glass size={[D0 - X0, glassH, 0.03]} at={[(X0 + D0) / 2, glassH / 2, Z1]} />
      <Glass size={[0.03, glassH, Z1 - Z0]} at={[X1, glassH / 2, (Z0 + Z1) / 2]} />
      {posts.map((x) => <Box key={x} size={[0.06, glassH, 0.06]} at={[x, glassH / 2, Z1]} color={frame} />)}
      {[Z0 + 0.15, (Z0 + Z1) / 2].map((z) => <Box key={z} size={[0.06, glassH, 0.06]} at={[X1, glassH / 2, z]} color={frame} />)}
      <Box size={[X1 - X0, 0.06, 0.06]} at={[(X0 + X1) / 2, glassH, Z1]} color={frame} />
      <Box size={[0.06, 0.06, Z1 - Z0]} at={[X1, glassH, (Z0 + Z1) / 2]} color={frame} />
      {/* 탁자와 의자 */}
      <group position={[MEETING.table[0], 0, MEETING.table[1]]}>
        <Box size={[MEETING.tableSize[0], 0.05, MEETING.tableSize[1]]} at={[0, 0.74, 0]} color={PALETTE.white} round={0.02} rough={0.6} />
        {[-0.8, 0.8].map((x) => <Box key={x} size={[0.08, 0.72, 0.5]} at={[x, 0.36, 0]} color={PALETTE.oakDeep} />)}
      </group>
      {MEETING.chairs.map((c, i) => (
        <group key={i} position={[c.at[0], 0, c.at[1]]} rotation={[0, headingOf(c.facing), 0]}>
          <Chair />
        </group>
      ))}
      {/* 뒷벽 화면 */}
      <group position={[MEETING.screenX, 1.55, Z0 + 0.14]}>
        <Box size={[1.72, 0.98, 0.05]} at={[0, 0, -0.02]} color={PALETTE.charcoal} round={0.02} />
        <group position={[0, 0, 0.007]}>
          <Panel w={1.62} h={0.9} texture={screen} emissive={0.55 + 0.45 * (1 - night)} />
        </group>
      </group>
    </group>
  );
}

// ─── 탕비실 ─────────────────────────────────────────────────

function Pantry({ onClick }: { onClick: (p: ClickPlace) => void }) {
  const { pantryX1: PX, pantryZ0: PZ, pantryDoorZ: DZ } = ROOM;
  const wallH = LW;
  const wallX = -HW + T / 2;
  const sign = useTextTexture(signTexture("탕비실"), 320, 96, []);
  return (
    <group {...clickable("pantry", onClick)}>
      {/* 낮은 벽: 뒤, 오른쪽(출입구 양옆) */}
      <Box size={[PX + HW, wallH, 0.12]} at={[(-HW + PX) / 2, wallH / 2, PZ]} color={PALETTE.creamLower} />
      <Box size={[0.12, wallH, DZ - 0.55 - PZ]} at={[PX, wallH / 2, (PZ + DZ - 0.55) / 2]} color={PALETTE.creamLower} />
      <Box size={[0.12, wallH, HD - DZ - 0.55]} at={[PX, wallH / 2, (DZ + 0.55 + HD) / 2]} color={PALETTE.creamLower} />
      <group position={[PX + 0.065, 0.62, DZ + 1.05]} rotation={[0, Math.PI / 2, 0]}>
        <Panel w={0.86} h={0.26} texture={sign} emissive={0.08} />
      </group>
      {/* 냉장고 */}
      <group position={[wallX + 0.4, 0, 0.85]}>
        <Box size={[0.66, 1.75, 0.66]} at={[0, 0.875, 0]} color="#E9ECEA" round={0.04} rough={0.35} />
        <Box size={[0.02, 0.5, 0.04]} at={[0.34, 1.25, 0.2]} color={PALETTE.steel} metal={0.6} rough={0.3} />
      </group>
      {/* 조리대와 전자레인지 */}
      <group position={[wallX + 0.32, 0, 1.75]}>
        <Box size={[0.6, 0.85, 0.9]} at={[0, 0.425, 0]} color={PALETTE.white} round={0.02} />
        <Box size={[0.64, 0.04, 0.94]} at={[0, 0.87, 0]} color={PALETTE.oakDeep} />
        <Box size={[0.42, 0.26, 0.5]} at={[0, 1.02, 0]} color={PALETTE.graphite} round={0.02} rough={0.4} />
        <Box size={[0.01, 0.17, 0.3]} at={[0.215, 1.02, -0.05]} color="#1B1E20" rough={0.2} />
      </group>
      {/* 정수기와 종이컵 통 */}
      <group position={[wallX + 0.24, 0, 2.75]}>
        <Box size={[0.36, 1.25, 0.36]} at={[0, 0.625, 0]} color="#F4F6F5" round={0.05} rough={0.3} />
        <Box size={[0.02, 0.28, 0.22]} at={[0.18, 0.88, 0]} color="#C9D3D0" rough={0.3} />
        <Cylinder r={0.012} h={0.05} at={[0.17, 0.98, 0]} color={PALETTE.steel} metal={0.6} />
        <Cylinder r={0.045} h={0.35} at={[0.12, 0.95, 0.24]} color="#DCEFF7" rough={0.1} />
      </group>
      {/* 커피 수납장과 커피 기계, 손님용 컵 */}
      <group position={[wallX + 0.3, 0, 3.95]}>
        <Box size={[0.55, 0.87, 1.1]} at={[0, 0.435, 0]} color={PALETTE.oak} round={0.02} />
        <Box size={[0.3, 0.38, 0.28]} at={[0, 1.06, -0.25]} color={PALETTE.charcoal} round={0.03} rough={0.4} />
        <Box size={[0.12, 0.06, 0.1]} at={[0.12, 0.98, -0.25]} color={PALETTE.graphite} />
        {[0.05, 0.2, 0.35].map((z, i) => (
          <group key={z} position={[0.05, 0.87, z]}><Mug color={["#FFFFFF", "#DDE7E1", "#F3E6CF"][i]} coffee={false} /></group>
        ))}
      </group>
      {/* 간식 탁자와 걸상 */}
      <group position={[-4.9, 0, 1.0]}>
        <Cylinder r={0.32} h={0.04} at={[0, 0.72, 0]} color={PALETTE.oak} />
        <Cylinder r={0.04} h={0.7} at={[0, 0.35, 0]} color={PALETTE.greenDark} />
        {[-0.5, 0.5].map((x) => (
          <group key={x} position={[x, 0, 0.1]}>
            <Cylinder r={0.16} h={0.05} at={[0, 0.5, 0]} color={PALETTE.green} />
            <Cylinder r={0.025} h={0.48} at={[0, 0.25, 0]} color={PALETTE.steel} metal={0.5} />
          </group>
        ))}
        <Box size={[0.14, 0.06, 0.1]} at={[0.08, 0.77, -0.05]} color="#E5603F" round={0.015} />
      </group>
      <group position={[-4.1, 0, 4.5]}><Plant height={0.8} /></group>
    </group>
  );
}

// ─── 화장실 ─────────────────────────────────────────────────

function Restroom({ open, onClick }: { open: number; onClick: (p: ClickPlace) => void }) {
  const { restroomX0: X0, restroomZ1: Z1, restroomX: DX } = ROOM;
  const h = 2.4;
  const door = useDoorMotion<Group>(open, (node, v) => { node.rotation.y = v * 1.5; });
  const sign = useTextTexture(drawRestroomPictogram, 240, 160, []);
  return (
    <group {...clickable("restroom", onClick)}>
      <Box size={[0.12, h, Z1 + HD]} at={[X0, h / 2, (-HD + Z1) / 2]} color={PALETTE.cream} />
      <Box size={[DX - 0.5 - X0, h, 0.12]} at={[(X0 + DX - 0.5) / 2, h / 2, Z1]} color={PALETTE.cream} />
      <Box size={[HW - DX - 0.5, h, 0.12]} at={[(HW + DX + 0.5) / 2, h / 2, Z1]} color={PALETTE.cream} />
      <Box size={[1.0, h - 2.1, 0.12]} at={[DX, (h + 2.1) / 2, Z1]} color={PALETTE.cream} />
      {/* 안쪽: 타일 바닥과 변기(문이 열리면 보인다) */}
      <Box size={[HW - X0 - 0.12, 0.01, Z1 + HD - 0.12]} at={[(X0 + HW) / 2, 0.006, (-HD + Z1) / 2]} color="#EEF1EF" rough={0.4} shadow={false} />
      <group position={[DX, 0, -HD + T / 2 + 0.05]}>
        <Box size={[0.38, 0.4, 0.15]} at={[0, 0.66, 0.08]} color="#F7F7F4" round={0.04} rough={0.25} />
        <Box size={[0.34, 0.36, 0.3]} at={[0, 0.18, 0.3]} color="#F7F7F4" round={0.08} rough={0.25} />
        <Cylinder r={0.18} h={0.04} at={[0, 0.38, 0.32]} color="#F7F7F4" rough={0.25} />
      </group>
      {/* 지붕: 들어간 사람은 보이지 않는다. */}
      <Box size={[HW - X0 + 0.1, 0.08, Z1 + HD + 0.06]} at={[(X0 + HW) / 2, h + 0.04, (-HD + Z1) / 2]} color={PALETTE.wallCap} />
      {/* 문: 왼쪽 경첩, 사람이 지나갈 때 연다. */}
      <group ref={door} position={[DX - 0.46, 0, Z1 + 0.02]}>
        <Box size={[0.92, 2.06, 0.05]} at={[0.46, 1.04, 0]} color={PALETTE.green} round={0.015} />
        <Cylinder r={0.018} h={0.12} at={[0.82, 1.0, 0.04]} color={PALETTE.brass} metal={0.7} rough={0.3} rotation={[0, 0, Math.PI / 2]} />
      </group>
      {/* 문 옆 벽의 남녀 그림 표지판 */}
      <group position={[X0 + 0.42, 1.55, Z1 + 0.065]}>
        <Box size={[0.4, 0.28, 0.015]} at={[0, 0, -0.006]} color={PALETTE.steel} round={0.01} shadow={false} />
        <Panel w={0.38} h={0.255} texture={sign} emissive={0.12} />
      </group>
    </group>
  );
}

/** 화장실 남녀 픽토그램: 왼쪽 파란 남자(바지), 오른쪽 빨간 여자(치마), 가운데 세로줄. */
function drawRestroomPictogram(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, 0, 0, w, h, 14);
  ctx.fill();
  const person = (cx: number, color: string, skirt: boolean) => {
    ctx.fillStyle = color;
    const top = h * 0.14;
    ctx.beginPath(); ctx.arc(cx, top + 13, 13, 0, Math.PI * 2); ctx.fill(); // 머리
    // 팔
    ctx.fillRect(cx - 27, top + 32, 9, 46);
    ctx.fillRect(cx + 18, top + 32, 9, 46);
    if (skirt) {
      // 어깨 → 치마(사다리꼴)
      ctx.beginPath();
      ctx.moveTo(cx - 15, top + 30); ctx.lineTo(cx + 15, top + 30);
      ctx.lineTo(cx + 25, top + 86); ctx.lineTo(cx - 25, top + 86); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - 11, top + 86, 8, 30);
      ctx.fillRect(cx + 3, top + 86, 8, 30);
    } else {
      roundRect(ctx, cx - 16, top + 30, 32, 52, 6); ctx.fill(); // 몸
      ctx.fillRect(cx - 16, top + 78, 13, 38); // 다리
      ctx.fillRect(cx + 3, top + 78, 13, 38);
    }
  };
  person(w * 0.27, "#2F6FB8", false);
  person(w * 0.73, "#D64B4B", true);
  ctx.fillStyle = "#9AA3A0";
  ctx.fillRect(w / 2 - 2, h * 0.12, 4, h * 0.76);
}

// ─── 출입문 ─────────────────────────────────────────────────

function Entrance({ open, hall, reader, onClick }: { open: number; hall: number; reader: number; onClick: (p: ClickPlace) => void }) {
  const { doorX0: X0, doorX1: X1, doorHeight: DH } = ROOM;
  const w = X1 - X0;
  const leaf = w / 2 - 0.03;
  return (
    <group>
      <group {...clickable("door", onClick)}>
        {[X0, X1].map((x) => <Box key={x} size={[0.1, DH + 0.1, 0.26]} at={[x, (DH + 0.1) / 2, HD]} color={PALETTE.white} />)}
        <Box size={[w + 0.1, 0.12, 0.26]} at={[(X0 + X1) / 2, DH + 0.06, HD]} color={PALETTE.white} />
        {/* 미닫이 유리문 두 짝 */}
        {[-1, 1].map((side) => (
          <DoorLeaf key={side} side={side} leaf={leaf} open={open}>
            <Box size={[leaf, DH - 0.04, 0.05]} at={[0, (DH - 0.04) / 2, 0]} color={PALETTE.green} round={0.01} />
            <mesh position={[0, DH / 2, 0.03]}>
              <planeGeometry args={[leaf - 0.12, DH - 0.22]} />
              <meshStandardMaterial color="#E4F1EC" transparent opacity={0.55} roughness={0.1} />
            </mesh>
          </DoorLeaf>
        ))}
      </group>
      <BadgeReader flash={reader} />
      {/* 문 밖 단과 매트 */}
      <Box size={[3.2, 0.12, 2.6]} at={[DOOR_X, -0.06, HD + 1.45]} color="#CDBB9A" rough={0.95} />
      <Box size={[1.1, 0.012, 0.7]} at={[DOOR_X, 0.006, HD + 0.75]} color={PALETTE.green} rough={1} />
      {/* 복도등(문 안쪽 스탠드) */}
      <group position={[X1 + 1.1, 0, HD - 0.45]}>
        <Cylinder r={0.1} h={0.03} at={[0, 0.015, 0]} color={PALETTE.charcoal} />
        <Cylinder r={0.015} h={1.5} at={[0, 0.75, 0]} color={PALETTE.charcoal} />
        <mesh position={[0, 1.55, 0]}>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshStandardMaterial color={new Color("#E9E2D3").lerp(new Color("#FFE2B0"), hall)} emissive="#FFD9A0" emissiveIntensity={hall * 2.2} />
        </mesh>
      </group>
      {hall > 0.02 && <pointLight position={[X1 + 1.1, 1.7, HD - 0.75]} intensity={hall * 3.2} distance={4} decay={2} color="#FFD9A0" />}
    </group>
  );
}

/** 문 오른쪽 바깥벽의 사원증 단말기. 평소엔 초록 불, 카드를 대면 잠깐 밝아진다. */
function BadgeReader({ flash }: { flash: number }) {
  const label = useTextTexture((ctx, w, h) => {
    ctx.fillStyle = "#1E2326";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#6FD39B";
    ctx.lineWidth = 6;
    for (const r of [18, 30, 42]) { ctx.beginPath(); ctx.arc(w / 2, h * 0.42, r, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke(); }
    ctx.fillStyle = "#CFE9DA";
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("사원증", w / 2, h * 0.84);
  }, 128, 160, []);
  const [x, y, z] = BADGE_READER;
  return (
    <group position={[x, y, z]}>
      <Box size={[0.15, 0.2, 0.035]} at={[0, 0, 0]} color={PALETTE.charcoal} round={0.015} rough={0.4} />
      <mesh position={[0, 0.012, 0.0185]}>
        <planeGeometry args={[0.11, 0.135]} />
        {label ? <meshStandardMaterial map={label} emissiveMap={label} emissive="#ffffff" emissiveIntensity={0.25 + flash * 0.6} /> : <meshStandardMaterial color="#1E2326" />}
      </mesh>
      <mesh position={[0, -0.078, 0.019]}>
        <circleGeometry args={[0.011, 16]} />
        <meshStandardMaterial color="#3DDC84" emissive="#3DDC84" emissiveIntensity={0.8 + flash * 4} />
      </mesh>
      {flash > 0 && <pointLight position={[0, 0, 0.12]} intensity={0.35} distance={0.8} decay={2} color="#7CF0B0" />}
    </group>
  );
}

/** 미닫이 한 짝: 열리면 바깥쪽으로 밀린다. */
function DoorLeaf({ side, leaf, open, children }: { side: number; leaf: number; open: number; children: ReactNode }) {
  const ref = useDoorMotion<Group>(open, (node, v) => { node.position.x = DOOR_X + side * (leaf / 2 + 0.01 + v * leaf * 0.95); });
  return <group ref={ref} position={[DOOR_X + side * (leaf / 2 + 0.01), 0, HD]}>{children}</group>;
}

// ─── 꾸밈 ───────────────────────────────────────────────────

function Decor({ minute }: { minute: number }) {
  const board = useTextTexture((ctx, w, h) => {
    ctx.fillStyle = "#C8A273";
    ctx.fillRect(0, 0, w, h);
    const notes = ["#FFF6C8", "#F6D9D2", "#D9EBDD", "#DDE6F4", "#FFF6C8", "#F6D9D2"];
    notes.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(20 + (i % 3) * 110, 18 + Math.floor(i / 3) * 105, 90, 85);
      ctx.fillStyle = "#A44";
      ctx.beginPath(); ctx.arc(65 + (i % 3) * 110, 26 + Math.floor(i / 3) * 105, 5, 0, Math.PI * 2); ctx.fill();
    });
  }, 360, 230, []);
  const hourAngle = -((minute / 60) % 12) / 12 * Math.PI * 2;
  const minuteAngle = -((minute % 60) / 60) * Math.PI * 2;
  return (
    <group>
      <WallClock minute={minute} hourAngle={hourAngle} minuteAngle={minuteAngle} />
      {/* 게시판 */}
      <group position={[3.35, 1.78, -HD + T / 2 + 0.02]}>
        <Box size={[1.9, 1.15, 0.04]} at={[0, 0, 0]} color={PALETTE.oakDeep} />
        <group position={[0, 0, 0.022]}><Panel w={1.8} h={1.05} texture={board} /></group>
      </group>
      {/* 책장 */}
      <group position={[-0.75, 0, -HD + T / 2 + 0.2]}>
        {/* 앞이 트인 책장: 뒷판·옆판·위아래 판 */}
        <Box size={[1.4, 1.9, 0.03]} at={[0, 0.95, -0.165]} color={PALETTE.white} />
        <Box size={[0.04, 1.9, 0.36]} at={[-0.68, 0.95, 0]} color={PALETTE.white} />
        <Box size={[0.04, 1.9, 0.36]} at={[0.68, 0.95, 0]} color={PALETTE.white} />
        <Box size={[1.4, 0.04, 0.36]} at={[0, 1.88, 0]} color={PALETTE.white} />
        <Box size={[1.4, 0.06, 0.36]} at={[0, 0.03, 0]} color={PALETTE.white} />
        {[0.45, 0.9, 1.35].map((y) => <Box key={y} size={[1.32, 0.03, 0.34]} at={[0, y, 0.01]} color={PALETTE.oak} shadow={false} />)}
        {Array.from({ length: 18 }, (_, i) => {
          const shelf = Math.floor(i / 6);
          const colors = [PALETTE.green, "#C87650", "#E9B94F", PALETTE.white, "#7A8FB8", PALETTE.greenLight];
          return <Box key={i} size={[0.08, 0.3 - (i % 3) * 0.03, 0.24]} at={[-0.55 + (i % 6) * 0.2 + (shelf % 2) * 0.04, 0.47 + shelf * 0.45 + 0.15 - (i % 3) * 0.015, 0.03]} color={colors[(i + shelf) % 6]} shadow={false} />;
        })}
      </group>
      {/* 화분 */}
      <group position={[6.5, 0, 4.75]}><Plant height={1.25} /></group>
      <group position={[4.3, 0, -4.55]}><Plant height={1.0} /></group>
      <group position={[-2.45, 0, 4.5]}><Plant height={1.2} /></group>
      {[-2.7, 0.35, 2.3].map((z) => <group key={z} position={[HW - 0.12, ROOM.windowY0, z]}><Plant small /></group>)}
    </group>
  );
}

/**
 * 벽시계: 숫자 1~12가 적힌 시계판과 바늘, 아래에 '10:24'처럼 읽히는 시·분 칸.
 * minute은 화면의 가상 시각(view.state.now에서 흘린 값)이라 위 막대의 view.clock.hm과 같은 분을 가리킨다.
 */
function WallClock({ minute, hourAngle, minuteAngle }: { minute: number; hourAngle: number; minuteAngle: number }) {
  const face = useTextTexture((ctx, w, h) => {
    const c = w / 2;
    ctx.fillStyle = PALETTE.paper;
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PALETTE.charcoal;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(w * 0.13)}px ${FONT}`;
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      ctx.fillText(String(n), c + Math.sin(a) * c * 0.76, c - Math.cos(a) * c * 0.76 + 2);
    }
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a = (i / 60) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(c + Math.sin(a) * c * 0.93, c - Math.cos(a) * c * 0.93, 2, 0, Math.PI * 2); ctx.fill();
    }
  }, 256, 256, []);
  const whole = Math.floor(minute) % 1440;
  const hm = `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  const digits = useTextTexture((ctx, w, h) => {
    ctx.fillStyle = PALETTE.greenDark;
    roundRect(ctx, 0, 0, w, h, 14);
    ctx.fill();
    ctx.fillStyle = "#F4ECDB";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(h * 0.62)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillText(hm, w / 2, h / 2 + 3);
  }, 256, 96, [hm]);
  const z = -HD + T / 2 + 0.02;
  return (
    <group position={[1.42, 2.32, z]}>
      <Cylinder r={0.34} h={0.05} at={[0, 0, 0]} color={PALETTE.green} rotation={[Math.PI / 2, 0, 0]} segments={40} />
      <mesh position={[0, 0, 0.027]}>
        <circleGeometry args={[0.3, 40]} />
        {face ? <meshStandardMaterial map={face} roughness={0.7} /> : <meshStandardMaterial color={PALETTE.paper} />}
      </mesh>
      <group position={[0, 0, 0.034]} rotation={[0, 0, hourAngle]}><Box size={[0.03, 0.15, 0.01]} at={[0, 0.065, 0]} color={PALETTE.charcoal} shadow={false} /></group>
      <group position={[0, 0, 0.04]} rotation={[0, 0, minuteAngle]}><Box size={[0.018, 0.23, 0.01]} at={[0, 0.1, 0]} color={PALETTE.charcoal} shadow={false} /></group>
      <Cylinder r={0.02} h={0.02} at={[0, 0, 0.045]} color={PALETTE.brass} rotation={[Math.PI / 2, 0, 0]} />
      {/* 시·분 칸 */}
      <group position={[0, -0.5, 0]}>
        <Box size={[0.5, 0.2, 0.04]} at={[0, 0, 0]} color={PALETTE.green} round={0.02} />
        <mesh position={[0, 0, 0.021]}>
          <planeGeometry args={[0.46, 0.17]} />
          {digits ? <meshStandardMaterial map={digits} emissiveMap={digits} emissive="#ffffff" emissiveIntensity={0.35} roughness={0.6} /> : <meshStandardMaterial color={PALETTE.greenDark} />}
        </mesh>
      </group>
    </group>
  );
}

export function useDeskDefaults(): Record<SeatId, DeskProps> {
  return useMemo(() => {
    const all = {} as Record<SeatId, DeskProps>;
    for (const id of Object.keys(SEATS) as SeatId[]) all[id] = { mugOnDesk: true, bagAtDesk: false, screenOn: false };
    return all;
  }, []);
}

export type { ReactNode };
