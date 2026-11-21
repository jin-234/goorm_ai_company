/**
 * 사무실 사람(캐릭터) 부품. 겉모습과 자세만 맡는다. 위치·동선·일정은 crew/ 쪽에서 정한다.
 *
 * 사용 예:
 *   <group position={[x, SEATED_ROOT_Y, z]} rotation-y={heading}>
 *     <Person who="me" pose="sitType" desk={{ keyboard, mouse }} />
 *   </group>
 */
export { Person, type PersonProps } from "./Person";
export { CREW, LINEUP, type CrewLook, type PersonId, type BagKind, type HairStyle } from "./crew";
export { SEATED_ROOT_Y, SEATED_POSES, type Pose, type Holding, type Vec3 } from "./pose";
