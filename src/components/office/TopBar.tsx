"use client";
/**
 * 위 막대(맥 앱 TopBar 구성). 3D 화면에서는 장소 목록 대신 이 막대가 길잡이를 맡는다.
 * 왼쪽: 팀·이름 / 날짜, 큰 시계, 지금 단계 + 상태 칩
 * 가운데: 지금 할 일(지금 열린 패널과 같은 곳이면 숨김)
 * 오른쪽: 메일함 · 안 읽음 N, 점선 '시연' 묶음, 설정 톱니
 * 관리 강도: 지금 강도 칩. 지각·착석은 보통·엄격에서만 칩에 보인다.
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
      if (view.attendance.absentCandidate || view.attendance.dayOff) return { label: "출입문 · 다음 활동일로", place: "door" };
      return { label: "출입문 · 사원증 찍고 출근", place: "door" };
    case "morningPT":
      return { label: "회의실로 · 아침보고", place: "meeting" };
    case "working": {
      const allHandled = tasks.length > 0 && tasks.every((t) => t.status === "submitted" || t.status === "incomplete");
      // 발표 시작 버튼('회의실에서 발표하기')은 책상 패널에 있다. 회의실 패널로 보내면 다시 책상으로 돌려보내는 막다른 길이 된다.
      if (allHandled && view.can.startSharing) return { label: "내 책상 · 회의실에서 발표하기", place: "desk" };
      return { label: "내 책상 · 결과물 제출", place: "desk" };
    }
    case "checkout":
      return { label: "내 책상 · 퇴근 점검 제출", place: "desk" };
    case "dinner":
      return { label: "내 책상 · 저녁시간", place: "desk" };
    case "overtime":
      return { label: "내 책상 · 추가근무 과제", place: "desk" };
    case "overtimeReview":
      return { label: "내 책상 · 추가근무 점검", place: "desk" };
    case "sharing":
      return { label: "회의실 · 발표 이어가기", place: "share" };
    case "checkoutReview":
      return { label: "내 책상 · 하루 마감", place: "desk" };
    case "off":
      return null;
  }
}

/** 단계 옆 작은 상태 칩. 보통·엄격 근무 중에는 착석 상태, 그 밖에는 오늘 과제 진행을 보여 준다. */
function statusChip(view: OfficeView): { text: string; warn: boolean } {
  const tasks = view.day.tasks;
  if (view.enforcement.rules.seatCheck && ["working", "overtime", "dinner"].includes(view.phase.value) && view.seat.kind !== "seated") {
    // 카메라 없이 출근을 고른 날은 '카메라 꺼짐'이 예상된 상태다. 불이익이 없다고 안내했으니 경고색으로 보이지 않게 한다.
    if (view.day.checkInMethod === "noCamera" && view.seat.kind === "cameraOff") return { text: "카메라 없이 근무", warn: false };
    return { text: view.seat.title, warn: view.seat.isWarning };
  }
  switch (view.phase.value) {
    case "beforeCheckIn":
      if (view.attendance.absentCandidate) return { text: "결근 후보", warn: true };
      if (view.attendance.dayOff) return { text: "쉬는 날", warn: false };
      return { text: `활동 ${hhmm(view.profile.activityStart)}~${hhmm(view.profile.activityEnd)}`, warn: false };
    case "checkout":
    case "overtimeReview":
      return { text: "점검 중", warn: false };
    case "dinner":
      return { text: `추가근무 ${view.overtime.overtimeHM}`, warn: false };
    case "overtime": {
      const left = view.day.tasks.filter((t) => view.overtime.assignedIds.includes(t.id) && view.overtime.targetIds.includes(t.id)).length;
      return { text: `추가근무 남은 ${left}건`, warn: false };
    }
    case "morningPT":
      return { text: "범위 정하는 중", warn: false };
    case "working":
    case "sharing": {
      const sub = tasks.filter((t) => t.status === "submitted").length;
      return { text: `제출 ${sub} / ${tasks.length}${view.attendance.isLate ? " · 지각" : ""}`, warn: false };
    }
    case "checkoutReview":
      return { text: "마감 확인 중", warn: false };
    case "off":
      return { text: "오늘 활동 마침", warn: false };
  }
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function TopBar({
  office,
  view,
  onGo,
  place,
}: {
  office: OfficeHandle;
  view: OfficeView;
  onGo: (place: PlaceId) => void;
  /** 지금 열린 패널. 지금 할 일과 같은 곳이면 버튼을 숨긴다. 패널이 닫혀 있으면 null. */
  place?: PlaceId | null;
}) {
  const step = nextStepOf(view);
  const chip = statusChip(view);
  const unread = view.mail.unreadCount;
  const skip = async () => {
    const res = await office.act<{ skip: { stoppedFor: string | null } }>("skipHour");
    if (res?.skip?.stoppedFor) office.notify(`${res.skip.stoppedFor}에서 멈췄습니다.`);
  };
  const nextDay = async () => {
    if ((await office.act("startNextWorkday")) != null) onGo("door");
  };
  const showCloseHint = view.pastActivityEnd && !view.enforcement.rules.checkoutAndOvertime && ["working", "sharing"].includes(view.phase.value);

  return (
    <div className="topbar" role="banner">
      <div>
        <div className="small muted">
          개발팀 · {view.profile.name} 사원 (가상 역할) · {view.clock.dateShort}
        </div>
        <div className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
          <span className="clock" aria-label={`지금 시각 ${view.clock.hm}`}>
            {view.clock.hm}
          </span>
          <div>
            <div className="phase">{view.phase.headline}</div>
            <span className={`chip ${chip.warn ? "warn" : ""}`}>{chip.text}</span>{" "}
            <span className="chip" title={view.enforcement.rules.summary}>
              강도 {view.enforcement.rules.label}
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

      {step && step.place !== place ? (
        <button className="btn topbar-now" onClick={() => onGo(step.place)} title="지금 할 일">
          {step.label}
        </button>
      ) : null}

      <button
        className={`btn ${unread > 0 ? "secondary" : "plain"}`}
        onClick={() => onGo("manager")}
        aria-label={unread > 0 ? `메일함, 안 읽은 메일 ${unread}통` : "메일함"}
      >
        {unread > 0 ? `메일함 · 안 읽음 ${unread}` : "메일함"}
      </button>

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
              title={view.enforcement.rules.checkoutAndOvertime ? "시연 시각을 다음 정각으로 보냅니다. 퇴근 점검·추가근무 시각에서 멈춥니다." : "시연 시각을 다음 정각으로 보냅니다. 단계는 바뀌지 않습니다."}
            >
              다음 정각
            </button>
          )}
        </div>
      ) : null}

      <button className="btn plain" onClick={() => onGo("settings")} aria-label="설정" title="설정" style={{ padding: "0 10px" }}>
        <GearIcon />
      </button>
    </div>
  );
}
