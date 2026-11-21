import { Cast } from "./models";

/** 직급. 0 부장 → 4 사원(위에서 아래 순서). */
export enum Rank {
  departmentHead = 0,
  teamLeader = 1,
  manager = 2,
  assistantManager = 3,
  staff = 4,
}

export const RANK_TITLE: Record<Rank, string> = {
  [Rank.departmentHead]: "부장",
  [Rank.teamLeader]: "팀장",
  [Rank.manager]: "과장",
  [Rank.assistantManager]: "대리",
  [Rank.staff]: "사원",
};

/** 사무실에서 앉는 자리. 팀원은 책상을 마주 붙인 '섬'(한 줄 세 자리 × 두 줄)에 앉는다. */
export type DeskSeat =
  | { kind: "departmentHead" }
  | { kind: "islandHead" }
  | { kind: "inner"; index: number }
  | { kind: "outer"; index: number };

/** 회사 사람 한 명. 나(김서울)를 뺀 모두가 AI다. */
export interface Member {
  id: string;
  name: string;
  rank: Rank;
  /** 하는 일 한 줄. 조직도에 보인다. */
  role: string;
  /** 외형 느낌. 3D 캐릭터를 만들 때 참고한다. */
  look: string;
  /** 대표 옷 색 "#RRGGBB" */
  outfit: string;
  /** 머리카락 색 "#RRGGBB" */
  hair: string;
  seat: DeskSeat;
  /** 야근하는 날이 얼마나 잦은지 0~1. */
  overtimeTendency: number;
  /** 아침 PT를 들으러 회의실에 오는지. */
  attendsMorningPT: boolean;
  /** 누구에게 보고하는지(상사의 id). 맨 위는 null. */
  reportsTo: string | null;
  /** 사람(사용자)인지. 김서울만 true. */
  isHuman: boolean;
}

export const displayName = (m: Member) => `${m.name} ${RANK_TITLE[m.rank]}`;

export const MEMBERS: Member[] = [
  {
    id: "director", name: "오진혁", rank: Rank.departmentHead,
    role: "1팀을 이끈다. 아침 PT를 듣고 한 주 방향을 정한다.",
    look: "50대 초반 남성, 희끗한 짧은 머리, 회색 정장과 남색 넥타이, 안경, 차분하고 넉넉한 인상",
    outfit: "#5B6170", hair: "#8C8A86", seat: { kind: "departmentHead" },
    overtimeTendency: 0.2, attendsMorningPT: true, reportsTo: null, isHuman: false,
  },
  {
    id: "manager", name: Cast.managerName, rank: Rank.teamLeader,
    role: "팀원의 업무를 배정하고 확인한다. 사내 메일로 공지·승인·주간 피드백을 보낸다.",
    look: "30대 후반 남성, 옆 가르마 짧은 머리, 버건디 카디건과 흰 셔츠, 서류철",
    outfit: "#8A3B4B", hair: "#32323A", seat: { kind: "islandHead" },
    overtimeTendency: 0.35, attendsMorningPT: true, reportsTo: "director", isHuman: false,
  },
  {
    id: "kwajang", name: "윤서희", rank: Rank.manager,
    role: "팀의 일정과 시간 관리를 맡는다. 업무가 밀리면 순서를 다시 잡아 준다.",
    look: "30대 중반 여성, 어깨 길이 단발을 반묶음, 겨자색 카디건, 또렷한 인상",
    outfit: "#C9963A", hair: "#3B2A25", seat: { kind: "inner", index: 0 },
    overtimeTendency: 0.5, attendsMorningPT: true, reportsTo: "manager", isHuman: false,
  },
  {
    id: "daeri", name: "강민재", rank: Rank.assistantManager,
    role: "공부 방법과 자료를 챙긴다. 막힌 과제를 작게 쪼개 준다.",
    look: "20대 후반 남성, 짧은 머리에 앞머리를 올림, 하늘색 셔츠와 남색 넥타이, 사원증",
    outfit: "#8FB7DE", hair: "#2A2624", seat: { kind: "inner", index: 1 },
    overtimeTendency: 0.55, attendsMorningPT: true, reportsTo: "kwajang", isHuman: false,
  },
  {
    id: "senior", name: "정다은", rank: Rank.staff,
    role: "1년 먼저 입사한 선배 사원. 사내 규칙과 요령을 알려 준다.",
    look: "20대 후반 여성, 긴 머리를 낮게 묶음, 민트색 니트, 큰 머그컵",
    outfit: "#6FB59A", hair: "#4A3226", seat: { kind: "inner", index: 2 },
    overtimeTendency: 0.3, attendsMorningPT: false, reportsTo: "daeri", isHuman: false,
  },
  {
    id: "peerA", name: Cast.peerNames[0], rank: Rank.staff,
    role: "입사 동기. 자격증을 준비한다.",
    look: "20대 중반 남성, 보라 후드를 씀",
    outfit: "#7A5CC8", hair: "#32323A", seat: { kind: "outer", index: 0 },
    overtimeTendency: 0.42, attendsMorningPT: false, reportsTo: "daeri", isHuman: false,
  },
  {
    id: "peerB", name: Cast.peerNames[1], rank: Rank.staff,
    role: "입사 동기. 포트폴리오를 만든다.",
    look: "20대 중반 여성, 갈색 단발, 빨간 후드",
    outfit: "#E2594B", hair: "#6B4630", seat: { kind: "outer", index: 1 },
    overtimeTendency: 0.42, attendsMorningPT: false, reportsTo: "daeri", isHuman: false,
  },
  {
    id: "me", name: "김서울", rank: Rank.staff,
    role: "나. 스스로 정한 취업 준비를 업무로 한다.",
    look: "20대 중반, 똥머리, 파란 셔츠, 사원증 노란 줄, 남색 가방",
    outfit: "#3B78CC", hair: "#3B2A25", seat: { kind: "outer", index: 2 },
    overtimeTendency: 0, attendsMorningPT: false, reportsTo: "daeri", isHuman: true,
  },
];

export const Organization = {
  members: MEMBERS,
  member: (id: string) => MEMBERS.find((m) => m.id === id) ?? null,
  /** 아침 PT를 듣는 상사들. 위 직급부터. */
  morningPTAudience: () => MEMBERS.filter((m) => m.attendsMorningPT).sort((a, b) => a.rank - b.rank),
  /** 바로 아래 사람들. */
  reports: (id: string) => MEMBERS.filter((m) => m.reportsTo === id).sort((a, b) => a.rank - b.rank),
  /** 맨 위 사람. */
  head: () => MEMBERS.find((m) => m.reportsTo == null) ?? null,
};
