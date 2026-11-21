/**
 * 사무실 사람들의 겉모습. 맥 앱(SceneKit) Crew의 색과 머리 모양을 그대로 옮기고,
 * 맥 앱에서 어색했던 곳(수염처럼 보이던 옆머리, 떠 있던 앞머리, 몸에 묻히던 사원증)은 새로 설계했다.
 *
 * 머그 색과 가방 색은 책상 위 머그·책상 옆 가방(room 쪽)과 같은 값을 쓴다.
 * 그래서 마실 때 자기 컵이 다른 색 컵으로 바뀌지 않는다. 흰 머그는 쓰지 않는다(종이컵·남의 컵처럼 보인다).
 */

export type PersonId = "director" | "manager" | "kwajang" | "daeri" | "senior" | "peerA" | "peerB" | "me" | "planner" | "designer" | "courier";

export type HairStyle =
  /** 정수리 똥머리. 김서울. */
  | "bun"
  /** 옆 가르마 짧은 머리. 팀장. */
  | "sidePart"
  /** 후드를 쓴 머리. 동기 이하준. */
  | "hoodUp"
  /** 단발. 동기 박서윤. */
  | "bob"
  /** 짧은 머리에 야구 모자. 택배 기사. */
  | "cap"
  /** 단정한 짧은 머리, 희끗함. 부장. */
  | "neat"
  /** 단발 반묶음. 과장. */
  | "halfUp"
  /** 앞머리를 세워 올린 짧은 머리. 대리. */
  | "quiff"
  /** 긴 머리를 낮게 묶음. 선배. */
  | "lowTail"
  /** 짧은 곱슬머리. AI 기획자(서비스 기획팀). */
  | "curly";

export type BagKind = "backpack" | "tote" | "briefcase";

/** 옷 위에 얹는 것들. */
export type Extra = "cardigan" | "tieSuit" | "tieShirt" | "glasses" | "hoodiePocket" | "hoodDown" | "vest" | "folder"
  /** 셔츠 깃(넥타이 없이). */
  | "collar"
  /** 왼손 메모장과 펜. 듣고 질문할 때 든다. */
  | "notepad";

export interface CrewLook {
  id: PersonId;
  name: string;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  pants: string;
  extras: Extra[];
  mugColor: string;
  bagColor: string;
  bagKind: BagKind;
  hasBadge: boolean;
  /** 사원증 줄 색. 다른 부서는 색으로 구분한다(개발팀 노랑, 기획팀 주황). */
  lanyard?: string;
  /** 사원증 카드 높이(몸통 기준). 넥타이·단추와 겹치지 않게 사람마다 다르다. */
  badgeY: number;
  /** 눈썹 기울기(도). +면 바깥 끝이 내려가 순해 보이고, −면 올라가 또렷해 보인다. */
  browTilt: number;
  /** 눈썹 굵기 배수. */
  browWeight: number;
  /** 눈 가로 길이 배수. */
  eyeWidth: number;
  /** 동작 빠르기. 사람마다 조금씩 달라야 로봇처럼 안 보인다. */
  rate: number;
  /** 동작 시작점(초). 같은 동작도 사람마다 박자가 어긋나게. */
  phase: number;
}

const SKIN = "#F9D2BC";

