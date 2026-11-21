"use client";
/**
 * 화면 한쪽에 고정하는 '지금 할 일' 카드(디자인 멘토 피드백).
 * 처음 쓰는 사람도 공간을 찾지 않고 바로 실행할 수 있게 지금 할 일·이유·실행 버튼을 늘 보여 주고,
 * 익숙해진 뒤에도 자주 쓰는 체크리스트·결과물 제출은 한 번에 열 수 있게 바로가기를 둔다.
 */
import type { OfficeView } from "./api";
import { nextStepOf } from "./TopBar";
import type { PlaceId } from "./ui";

/** 지금 할 일이 왜 지금인지 한 줄로. 규칙은 다시 계산하지 않고 서버가 준 단계만 읽는다. */
function whyNow(view: OfficeView): string {
  if (view.seat.kind === "absentCandidate") return "오늘은 출근 기록이 없습니다. 다음 근무일에 다시 시작합니다.";
  switch (view.phase.value) {
    case "beforeCheckIn":
      return "출근을 누르면 하루가 시작됩니다.";
    case "morningPT":
      return "오늘 할 일을 정해야 체크리스트가 생깁니다.";
    case "working":
      if (view.can.submitWeekly) return "금요일에는 주간보고서를 올립니다.";
      if (view.mail.unreadCount > 0) return "팀장 메일에 확인할 내용이 있습니다.";
      return "체크리스트를 하나씩 끝내고 결과물을 남깁니다.";
    case "checkoutReview":
      return "18:00입니다. 결과물을 올리고 남은 일을 정리합니다.";
    case "dinner":
      return "꼭 끝낼 일이 남아 19:00부터 추가근무를 합니다.";
    case "overtime":
      return "남은 일을 끝내면 바로 마칠 수 있습니다.";
    case "overtimeReview":
      return "22:00입니다. 한 일을 올리고 남은 일은 이월합니다.";
    case "off":
      return "해낸 일과 다음 근무일 계획을 확인합니다.";
  }
}

export function NowPanel({ view, onGo, place }: { view: OfficeView; onGo: (place: PlaceId) => void; place: PlaceId }) {
  const step = nextStepOf(view);
  const tasks = view.state.day.tasks;
  const done = tasks.filter((t) => t.status === "done").length;
  const open = tasks.filter((t) => t.status === "open").length;
  const working = ["working", "checkoutReview", "overtime", "overtimeReview"].includes(view.phase.value);

  const openDeliverable = () => {
    onGo("desk");
    // 내 책상 화면이 그려진 다음 프레임에 첫 빈 결과물 칸으로 옮긴다.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const fields = Array.from(
          document.querySelectorAll<HTMLInputElement>('input[aria-label$=" 결과물"]:not([disabled])'),
        );
        const target = fields.find((f) => !f.value.trim()) ?? fields[0];
        target?.focus();
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
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
        <div className="now-progress" aria-label={`오늘 업무 ${tasks.length}건 중 ${done}건 완료`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small">오늘 해낸 일</span>
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
          체크리스트{open > 0 ? ` · 남은 ${open}건` : ""}
        </button>
        <button
          className="btn secondary small"
          onClick={openDeliverable}
          disabled={!working || open + done === 0}
          title={working ? "내 책상의 결과물 칸으로 바로 갑니다." : "근무 중에 결과물을 올릴 수 있습니다."}
        >
          결과물 제출
        </button>
      </div>
    </aside>
  );
}
