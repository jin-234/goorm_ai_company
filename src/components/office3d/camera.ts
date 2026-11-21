/**
 * 전체 구도(overview)를 캔버스 가로세로 비율에 맞춘다. 오른쪽 패널이 열려 캔버스가 좁아져도
 * 사무실 전체(바닥 받침 테두리·출입문 앞 계단 포함)가 늘 화면 안에 들어오게, 카메라 방향(좌우각·내려다보는 각)은
 * 맥 앱 그대로 두고 거리와 바라보는 점만 조정한다.
 */
import { PerspectiveCamera, Vector3 } from "three";
import { DOOR_X, ROOM } from "./crew/layout";

export interface Shot { target: [number, number, number]; yaw: number; pitch: number; distance: number; fov: number }

/** 화면 안에 들어와야 하는 점: 바닥 받침 상자(벽 높이까지)의 8개 모서리와 출입문 앞 계단 모서리. */
export const FIT_POINTS: [number, number, number][] = (() => {
  const hw = ROOM.halfWidth + 0.25;
  const hd = ROOM.halfDepth + 0.25;
  const pts: [number, number, number][] = [];
  for (const x of [-hw, hw]) for (const z of [-hd, hd]) for (const y of [-0.38, ROOM.wallHeight]) pts.push([x, y, z]);
  // 출입문 앞 단(room/Room.tsx Entrance: 3.2 × 2.6, 문 앞으로 1.45 + 1.3)
  for (const x of [DOOR_X - 1.6, DOOR_X + 1.6]) pts.push([x, -0.12, ROOM.halfDepth + 2.75]);
  return pts;
})();

export function shotPosition(shot: Shot) {
  const yaw = (shot.yaw * Math.PI) / 180;
  const pitch = (shot.pitch * Math.PI) / 180;
  return new Vector3(
    shot.target[0] + Math.sin(yaw) * Math.cos(pitch) * shot.distance,
    shot.target[1] + Math.sin(pitch) * shot.distance,
    shot.target[2] + Math.cos(yaw) * Math.cos(pitch) * shot.distance,
  );
}

/** 이 구도·비율에서 점들이 화면(NDC −1~1)에 찍히는 범위. */
export function projectedBounds(shot: Shot, aspect: number, points = FIT_POINTS) {
  const cam = new PerspectiveCamera(shot.fov, aspect, 0.5, 400);
  cam.position.copy(shotPosition(shot));
  cam.lookAt(new Vector3(...shot.target));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const v = new Vector3();
  for (const p of points) {
    v.set(...p).project(cam);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  return { minX, maxX, minY, maxY, cam };
}

/**
 * 비율에 맞춘 전체 구도. 점들이 화면의 margin(가로·세로 각각) 안에 꽉 차게 거리를 정하고, 가운데에 오도록 바라보는 점을 옮긴다.
 * 몇 번 되풀이하면 수렴한다.
 */
export function fitShot(base: Shot, aspect: number, margin = 0.9): Shot {
  let shot: Shot = { ...base, target: [...base.target] as [number, number, number] };
  for (let i = 0; i < 6; i++) {
    const b = projectedBounds(shot, aspect);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const needX = (b.maxX - b.minX) / 2 / margin;
    const needY = (b.maxY - b.minY) / 2 / margin;
    const scale = Math.max(needX, needY);
    // 화면 가운데로: NDC 차이를 바라보는 점 거리의 화면 반폭·반높이로 바꿔 카메라 오른쪽·위쪽으로 옮긴다.
    const halfH = shot.distance * Math.tan((shot.fov * Math.PI) / 360);
    const halfW = halfH * aspect;
    const right = new Vector3().setFromMatrixColumn(b.cam.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(b.cam.matrixWorld, 1);
    const t = new Vector3(...shot.target).addScaledVector(right, cx * halfW).addScaledVector(up, cy * halfH);
    shot = { ...shot, target: [t.x, t.y, t.z], distance: shot.distance * scale };
  }
  return shot;
}
