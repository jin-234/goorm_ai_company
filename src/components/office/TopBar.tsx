"use client";
/**
 * 위 막대(고정). 가상 시각·단계, 지금 해야 할 일과 실행 버튼,
 * 그리고 실제 기능과 구분한 점선 '시연' 묶음(다음 정각·다음 활동일·금요일 장면).
 */
import type { OfficeView } from "./api";
import type { OfficeHandle } from "./useOffice";
import type { PlaceId } from "./ui";

export interface NextStep {
  label: string;
  place: PlaceId;
}

/** 지금 단계에서 가장 먼저 할 일. 화면 이동만 고르고 규칙은 서버 값(can.*)을 따른다. */
export function nextStepOf(view: OfficeView): NextStep | null {
  if (!view.onboarded) return null;
  switch (view.phase.value) {
    case "beforeCheckIn":
      return { label: "출입문 · 출근하기", place: "door" };
    case "morningPT":
      return { label: "회의실로 · 아침보고", place: "meeting" };
    case "working":
      if (view.can.submitWeekly) return { label: "주간보고서 쓰기", place: "weekly" };
      if (view.mail.unreadCount > 0) return { label: `메일 ${view.mail.unreadCount}통 읽기`, place: "manager" };
      return { label: "내 책상 · 과제 수행", place: "desk" };
    case "sharing":
      return { label: "기획팀에 설명하기", place: "desk" };
    case "checkoutReview":
      return { label: "하루 마감 쓰기", place: "desk" };
    case "off":
      if (view.can.submitWeekly) return { label: "주간보고서 쓰기", place: "weekly" };
      return { label: "오늘 마감 보기", place: "desk" };
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
  const skip = () => office.act("skipHour");
  const friday = async () => {
    if (!window.confirm("금요일 아침으로 갈까요?\n마감하지 않은 과제는 다음 활동일로 이월합니다.")) return;
    if ((await office.act("jumpToFriday")) != null) {
      office.notify("금요일 아침으로 이동했습니다.\n오늘은 주간보고서를 쓰는 날입니다.");
      onGo("door");
    }
  };
  const nextDay = async () => {
    if ((await office.act("startNextWorkday")) != null) onGo("door");
  };
  const showNextDay = view.phase.value === "off" || (view.phase.value === "beforeCheckIn" && view.can.startNextWorkday);

  return (
    <div className="topbar" role="banner">
      <div>
        <div className="small muted">
          {view.profile.targetRole || "가상회사"} · {view.profile.name} 사원 · {view.clock.dateShort}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className="clock" aria-label={`지금 시각 ${view.clock.hm}`}>
            {view.clock.hm}
          </span>
          <div>
            <div className="phase">{view.phase.headline}</div>
            <span className="chip" title={view.seat.detail}>
              {view.phase.label}
            </span>
          </div>
        </div>
      </div>

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
          <button className="btn secondary small" onClick={skip} disabled={office.busy || !view.can.skipHour} title="시연 시각을 다음 정각으로 보냅니다.">
            다음 정각
          </button>
          {showNextDay ? (
            <button
              className="btn secondary small"
              onClick={nextDay}
              disabled={office.busy || !view.can.startNextWorkday}
              title={view.phase.value === "off" ? "다음 활동일 아침으로 갑니다." : "오늘은 쉬는 날로 두고 다음 활동일로 갑니다."}
            >
              다음 활동일
            </button>
          ) : null}
          {!view.clock.isFriday ? (
            <button
              className="btn secondary small"
              onClick={friday}
              disabled={office.busy || !view.can.jumpToFriday}
              title="시연용: 이번 주 금요일 아침으로 갑니다."
            >
              금요일 장면
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