export const CREW: Record<PersonId, CrewLook> = {
  director: {
    id: "director", name: "부장", skin: SKIN, hair: "#8C8A86", hairStyle: "neat",
    top: "#5B6170", pants: "#4A4F5C", extras: ["tieSuit", "glasses"],
    mugColor: "#7A2E3A", bagColor: "#4A3426", bagKind: "briefcase", hasBadge: true, badgeY: 0.135,
    browTilt: -6, browWeight: 1.3, eyeWidth: 0.85, rate: 0.9, phase: 4.4,
  },
  manager: {
    id: "manager", name: "팀장", skin: SKIN, hair: "#32323A", hairStyle: "sidePart",
    top: "#8A3B4B", pants: "#3A3A44", extras: ["cardigan", "folder"],
    mugColor: "#2B3A67", bagColor: "#3A2E2A", bagKind: "briefcase", hasBadge: true, badgeY: 0.19,
    browTilt: -3, browWeight: 1.15, eyeWidth: 1, rate: 0.94, phase: 3.1,
  },
  kwajang: {
    id: "kwajang", name: "과장", skin: SKIN, hair: "#3B2A25", hairStyle: "halfUp",
    top: "#C9963A", pants: "#3A3A44", extras: ["cardigan"],
    mugColor: "#C46A4A", bagColor: "#8A5A3B", bagKind: "tote", hasBadge: true, badgeY: 0.19,
    browTilt: 4, browWeight: 0.9, eyeWidth: 1.05, rate: 1.02, phase: 0.9,
  },
  daeri: {
    id: "daeri", name: "대리", skin: SKIN, hair: "#2A2624", hairStyle: "quiff",
    top: "#8FB7DE", pants: "#3D4860", extras: ["tieShirt"],
    mugColor: "#3B78CC", bagColor: "#2B3A67", bagKind: "backpack", hasBadge: true, badgeY: 0.135,
    browTilt: -8, browWeight: 1.1, eyeWidth: 1, rate: 1.05, phase: 6.1,
  },
  senior: {
    id: "senior", name: "선배", skin: SKIN, hair: "#4A3226", hairStyle: "lowTail",
    top: "#6FB59A", pants: "#3D4860", extras: [],
    mugColor: "#6FB59A", bagColor: "#D9C2A0", bagKind: "tote", hasBadge: true, badgeY: 0.2,
    browTilt: 6, browWeight: 0.9, eyeWidth: 1.1, rate: 0.98, phase: 2.6,
  },
  peerA: {
    id: "peerA", name: "동기 이하준", skin: SKIN, hair: "#32323A", hairStyle: "hoodUp",
    top: "#7A5CC8", pants: "#3D4860", extras: ["hoodiePocket"],
    mugColor: "#2F2F38", bagColor: "#3F6B5A", bagKind: "backpack", hasBadge: true, badgeY: 0.235,
    browTilt: 2, browWeight: 1, eyeWidth: 0.95, rate: 1.07, phase: 1.7,
  },
  peerB: {
    id: "peerB", name: "동기 박서윤", skin: SKIN, hair: "#6B4630", hairStyle: "bob",
    top: "#E2594B", pants: "#3D4860", extras: ["hoodDown"],
    mugColor: "#E9B94F", bagColor: "#D9A441", bagKind: "tote", hasBadge: true, badgeY: 0.2,
    browTilt: 5, browWeight: 0.85, eyeWidth: 1.05, rate: 0.96, phase: 5.3,
  },
  me: {
    id: "me", name: "김서울", skin: SKIN, hair: "#3B2A25", hairStyle: "bun",
    top: "#3B78CC", pants: "#3D4860", extras: [],
    mugColor: "#E5603F", bagColor: "#2B3A67", bagKind: "backpack", hasBadge: true, badgeY: 0.2,
    browTilt: 3, browWeight: 0.95, eyeWidth: 1, rate: 1, phase: 0,
  },
  planner: {
    id: "planner", name: "AI 기획자", skin: SKIN, hair: "#5A3A2A", hairStyle: "curly",
    top: "#F1E6CC", pants: "#4A5A4F", extras: ["collar", "notepad"],
    mugColor: "#E07A3F", bagColor: "#6B7F5A", bagKind: "tote", hasBadge: true, badgeY: 0.2, lanyard: "#E07A3F",
    browTilt: 2, browWeight: 1, eyeWidth: 1, rate: 1.01, phase: 3.7,
  },
  // 타 부서 손님(디자인팀). 기획자와 함께 회의실에 와서 발표를 듣는다. 주황 사원증 줄로 개발팀과 구분한다.
  designer: {
    id: "designer", name: "AI 디자이너", skin: SKIN, hair: "#26222A", hairStyle: "lowTail",
    top: "#2E2E36", pants: "#6B6670", extras: ["glasses", "notepad"],
    mugColor: "#C9B8E8", bagColor: "#2E2E36", bagKind: "tote", hasBadge: true, badgeY: 0.21, lanyard: "#E07A3F",
    browTilt: 0, browWeight: 0.9, eyeWidth: 1, rate: 0.99, phase: 1.1,
  },
  courier: {
    id: "courier", name: "택배 기사", skin: "#EFC2A6", hair: "#2A2522", hairStyle: "cap",
    top: "#3E7C8C", pants: "#4A4A50", extras: ["vest"],
    mugColor: "#F4F1EA", bagColor: "#2F4F5A", bagKind: "backpack", hasBadge: false, badgeY: 0.2,
    browTilt: -2, browWeight: 1.2, eyeWidth: 0.95, rate: 1.03, phase: 2.2,
  },
};

/** 조직도 순서(부장, 팀장, 과장, 대리, 선배, 동기 둘, 나)와 택배 기사. */
export const LINEUP: PersonId[] = ["director", "manager", "kwajang", "daeri", "senior", "peerA", "peerB", "me", "planner", "designer", "courier"];
