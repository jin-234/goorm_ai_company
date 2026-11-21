"use client";
/** 팀장 자리 · 사내 메일함. 받은 메일·보낸 메일, 누르면 읽음 처리 후 본문. */
import { useState } from "react";
import { dayKeyOf, hm, koreanShort } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, PanelHeader, type PlaceId } from "../ui";

type Mail = OfficeView["mail"]["inbox"][number];

const shortStamp = (t: number) => {
  const d = dayKeyOf(t);
  return `${d.month}/${d.day} ${hm(t)}`;
};

export function MailBox({ office, view, onGo }: { office: OfficeHandle; view: OfficeView; onGo: (p: PlaceId) => void }) {
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = tab === "inbox" ? view.mail.inbox : view.mail.sent;
  const open = [...view.mail.inbox, ...view.mail.sent].find((m) => m.id === openId) ?? null;

  const read = (m: Mail) => {
    setOpenId(m.id);
    if (!m.isRead) void office.act("markMailRead", { id: m.id });
  };

  if (open) return <MailDetail mail={open} onBack={() => setOpenId(null)} />;

  return (
    <div className="panel">
      <PanelHeader place="팀장 자리" title="사내 메일함" detail="AI 팀장 자리 · 공지와 안내 메일이 옵니다." />
      <div className="row" role="tablist" aria-label="메일함">
        {(
          [
            ["inbox", `받은 메일 (${view.mail.inbox.length})`],
            ["sent", `보낸 메일 (${view.mail.sent.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`btn small ${tab === id ? "" : "secondary"}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <Card>
        {list.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            메일이 없습니다.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {[...list]
              .sort((a, b) => b.sentAt - a.sentAt)
              .map((m) => (
                <li key={m.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <button
                    onClick={() => read(m)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "grid",
                      gridTemplateColumns: "12px auto 1fr auto",
                      gap: 10,
                      alignItems: "center",
                      width: "100%",
                      padding: "10px 4px",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: m.isRead || tab === "sent" ? "transparent" : "var(--green)",
                      }}
                    />
                    <span className="badge tag">{m.tag}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="small muted">{tab === "sent" ? `받는 사람: ${m.toName}` : m.fromName}</span>
                      <span
                        style={{
                          display: "block",
                          fontWeight: m.isRead || tab === "sent" ? 400 : 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.subject}
                      </span>
                    </span>
                    <span className="small muted" style={{ textAlign: "right" }}>
                      {shortStamp(m.sentAt)}
                      {!m.isRead && tab === "inbox" ? <span style={{ display: "block", color: "var(--green)", fontWeight: 700 }}>안 읽음</span> : null}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MailDetail({ mail, onBack }: { mail: Mail; onBack: () => void }) {
  return (
    <div className="panel">
      <div>
        <button className="btn plain small" onClick={onBack}>
          메일함으로
        </button>
      </div>
      <section className="card" style={{ background: mail.isWarm ? "#fffaf0" : undefined }}>
        <span className="badge tag" style={{ alignSelf: "flex-start" }}>
          {mail.tag}
        </span>
        <h1 style={{ fontSize: 21 }}>{mail.subject}</h1>
        <div className="small muted" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
          <span>보낸 사람</span>
          <span>{mail.fromName}</span>
          <span>받는 사람</span>
          <span>{mail.toName}</span>
          <span>보낸 시각</span>
          <span>
            {koreanShort(dayKeyOf(mail.sentAt))} {hm(mail.sentAt)}
          </span>
        </div>
        <div className="pre" style={{ fontSize: 16, lineHeight: 1.75, userSelect: "text" }}>
          {mail.body}
        </div>
      </section>
    </div>
  );
}
