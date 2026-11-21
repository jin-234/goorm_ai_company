"use client";
/** 사람들을 장면에 올린다. 위치는 매 프레임 직접 옮기고, 자세·소품이 바뀔 때만 다시 그린다. */
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { type CSSProperties, memo, type MutableRefObject, type RefObject, useRef, useState } from "react";
import type { Group } from "three";
import { CREW, Person, type PersonId } from "../person";
import { SEATS, type SeatId } from "./layout";
import { deskHands, type Snapshot } from "./schedule";
import { DEPT_OF, GUESTS, type GuestId } from "./share";

const deptChip: CSSProperties = {
  display: "inline-block", whiteSpace: "nowrap", padding: "2px 9px", borderRadius: 11,
  background: "rgba(251,250,245,0.94)", color: "#C86F27", border: "1px solid #E9C9A8",
  fontSize: 12, fontWeight: 700, fontFamily: "system-ui, sans-serif", boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
};

/** 개발팀 자리 주인 + 타 부서 손님(공유할 때만). */
export type CrewFrame = Record<string, { snapshot: Snapshot }>;

const IDS: string[] = ["director", "manager", "kwajang", "daeri", "senior", "peerA", "peerB", "me", "planner", "designer", "operations"];

const signature = (s: Snapshot) => `${s.visible}|${s.pose}|${s.holding.cup ?? ""}|${s.holding.bag ?? ""}|${s.holding.box ?? ""}`;

/** frame.current는 바깥(Office3D)이 매 프레임 채운다. */
export function CrewLayer({ frame, onPick, labelHost }: { frame: MutableRefObject<CrewFrame | null>; onPick?: (id: string) => void; labelHost: RefObject<HTMLDivElement | null> }) {
  return (
    <group>
      {IDS.map((id) => <Member key={id} id={id} frame={frame} onPick={onPick} labelHost={labelHost} />)}
    </group>
  );
}

const Member = memo(function Member({ id, frame, onPick, labelHost }: { id: string; frame: MutableRefObject<CrewFrame | null>; onPick?: (id: string) => void; labelHost: RefObject<HTMLDivElement | null> }) {
  const dept = DEPT_OF[id as GuestId];
  const group = useRef<Group>(null);
  const [shown, setShown] = useState<Snapshot | null>(null);
  const last = useRef("");
  useFrame(() => {
    const s = frame.current?.[id]?.snapshot;
    if (!s) {
      // 손님은 공유할 때만 frame에 있다. 없으면 감춘다.
      if (group.current) group.current.visible = false;
      if (last.current !== "") { last.current = ""; setShown(null); }
      return;
    }
    if (group.current) {
      group.current.position.set(s.position[0], s.position[1], s.position[2]);
      group.current.rotation.y = s.heading;
      group.current.visible = s.visible;
    }
    const sig = signature(s);
    if (sig !== last.current) {
      last.current = sig;
      setShown(s);
    }
  });
  const seated = shown?.pose.startsWith("sit") ?? false;
  return (
    <group ref={group} name={`person.${id}`} onClick={onPick ? (e) => { e.stopPropagation(); onPick(id); } : undefined}>
      {dept && (
        // 타 부서 손님 머리 위 팀 이름(들어올 때부터 나갈 때까지 따라다님). 늘 붙여 두고 감추기만 한다(Html을 지웠다 만들면 React 경고).
        <Html portal={labelHost as MutableRefObject<HTMLElement>} position={[0, (shown?.pose.startsWith("sit") ? 1.05 : 1.32), 0]} center zIndexRange={[9, 0]} style={{ visibility: shown?.visible ? "visible" : "hidden", pointerEvents: "none" }}>
          <span style={deptChip}>{dept}</span>
        </Html>
      )}
      {shown && shown.visible && (
        <Person who={(id in CREW ? id : GUESTS.includes(id as GuestId) ? "planner" : "senior") as PersonId} pose={shown.pose} holding={shown.holding} desk={seated && id in SEATS ? deskHands(id as SeatId) : undefined} />
      )}
    </group>
  );
});
