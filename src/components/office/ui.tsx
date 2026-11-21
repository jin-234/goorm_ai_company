/** 화면 공통 부품. 경고는 색만으로 구분하지 않고 기호와 제목을 함께 쓴다. */
import type { ReactNode } from "react";
import type { CloseChoice, TaskStatus } from "./api";

/** 장소(분담표 3.1). share = 기획팀(AI 기획자에게 공유). */
export type PlaceId = "door" | "meeting" | "desk" | "share" | "manager" | "weekly" | "settings";

export function PanelHeader({ place, title, detail }: { place: string; title: string; detail?: string }) {
  return (
    <header className="panel-head">
      <div className="place-name">{place}</div>
      <h1>{title}</h1>
      {detail ? <p className="pre">{detail}</p> : null}
    </header>
  );
}

const NOTICE_ICON = { info: "i", ok: "✓", warning: "!", error: "!" } as const;

export function Notice({
  kind,
  title,
  children,
}: {
  kind: keyof typeof NOTICE_ICON;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" || kind === "warning" ? "alert" : "status"}>
      <span className="icon" aria-hidden>
        {NOTICE_ICON[kind]}
      </span>
      <div>
        <div className="title pre">{title}</div>
        {children ? <div className="pre">{children}</div> : null}
      </div>
    </div>
  );
}

/** 업무 상태 이름. 제출과 완료를 같은 것으로 보이지 않게 따로 부른다. */
export const STATUS_NAME: Record<TaskStatus, string> = {
  confirmed: "시작 전",
  in_progress: "하는 중",
  submitted: "제출함",
  incomplete: "미완료",
  reviewed: "마감 확인",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const tone = status === "submitted" || status === "reviewed" ? "l3" : status === "in_progress" ? "l2" : status === "incomplete" ? "none" : "l1";
  return <span className={`badge ${tone}`}>{STATUS_NAME[status]}</span>;
}

/** 미완료 처리(개정 기획서 3.1). 고를 때 떠오르는 행동으로 부른다. */
export const CHOICE_NAME: Record<CloseChoice, { label: string; detail: string }> = {
  adjust: { label: "범위 줄여 마치기", detail: "오늘 한 데까지를 오늘의 결과로 봅니다." },
  carryOver: { label: "다음 활동일로 넘기기", detail: "다음 아침보고 목록에 그대로 올라갑니다." },
  endToday: { label: "오늘은 여기서 종료", detail: "넘기지 않고 오늘 기록만 남깁니다." },
};

/** AI 연결 전 예시 응답임을 알리는 작은 꼬리표. 말풍선·제안 카드는 그대로 쓴다. */
export function SampleMark() {
  return (
    <span className="badge tag" title="AI를 연결하기 전이라 예시 생성기가 답했습니다.">
      예시 응답(AI 연결 전)
    </span>
  );
}

/** AI가 아닌 수동 양식임을 알리는 표시. AI가 답한 것처럼 보이지 않게 한다. */
export function ManualMark({ text = "AI 미연결 · 직접 입력 양식" }: { text?: string }) {
  return <span className="badge tag">{text}</span>;
}

export function Card({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card">
      {title ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}
