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

/** 과제 상태. 색만으로 구분하지 않게 이름을 함께 쓴다. */
const STATUS_CLASS: Record<string, string> = {
  confirmed: "l1",
  in_progress: "l2",
  submitted: "l3",
  reviewed: "l3",
  incomplete: "none",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge ${STATUS_CLASS[status] ?? "tag"}`}>{label}</span>;
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
