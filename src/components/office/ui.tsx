/** 화면 공통 부품. 경고는 색만으로 구분하지 않고 기호와 제목을 함께 쓴다. */
import type { ReactNode } from "react";

export type PlaceId = "door" | "meeting" | "desk" | "manager" | "weekly" | "settings";

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

/** 업무 중요도. 숫자만 보이지 않게 행동이 떠오르는 이름을 함께 쓴다(현직자 피드백). */
export const LEVEL_NAME: Record<1 | 2 | 3, string> = {
  3: "오늘 꼭 끝낼 일",
  2: "오늘 안에 할 일",
  1: "미뤄도 되는 일",
};

export function LevelBadge({ level }: { level: 1 | 2 | 3 | null }) {
  if (level == null) return <span className="badge none">단계 확인 필요</span>;
  return (
    <span className={`badge l${level}`} title={LEVEL_NAME[level]}>
      {level}단계 · {LEVEL_NAME[level]}
    </span>
  );
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
