/**
 * 사내 메일 문구. 실행을 돕는 안내가 중심이고, 근태 메일은 참여자가 고른 관리 강도(보통·엄격)에서만 보낸다.
 * 회사와 동료는 가상 역할이며, 실제 고용·근무 경력이 아님을 밝힌다(개정 기획서 4.2).
 */
import {
  type Allowance,
  Cast,
  type EmployeeProfile,
  type Mail,
  newMail,
  TASK_LEVEL_LABEL,
  TASK_OUTCOME_LABEL,
  type WorkTask,
} from "./models";
import { ENFORCEMENT, type EnforcementLevel, type MonthStats, WorkRules } from "./rules";
import { type DayKey, type Instant, Clock, hm, koreanShort } from "./time";

/** 강도마다 무엇을 기록하는지 한 덩어리로. 입사 메일과 강도 변경 안내가 같이 쓴다. */
export function enforcementLines(level: EnforcementLevel, profile: EmployeeProfile): string[] {
  const info = ENFORCEMENT[level];
  const lines = [`관리 강도: ${info.label}`, info.summary];
  if (info.attendance) {
    lines.push(`· ${Clock.hm(profile.activityStart)}보다 늦게 출근하면 지각, ${Clock.hm(profile.activityEnd)}까지 출근하지 않으면 결근 후보로 기록합니다.`);
    lines.push("· 미리 알린 쉬는 날은 결근 후보로 세지 않습니다.");
  }
  if (info.seatCheck) lines.push("· 근무 중 착석을 확인합니다. 점심 1시간과 자리 비움(건당 15분)은 등록하면 확인을 쉽니다.");
  if (info.checkoutAndOvertime) {
    const dinnerEnd = profile.activityEnd + WorkRules.dinnerMinutes;
    lines.push(
      `· ${Clock.hm(profile.activityEnd)}에 퇴근 점검을 합니다. 2·3단계 과제가 남으면 저녁시간 뒤 ${Clock.hm(dinnerEnd)}~${Clock.hm(dinnerEnd + WorkRules.overtimeMinutes)} 추가근무를 합니다.`,
    );
  }
  if (info.earlyLeaveReason) lines.push("· 마감 시각 전에 마감하려면 사유를 적습니다.");
  if (!info.attendance) lines.push("· 지각·착석 확인·추가근무가 없습니다. 언제든 마감할 수 있습니다.");
  lines.push("· 강도는 설정에서 언제든 바꿉니다.");
  return lines;
}

const statsLine = (stats: MonthStats) =>
  `이번 달 지각 ${stats.late}회, 결근 후보 ${stats.absent}회입니다.`;

const join = (lines: string[]) => lines.join("\n");

