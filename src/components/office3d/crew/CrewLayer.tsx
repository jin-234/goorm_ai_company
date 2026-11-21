"use client";
/** 사람들을 장면에 올린다. 위치는 매 프레임 직접 옮기고, 자세·소품이 바뀔 때만 다시 그린다. */
import { useFrame } from "@react-three/fiber";
import { memo, type MutableRefObject, useRef, useState } from "react";
import type { Group } from "three";
import { Person, type PersonId } from "../person";
import type { SeatId } from "./layout";
import { deskHands, type Snapshot } from "./schedule";

export type CrewFrame = Record<SeatId, { snapshot: Snapshot }>;

const IDS: SeatId[] = ["director", "manager", "kwajang", "daeri", "senior", "peerA", "peerB", "me"];

const signature = (s: Snapshot) => `${s.visible}|${s.pose}|${s.holding.cup ?? ""}|${s.holding.bag ?? ""}|${s.holding.box ?? ""}`;

/** frame.current는 바깥(Office3D)이 매 프레임 채운다. */
export function CrewLayer({ frame, onPick }: { frame: MutableRefObject<CrewFrame | null>; onPick?: (id: SeatId) => void }) {
  return (
    <group>
      {IDS.map((id) => <Member key={id} id={id} frame={frame} onPick={onPick} />)}
    </group>
  );
}

const Member = memo(function Member({ id, frame, onPick }: { id: SeatId; frame: MutableRefObject<CrewFrame | null>; onPick?: (id: SeatId) => void }) {
  const group = useRef<Group>(null);
  const [shown, setShown] = useState<Snapshot | null>(null);
  const last = useRef("");
  useFrame(() => {
    const s = frame.current?.[id]?.snapshot;
    if (!s) return;
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
        <Person who={id as PersonId} pose={shown.pose} holding={shown.holding} desk={seated ? deskHands(id) : undefined} />
      )}
    </group>
  );
});
