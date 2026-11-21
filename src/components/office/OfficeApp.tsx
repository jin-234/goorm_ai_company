"use client";
/**
 * 웹 화면의 큰 틀: 위 막대 + 왼쪽 장소 이름표 + 오른쪽 패널.
 * 3D 없이도 하루 흐름이 끝까지 이어지는 2D 화면(웹 기획서 7장).
 * 단계가 바뀌면 그 단계의 패널로 자동으로 옮긴다.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { OfficeView } from "./api";
import { CheckIn } from "./panels/CheckIn";
import { Desk } from "./panels/Desk";
import { OvertimePanel } from "./panels/Enforcement";
import { MailBox } from "./panels/Mail";
import { MorningPT } from "./panels/MorningPT";
import { Onboarding } from "./panels/Onboarding";
import { Checkout, DayEnd } from "./panels/Review";
import { Share } from "./panels/Share";
import { applySavedTextScale, Settings } from "./panels/Settings";
import { Weekly } from "./panels/Weekly";
import { NowPanel } from "./NowPanel";
import { OfficeStage } from "./OfficeStage";
import { nextStepOf, TopBar } from "./TopBar";
import { type PlaceId, Notice } from "./ui";
import { type OfficeHandle, useOffice } from "./useOffice";

interface PlaceInfo {
  id: PlaceId;
  name: string;
  sub: (view: OfficeView) => string;
}

const PLACES: PlaceInfo[] = [
  { id: "door", name: "출입문", sub: (v) => (v.day.checkInAt != null ? "출근 완료" : "출근") },
  { id: "meeting", name: "회의실", sub: (v) => (v.phase.value === "morningPT" ? "지금 아침보고" : "아침보고") },
  { id: "desk", name: "내 책상", sub: (v) => `과제·공유·마감 · ${v.seat.title}` },
  { id: "manager", name: "팀장 자리", sub: (v) => (v.mail.unreadCount > 0 ? `메일함 · 안 읽음 ${v.mail.unreadCount}` : "사내 메일함") },
  { id: "weekly", name: "주간보고", sub: (v) => (v.clock.isFriday ? "오늘 제출" : "금요일에 제출") },
  { id: "settings", name: "설정", sub: (v) => `관리 강도 ${v.enforcement.rules.label} · Solar 연결` },
];

/** 단계가 바뀔 때 자동으로 열 패널. */
function placeForPhase(view: OfficeView): PlaceId {
  switch (view.phase.value) {
    case "beforeCheckIn":
      return "door";
    case "morningPT":
      return "meeting";
    default:
      return "desk";
  }
}

export function OfficeApp() {
  const office = useOffice();
  const { view } = office;
  const [place, setPlace] = useState<PlaceId>("door");
  const lastPhase = useRef<string | null>(null);

  useEffect(() => {
    applySavedTextScale();
  }, []);

  // 단계가 바뀌면 그 단계의 패널로(처음 불러올 때도).
  useEffect(() => {
    if (!view) return;
    const key = `${view.clock.date}:${view.phase.value}`;
    if (lastPhase.current !== key) {
      lastPhase.current = key;
      setPlace(placeForPhase(view));
    }
  }, [view]);

  if (!view) {
    return (
      <main style={{ padding: 40 }}>
        {office.loadError ? (
          <Notice kind="error" title="회사 상태를 불러오지 못했습니다">
            {office.loadError}
          </Notice>
        ) : (
          <p className="muted">사무실을 여는 중입니다.</p>
        )}
      </main>
    );
  }

  if (!view.onboarded) {
    return (
      <>
        <Onboarding office={office} view={view} />
        <Toast text={office.toast} />
      </>
    );
  }

  const now = nextStepOf(view)?.place;
  return (
    <div className="app">
      <TopBar office={office} view={view} onGo={setPlace} />
      {office.loadError ? (
        <div style={{ padding: "8px 20px" }}>
          <Notice kind="warning" title="서버와 연결이 잠시 끊겼습니다">
            {office.loadError}
          </Notice>
        </div>
      ) : null}
      <div className="layout">
        <div className="sidebar">
          <NowPanel view={view} onGo={setPlace} place={place} />
          <nav className="places" aria-label="사무실 장소">
            {PLACES.map((p) => (
              <button
                key={p.id}
                className={`place ${place === p.id ? "active" : ""} ${now === p.id && place !== p.id ? "now" : ""}`}
                onClick={() => setPlace(p.id)}
                aria-current={place === p.id ? "page" : undefined}
              >
                <div className="name">{p.name}</div>
                <div className="sub">{p.sub(view)}</div>
              </button>
            ))}
          </nav>
        </div>
        <main className="panel-area">
          <OfficeStage view={view} onGo={setPlace} />
          {renderPanel(place, office, view, setPlace)}
        </main>
      </div>
      <Toast text={office.toast} />
    </div>
  );
}

function renderPanel(place: PlaceId, office: OfficeHandle, view: OfficeView, go: (p: PlaceId) => void): ReactNode {
  switch (place) {
    case "door":
      return <CheckIn office={office} view={view} onDone={() => go("meeting")} />;
    case "meeting":
      return <MorningPT office={office} view={view} />;
    case "weekly":
      return <Weekly office={office} view={view} onGo={go} />;
    case "settings":
      return <Settings office={office} view={view} />;
    case "manager":
      return <MailBox office={office} view={view} onGo={go} />;
    case "desk":
      switch (view.phase.value) {
        case "sharing":
          return <Share office={office} view={view} />;
        case "checkoutReview":
          return <Checkout office={office} view={view} />;
        case "off":
          return <DayEnd office={office} view={view} onGo={go} />;
        case "checkout":
        case "dinner":
        case "overtime":
        case "overtimeReview":
          return <OvertimePanel office={office} view={view} />;
        default:
          return <Desk office={office} view={view} onGo={go} />;
      }
    default:
      return (
        <Notice kind="info" title="준비 중인 화면입니다">
          이 장소의 화면은 다음 작업에서 붙입니다.
        </Notice>
      );
  }
}

function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {text}
    </div>
  );
}