export const MailTemplates = {
  welcome(profile: EmployeeProfile, at: Instant): Mail {
    const body = join([
      `${profile.name} 님, ${Cast.companyName}에 오신 것을 환영합니다.`,
      "",
      "이곳은 취업 준비 활동을 돕는 가상회사입니다.",
      "회사·팀장·동료는 모두 가상 역할이며, 실제 고용이나 근무 경력이 아닙니다.",
      "",
      profile.targetRole.trim() ? `희망 직무: ${profile.targetRole.trim()}` : "희망 직무: 아직 정하지 않음",
      `활동 시간: ${Clock.hm(profile.activityStart)}~${Clock.hm(profile.activityEnd)} (직접 정한 시간이며 강제하지 않습니다)`,
      "",
      "하루 흐름",
      "1. 출근 버튼으로 활동을 시작합니다.",
      `2. 아침보고에서 ${Cast.managerName} 팀장(AI)과 오늘 끝낼 작은 범위와 완료 기준을 정합니다.`,
      "3. 수행하고 결과물(글·코드·링크)을 제출합니다.",
      `4. 회의실에서 오늘 한 일을 발표합니다. ${Cast.plannerTeam}·디자인팀·운영팀 담당자(AI)가 듣고, ${Cast.plannerName}(AI)이 필요한 것을 묻습니다.`,
      "5. 하루 마감에서 요약을 확인·수정하고 다음 행동을 정합니다.",
      "",
      "미완료는 범위 조정·다음 활동일 이월·오늘 종료 중에서 고르며, 사유 입력은 선택입니다.",
      "",
      ...enforcementLines(profile.enforcement, profile),
      "",
      "착석 확인은 지금은 버튼으로 알립니다. 카메라를 쓰게 되면 영상은 브라우저 안에서만 판정하고 서버에는 '자리에 있음·없음·카메라 꺼짐'과 시각만 남깁니다.",
      "",
      "AI 동료에게 보내는 글과 제출물은 응답을 만들기 위해 서버와 AI 제공사로 전송될 수 있습니다.",
      "비밀키·고객 정보·비공개 회사 코드는 제출하지 마세요.",
      "링크를 적으면 주소만 기록하고, 본문을 읽은 것으로 취급하지 않습니다.",
    ]);
    return newMail({ sentAt: at, from: "hr", to: "me", kind: "welcome", subject: `[안내] ${Cast.companyName} 입사와 하루 흐름`, body });
  },

  morningNotice(day: DayKey, profile: EmployeeProfile, carried: WorkTask[], at: Instant): Mail {
    const lines = [
      `${koreanShort(day)} 활동 안내입니다.`,
      "",
      `출근하면 회의실에서 아침보고로 오늘 끝낼 범위를 함께 정합니다.`,
      `직접 정한 활동 시간은 ${Clock.hm(profile.activityStart)}~${Clock.hm(profile.activityEnd)}입니다.`,
    ];
    if (ENFORCEMENT[profile.enforcement].attendance) {
      lines.push(`관리 강도 ${ENFORCEMENT[profile.enforcement].label}: ${Clock.hm(profile.activityStart)}까지 출근해 주세요.`);
    }
    if (carried.length > 0) {
      lines.push("", `지난 활동일에서 이월한 과제 ${carried.length}건이 오늘 목록에 함께 들어갑니다.`);
      for (const t of carried) lines.push(`· ${t.title} (이월 ${t.carryCount}회)`);
    }
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "notice", subject: `[공지] ${koreanShort(day)} 활동 안내`, body: join(lines) });
  },

  /** 쉰 날 다음에 돌아온 날의 아침 안내. 며칠 빠졌는지는 강조하지 않는다. */
  returnWelcome(day: DayKey, profile: EmployeeProfile, carried: WorkTask[], at: Instant): Mail {
    const lines = [
      `${profile.name} 님, 다시 와서 반갑습니다.`,
      "",
      "쉬어 간 날이 있어도 괜찮습니다. 오늘부터 다시 이어 가면 됩니다.",
      "오늘은 한 건만 작게 정해 시작해도 충분합니다.",
    ];
    if (ENFORCEMENT[profile.enforcement].attendance) lines.push("", "돌아온 오늘은 늦게 출근해도 지각으로 세지 않습니다.");
    if (carried.length > 0) {
      lines.push("", `이어서 할 수 있는 과제 ${carried.length}건이 있습니다. 아침보고에서 범위를 줄여도 됩니다.`);
      for (const t of carried) lines.push(`· ${t.title}`);
    }
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "returnWelcome", subject: `[안내] 다시 오신 것을 환영합니다`, body: join(lines) });
  },

  lateRecorded(checkIn: Instant, profile: EmployeeProfile, stats: MonthStats, at: Instant): Mail {
    const body = join([
      `출근 시각은 ${hm(checkIn)}입니다.`,
      `기준 시각(${Clock.hm(profile.activityStart)})보다 늦어 지각으로 기록합니다.`,
      "",
      statsLine(stats),
    ]);
    return newMail({ sentAt: at, from: "hr", to: "me", kind: "attendance", subject: `[근태] 지각 기록 ${hm(checkIn)}`, body });
  },

  absentCandidate(day: DayKey, profile: EmployeeProfile, stats: MonthStats, at: Instant): Mail {
    const body = join([
      `${koreanShort(day)} ${Clock.hm(profile.activityEnd)}까지 출근 기록이 없어 결근 후보로 기록합니다.`,
      "",
      statsLine(stats),
      "",
      "다음 활동일에 돌아오면 그날은 늦어도 지각으로 세지 않습니다.",
      "쉬어야 하는 날은 출입문에서 '오늘은 쉬는 날'을 미리 눌러 두면 결근 후보로 세지 않습니다.",
    ]);
    return newMail({ sentAt: at, from: "hr", to: "me", kind: "attendance", subject: `[근태] 결근 후보 기록 ${koreanShort(day)}`, body });
  },

  lunchRequest(name: string, at: Instant): Mail {
    const body = join(["점심을 요청합니다.", `요청 시각은 ${hm(at)}입니다.`, "", `${name} 드림`]);
    return newMail({ sentAt: at, from: "me", to: "manager", kind: "lunchRequest", subject: `[근태] 점심 요청 ${hm(at)}`, body, isRead: true });
  },

  lunchApproval(allowance: Allowance, at: Instant): Mail {
    const body = join([
      "점심 요청을 승인합니다.",
      "",
      `허용 시간은 ${hm(allowance.start)}부터 ${hm(allowance.end)}까지입니다.`,
      "이 시간에는 착석 확인을 쉽니다.",
    ]);
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "lunchApproval", subject: `[근태] 점심 승인 ${hm(allowance.start)}~${hm(allowance.end)}`, body });
  },

  overtimeAssigned(tasks: WorkTask[], dinner: [Instant, Instant], overtime: [Instant, Instant], at: Instant): Mail {
    const lines = [
      `2·3단계 과제 ${tasks.length}건이 아직 제출되지 않았습니다.`,
      "",
      `저녁시간은 ${hm(dinner[0])}~${hm(dinner[1])}입니다.`,
      `추가근무는 ${hm(overtime[0])}~${hm(overtime[1])}입니다. 3단계 과제부터 진행합니다.`,
      "",
      ...tasks.map((t) => `· ${TASK_LEVEL_LABEL[t.level].split(" ")[0]} | ${t.title}`),
      "",
      "끝나면 회의실 발표와 하루 마감으로 이어 갑니다.",
    ];
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "overtimeAssigned", subject: `[근태] 추가근무 배정 ${hm(overtime[0])}~${hm(overtime[1])}`, body: join(lines) });
  },

  overtimeResult(done: boolean, remaining: WorkTask[], at: Instant): Mail {
    const lines = done
      ? ["추가근무 대상 과제를 모두 제출했습니다.", "", "회의실 발표와 하루 마감으로 이어 가 주세요."]
      : [
          "추가근무 시간이 끝났습니다.",
          `아직 남은 과제 ${remaining.length}건은 하루 마감에서 처리를 골라 주세요.`,
          "",
          ...remaining.map((t) => `· ${t.title}`),
        ];
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "overtimeResult", subject: `[근태] 추가근무 종료 확인 ${hm(at)}`, body: join(lines) });
  },

  supplementMissed(remaining: WorkTask[], overtimeEnd: Instant, at: Instant): Mail {
    const lines = [
      `추가근무 종료 시각 ${hm(overtimeEnd)} 전에 추가근무를 끝냈습니다.`,
      "보충근무 미이행으로 기록합니다.",
      "",
      `남은 과제 ${remaining.length}건은 하루 마감에서 처리를 골라 주세요.`,
      ...remaining.map((t) => `· ${t.title}`),
    ];
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "supplementMissed", subject: `[근태] 보충근무 미이행 기록 ${hm(at)}`, body: join(lines) });
  },

  tasksConfirmed(tasks: WorkTask[], at: Instant, withLevels = false): Mail {
    const lines = ["오늘 끝낼 과제를 확정했습니다.", ""];
    tasks.forEach((t, i) => {
      lines.push(`${i + 1}. ${withLevels ? `[${t.level}단계] ` : ""}${t.title}${t.carriedFrom ? " (이월)" : ""}`);
      lines.push(`   완료 기준: ${t.completionCriteria}`);
      if (t.shareForm.trim()) lines.push(`   공유 형태: ${t.shareForm}`);
    });
    lines.push("", "범위가 맞지 않으면 마감 때 조정할 수 있습니다.");
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "tasksConfirmed", subject: `[업무] 오늘 과제 ${tasks.length}건 확정`, body: join(lines) });
  },

  dayClosed(day: DayKey, tasks: WorkTask[], nextAction: string, at: Instant): Mail {
    const submitted = tasks.filter((t) => t.outcome == null);
    const others = tasks.filter((t) => t.outcome != null);
    const lines = [`${koreanShort(day)} 하루 마감을 확인했습니다.`, ""];
    lines.push(`해낸 일 ${submitted.length}건`);
    for (const t of submitted) lines.push(`· ${t.title}`);
    if (others.length > 0) {
      lines.push("", "제출하지 못한 과제");
      for (const t of others) lines.push(`· ${t.title} → ${TASK_OUTCOME_LABEL[t.outcome!]}`);
    }
    if (nextAction.trim()) lines.push("", `다음 행동: ${nextAction.trim()}`);
    lines.push("", "오늘도 기록을 남겨 주셔서 고맙습니다.");
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "dayClosed", subject: `[업무] ${koreanShort(day)} 마감 확인`, body: join(lines) });
  },

};
