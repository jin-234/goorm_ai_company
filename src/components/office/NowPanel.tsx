"use client";
/**
 * 화면 한쪽에 고정하는 '지금 할 일' 카드(디자인 멘토 피드백).
 * 처음 쓰는 사람도 공간을 찾지 않고 바로 실행할 수 있게 지금 할 일·이유·실행 버튼을 늘 보여 주고,
 * 익숙해진 뒤에도 자주 쓰는 과제 목록·결과물 제출은 한 번에 열 수 있게 바로가기를 둔다.
 */
import type { OfficeView } from "./api";
import { nextStepOf } from "./TopBar";
import type { PlaceId } from "./ui";

/** 지금 할 일이 왜 지금인지 한 줄로. 규칙은 다시 계산하지 않고 서버가 준 단계만 읽는다. */
function whyNow(view: OfficeView): string {
  switch (view.phase.value) {
    case "beforeCheckIn":
      if (view.attendance.absentCandidate) return "오늘은 결근 후보로 남았습니다. 다음 활동일에 돌아오면 그날은 지각으로 세지 않습니다.";
      if (view.attendance.dayOff) return "오늘은 쉬는 날로 알렸습니다. 푹 쉬고 다음 활동일에 만나요.";
      return view.enforcement.rules.attendance ? "정해 둔 시작 시각까지 출근하면 지각으로 세지 않습니다." : "출근을 누르면 오늘 활동이 시작됩니다.";
    case "morningPT":
      return "오늘 끝낼 범위를 정해야 과제가 생깁니다.";
    case "working":
      if (view.can.submitWeekly) return "금요일에는 주간보고서를 올립니다.";
      if (view.mail.unreadCount > 0) return "팀장 메일에 확인할 내용이 있습니다.";
      if (view.seat.isWarning) return view.seat.detail;
      if (view.overtime.checkoutAt != null) return "퇴근 점검을 마쳤습니다. 기획팀 공유와 하루 마감으로 이어 가세요.";
      if (view.pastActivityEnd) return "정해 둔 마감 시각이 지났습니다. 정리되면 공유로 넘어가세요.";
      return "과제를 수행하고 결과물을 제출합니다.";
    case "checkout":
      return "마감 시각입니다. 남은 2·3단계 과제가 있으면 추가근무를 합니다.";
    case "dinner":
      return `저녁시간 뒤 ${view.overtime.overtimeHM} 추가근무입니다.`;
    case "overtime":
      return "배정된 과제를 3단계부터 진행합니다.";
    case "overtimeReview":
      return "추가근무 시간이 끝났습니다. 점검을 제출하고 마감으로 갑니다.";
    case "sharing":
      return "기획팀이 이어서 일할 수 있게 오늘 한 일을 설명합니다.";
    case "checkoutReview":
      return "기록을 바탕으로 오늘을 정리하고 확정합니다.";
    case "off":
      return "해낸 일과 다음 활동일 과제를 확인합니다.";
  }
}

export function NowPanel({ view, onGo, place }: { view: OfficeView; onGo: (place: PlaceId) => void; place: PlaceId }) {
  const step = nextStepOf(view);
  const tasks = view.day.tasks;
  const done = tasks.filter((t) => t.status === "submitted" || t.status === "reviewed").length;
  const open = tasks.length - done;

  const openSubmit = () => {
    onGo("desk");
    // 내 책상 화면이 그려진 다음 프레임에 첫 '결과물 제출' 버튼으로 옮긴다.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".panel-area button")).find(
          (b) => b.textContent === "결과물 제출" && !b.disabled,
        );
        button?.focus();
        button?.scrollIntoView({ block: "center", behavior: "smooth" });
      }),
    );
  };

  return (
    <aside className="now-panel" aria-label="지금 할 일">
      <div className="now-label">지금 할 일</div>
      {step ? (
        <>
          <div className="now-title">{step.label}</div>
          <p className="now-why">{whyNow(view)}</p>
          {place === step.place ? (
            <div className="now-here" role="status">
              ✓ 지금 이 화면에서 하면 됩니다
            </div>
          ) : (
            <button className="btn now-go" onClick={() => onGo(step.place)}>
              바로 하기
            </button>
          )}
        </>
      ) : (
        <p className="now-why">지금은 할 일이 없습니다.</p>
      )}

      {tasks.length > 0 ? (
        <div className="now-progress" aria-label={`오늘 과제 ${tasks.length}건 중 ${done}건 제출`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small">제출한 과제</span>
            <span className="small" style={{ fontWeight: 700 }}>
              {done} / {tasks.length}
            </span>
          </div>
          <div className="bar" aria-hidden>
            <span style={{ width: `${Math.round((done / tasks.length) * 100)}%` }} />
          </div>
        </div>
      ) : null}

      <div className="now-quick" role="group" aria-label="바로 열기">
        <span className="small muted">바로 열기</span>
        <button className="btn secondary small" onClick={() => onGo("desk")}>
          과제{open > 0 ? ` · 남은 ${open}건` : ""}
        </button>
        <button
          className="btn secondary small"
          onClick={openSubmit}
          disabled={!view.can.editTasks || tasks.length === 0}
          title={view.can.editTasks ? "내 책상의 결과물 제출로 바로 갑니다." : "과제를 확정한 뒤 결과물을 제출할 수 있습니다."}
        >
          결과물 제출
        </button>
      </div>
    </aside>
  );
}
