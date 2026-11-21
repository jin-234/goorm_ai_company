"use client";
/**
 * 위 막대. 가상 시각·단계, 지금 할 일과 실행 버튼, 그리고 실제 기능과 구분한 점선 '시연' 묶음.
 * 개정판: 지각 점수·착석 상태는 보여 주지 않는다. 마감 시각이 지나면 안내만 한다(강제 이동 없음).
 */
import { hhmm, type OfficeView } from "./api";
import type { OfficeHandle } from "./useOffice";
import type { PlaceId } from "./ui";

export interface NextStep {
  label: string;
  place: PlaceId;
}

/** 지금 단계에서 가장 먼저 할 일. 화면 이동만 고르고 규칙은 서버 값을 따른다. */
export function nextStepOf(view: OfficeView): NextStep | null {
  if (!view.onboarded) return null;
  const tasks = view.day.tasks;
  switch (view.phase.value) {
    case "beforeCheckIn":
      return { label: "출입문 · 활동 시작", place: "door" };
    case "morningPT":
      return { label: "회의실 · 아침보고", place: "meeting" };
    case "working": {
      const allHandled = tasks.length > 0 && tasks.every((t) => t.status === "submitted" || t.status === "incomplete");
      if (allHandled && view.can.startSharing) return { label: "기획팀 · 오늘 한 일 공유", place: "share" };
      return { label: "내 책상 · 결과물 제출", place: "desk" };
    }
    case "sharing":
      return { label: "기획팀 · 공유 이어가기", place: "share" };
    case "checkoutReview":
      return { label: "내 책상 · 하루 마감", place: "desk" };
    case "off":
      if (view.can.submitWeekly) return { label: "주간보고서 쓰기", place: "weekly" };
      return { label: "오늘 기록 보기", place: "desk" };
  }
}

export function TopBar({
  office,
  view,
  onGo,
}: {
  office: OfficeHandle;
  view: OfficeView;
  onGo: (place: PlaceId) => void;
}) {
  const step = nextStepOf(view);
  const { profile } = view;
  const skip = async () => {
    const res = await office.act<{ skip: { stoppedFor: string | null } }>("skipHour");
    if (res?.skip?.stoppedFor) office.notify(`${res.skip.stoppedFor}에서 멈췄습니다.`);
  };
  const friday = async () => {
    if ((await office.act("jumpToFriday")) != null) {
      office.notify("금요일 아침으로 이동했습니다.\n오늘은 주간보고서를 제출하는 날입니다.");
      onGo("door");
    }
  };
  const nextDay = async () => {
    if ((await office.act("startNextWorkday")) != null) onGo("door");
  };
  const showCloseHint = view.pastActivityEnd && ["working", "sharing"].includes(view.phase.value);

  return (
    <div className="topbar" role="banner">
      <div>
        <div className="small muted">
          VISION COMPANY · 개발팀 {profile.name} (가상 역할) · {view.clock.dateShort}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className="clock" aria-label={`지금 시각 ${view.clock.hm}`}>
            {view.clock.hm}
          </span>
          <div>
            <div className="phase">{view.phase.headline}</div>
            <span className="chip" title="입사할 때 정한 활동 시간입니다. 바꾸려면 설정에서 고칩니다.">
              활동 {hhmm(profile.activityStart)}~{hhmm(profile.activityEnd)}
            </span>
          </div>
        </div>
      </div>

      {showCloseHint ? (
        <div className="small" role="status">
          정한 마감 시각이 지났습니다 · 준비되면 하루 마감을 해 주세요
        </div>
      ) : null}

      <div className="spacer" />

      {step ? (
        <div className="row topbar-now">
          <span className="small muted">지금 할 일</span>
          <button className="btn" onClick={() => onGo(step.place)}>
            {step.label}
          </button>
        </div>
      ) : null}

      {view.onboarded ? (
        <div className="demo-group" aria-label="시연용 조작">
          <span className="label">시연</span>
          {view.phase.value === "off" ? (
            <button className="btn secondary small" onClick={nextDay} disabled={office.busy || !view.can.startNextWorkday}>
              다음 활동일
            </button>
          ) : (
            <button
              className="btn secondary small"
              onClick={skip}
              disabled={office.busy || !view.can.skipHour}
              title="시연 시각을 다음 정각으로 보냅니다. 단계는 바뀌지 않습니다."
            >
              다음 정각
            </button>
          )}
          {!view.clock.isFriday ? (
            <button
              className="btn secondary small"
              onClick={friday}
              disabled={office.busy || !view.can.jumpToFriday}
              title="시연용: 오늘을 마감하고 이번 주 금요일 아침으로 갑니다."
            >
              금요일 장면
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
