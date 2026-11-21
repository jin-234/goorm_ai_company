/**
 * 사내 메일 문구. 감시·처벌 대신 실행을 돕는 안내만 보낸다.
 * 회사와 동료는 가상 역할이며, 실제 고용·근무 경력이 아님을 밝힌다(개정 기획서 4.2).
 */
import {
  Cast,
  type EmployeeProfile,
  type Mail,
  newMail,
  TASK_OUTCOME_LABEL,
  type WorkTask,
} from "./models";
import { type DayKey, type Instant, Clock, koreanShort } from "./time";

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
      "카메라는 쓰지 않습니다. 지각비나 강제 추가근무도 없습니다.",
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
    if (carried.length > 0) {
      lines.push("", `지난 활동일에서 이월한 과제 ${carried.length}건이 오늘 목록에 함께 들어갑니다.`);
      for (const t of carried) lines.push(`· ${t.title} (이월 ${t.carryCount}회)`);
    }
    return newMail({ sentAt: at, from: "manager", to: "me", kind: "notice", subject: `[공지] ${koreanShort(day)} 활동 안내`, body: join(lines) });
  },

  tasksConfirmed(tasks: WorkTask[], at: Instant): Mail {
    const lines = ["오늘 끝낼 과제를 확정했습니다.", ""];
    tasks.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.title}${t.carriedFrom ? " (이월)" : ""}`);
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
