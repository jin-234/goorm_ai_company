"use client";
/** 사람들을 장면에 올린다. 위치는 매 프레임 직접 옮기고, 자세·소품이 바뀔 때만 다시 그린다. */
import { useFrame } from "@react-three/fiber";
import { memo, type MutableRefObject, useRef, useState } from "react";
import type { Group } from "three";
import { CREW, Person, type PersonId } from "../person";
import { SEATS, type SeatId } from "./layout";
import { deskHands, type Snapshot } from "./schedule";

/** 개발팀 자리 주인 + 타 부서 손님(공유할 때만). */
export type CrewFrame = Record<string, { snapshot: Snapshot }>;

const IDS: string[] = ["director", "manager", "kwajang", "daeri", "senior", "peerA", "peerB", "me", "planner", "designer"];

const signature = (s: Snapshot) => `${s.visible}|${s.pose}|${s.holding.cup ?? ""}|${s.holding.bag ?? ""}|${s.holding.box ?? ""}`;

/** frame.current는 바깥(Office3D)이 매 프레임 채운다. */
export function CrewLayer({ frame, onPick }: { frame: MutableRefObject<CrewFrame | null>; onPick?: (id: string) => void }) {
  return (
    <group>
      {IDS.map((id) => <Member key={id} id={id} frame={frame} onPick={onPick} />)}
    </group>
  );
}

const Member = memo(function Member({ id, frame, onPick }: { id: string; frame: MutableRefObject<CrewFrame | null>; onPick?: (id: string) => void }) {
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
      {shown && shown.visible && (
        <Person who={(id in CREW ? id : id === "designer" ? "planner" : "senior") as PersonId} pose={shown.pose} holding={shown.holding} desk={seated && id in SEATS ? deskHands(id as SeatId) : undefined} />
      )}
    </group>
  );
});
