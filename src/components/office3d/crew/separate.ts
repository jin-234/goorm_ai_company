/**
 * 캐릭터끼리 몸이 겹치지 않게 떼어 놓는다(맥 앱 StageCrew avoidance의 '비켜 걷기'를 옮김).
 * 매 프레임 모든 사람의 위치가 정해진 뒤 한 번 거친다. 상태를 쌓지 않아 같은 시각엔 늘 같은 결과다.
 * - 걷는 사람만 움직인다. 앉거나 서 있는 사람(자리·회의실·발표 자리)은 그대로 둔다.
 * - 걷는 사람은 가던 방향을 유지한 채 옆으로 비켜선다. 상대가 있는 반대편으로, 바로 앞이면 오른쪽으로.
 * - 둘 다 걸으면 반씩 비켜선다.
 */
import type { Snapshot } from "./schedule";

/** 몸 반지름 0.25m → 두 사람 사이 최소 0.5m. */
export const BODY_GAP = 0.5;

const isWalking = (s: Snapshot) => s.visible && s.pose === "walk";

/** 보는 방향(heading)의 오른쪽 단위 벡터 [x, z]. 사람의 앞은 (−sin h, −cos h). */
const rightOf = (h: number): [number, number] => [Math.cos(h), -Math.sin(h)];

/** people의 위치를 제자리에서 고친다. */
export function separate(people: Snapshot[], gap = BODY_GAP, rounds = 8): Snapshot[] {
  const visible = people.filter((p) => p.visible);
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i];
        const b = visible[j];
        const aw = isWalking(a);
        const bw = isWalking(b);
        if (!aw && !bw) continue;
        const dx = b.position[0] - a.position[0];
        const dz = b.position[2] - a.position[2];
        const d = Math.hypot(dx, dz);
        if (d >= gap) continue;
        const overlap = gap - d + 1e-3;
        const share = aw && bw ? overlap / 2 : overlap;
        for (const [m, other, sign] of [[a, b, -1], [b, a, 1]] as const) {
          if (!isWalking(m)) continue;
          const r = rightOf(m.heading);
          // 상대에서 나로 향하는 방향이 오른쪽에 가까우면 오른쪽으로, 왼쪽이면 왼쪽으로. 바로 앞·뒤면 오른쪽.
          const vx = sign * dx;
          const vz = sign * dz;
          const len = Math.hypot(vx, vz) || 1;
          let side = (vx * r[0] + vz * r[1]) / len;
          if (Math.abs(side) < 0.2) side = 1;
          const k = Math.sign(side) * share;
          m.position[0] += r[0] * k;
          m.position[2] += r[1] * k;
          // 옆으로만 비켜서는 걸로 모자라면(마주 오는 경우 등) 상대 반대쪽으로도 조금 민다.
          const ex = m.position[0] - other.position[0];
          const ez = m.position[2] - other.position[2];
          const e = Math.hypot(ex, ez);
          if (e < gap && e > 1e-6) {
            const push = (aw && bw ? (gap - e) / 2 : gap - e) + 1e-3;
            m.position[0] += (ex / e) * push;
            m.position[2] += (ez / e) * push;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return people;
}

/** 시험·디버그: 보이는 두 사람 사이의 가장 가까운 거리. */
export function closestPair(people: Snapshot[]): { d: number; a?: string; b?: string } {
  const v = people.filter((p) => p.visible);
  let best = { d: Infinity } as { d: number; a?: string; b?: string };
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
    const d = Math.hypot(v[i].position[0] - v[j].position[0], v[i].position[2] - v[j].position[2]);
    if (d < best.d) best = { d, a: `${v[i].id}(${v[i].doing})`, b: `${v[j].id}(${v[j].doing})` };
  }
  return best;
}
