"use client";
/**
 * 위 막대(고정). 가상 시각·단계·자리 상태, 지금 해야 할 일과 실행 버튼, 이번 달 점수,
 * 그리고 실제 기능과 구분한 점선 '시연' 묶음(다음 정각·다음 근무일·금요일 장면).
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
  if (!view.state.onboarded) return null;
  if (view.seat.kind === "absentCandidate") {
    return view.can.startNextWorkday ? { label: "다음 근무일 시작", place: "desk" } : null;
  }
  switch (view.phase.value) {
    case "beforeCheckIn":
      return { label: "출입문 · 출근하기", place: "door" };
    case "morningPT":
      return { label: "회의실로 · 아침 PT", place: "meeting" };
    case "working":
      if (view.can.submitWeekly) return { label: "주간보고서 쓰기", place: "weekly" };
      if (view.mail.unreadCount > 0) return { label: `메일 ${view.mail.unreadCount}통 읽기`, place: "manager" };
      return { label: "내 책상 · 체크리스트", place: "desk" };
    case "checkoutReview":
      return { label: "퇴근 점검 하기", place: "desk" };
    case "dinner":
    case "overtime":
      return { label: "추가근무 업무 보기", place: "desk" };
    case "overtimeReview":
      return { label: "결과물 올리고 마치기", place: "desk" };
    case "off":
      if (view.can.submitWeekly) return { label: "주간보고서 쓰기", place: "weekly" };
      return { label: "오늘 마무리 보기", place: "desk" };
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
  const stats = view.monthStats;
  const skip = async () => {
    const res = await office.act<{ skip: { stoppedFor: string | null; to: number } }>("skipHour");
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

  return (
    <div className="topbar" role="banner">
      <div>
        <div className="small muted">
          가상회사 1팀 · {view.state.profile.name} 사원 · {view.clock.dateShort}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className="clock" aria-label={`지금 시각 ${view.clock.hm}`}>
            {view.clock.hm}
          </span>
          <div>
            <div className="phase">{view.phase.headline}</div>
            <span className={`chip ${view.seat.isWarning ? "warn" : ""}`} title={view.seat.detail}>
              {view.seat.isWarning ? "! " : ""}
              {view.seat.title}
            </span>
          </div>
        </div>
      </div>

      {stats.points > 0 ? (
        <div className="small" title="지각 1회 1점, 결근 후보 1회 3점. 월 2점까지 0원, 초과 1점당 1,000원, 월 최대 5,000원. 시연에서는 청구하지 않습니다.">
          이번 달 {stats.points}점 · 지각비 예상 {stats.estimatedFee.toLocaleString("ko-KR")}원
        </div>
      ) : null}

      <div className="spacer" />

      {step ? (
        <div className="row">
          <span className="small muted">지금 할 일</span>
          <button className="btn" onClick={() => onGo(step.place)}>
            {step.label}
          </button>
        </div>
      ) : null}

      {view.state.onboarded ? (
        <div className="demo-group" aria-label="시연용 조작">
          <span className="label">시연</span>
          {view.phase.value === "off" || view.seat.kind === "absentCandidate" ? (
            <button className="btn secondary small" onClick={nextDay} disabled={office.busy || !view.can.startNextWorkday}>
              다음 근무일
            </button>
          ) : (
            <button
              className="btn secondary small"
              onClick={skip}
              disabled={office.busy || !view.can.skipHour}
              title={
                view.can.skipHour
                  ? "시연 시각을 다음 정각으로 보냅니다. 퇴근 점검·추가근무 시각에서는 멈춥니다."
                  : "지금 점검을 먼저 제출해 주세요."
              }
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
