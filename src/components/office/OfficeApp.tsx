"use client";
/**
 * 웹 화면의 큰 틀.
 * - 넓은 화면 + WebGL: 맥 앱처럼 3D 사무실이 화면 전체를 채우고 위 막대만 그 위에 뜬다.
 *   지금 할 일 버튼과 메일·주간보고·설정은 위 막대에 있다. 3D 장소 이름표를 누르면 오른쪽에서 패널이 나온다(닫기·Esc).
 * - 3D를 숨겼거나 못 그리거나 좁은 화면: 위 막대 + 왼쪽 장소 이름표 + 패널의 2D 배치(웹 기획서 7장).
 * 어느 쪽이든 단계가 바뀌면 그 단계의 패널을 자동으로 연다(맥 앱과 같은 규칙).
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { OfficeView } from "./api";
import { Onboarding } from "./panels/Onboarding";
import { applySavedTextScale } from "./panels/Settings";
import { placeForPhase, renderPanel } from "./panels";
import { NowPanel } from "./NowPanel";
import { OfficeBackdrop, OfficeStage, type StageMode, useStageMode } from "./OfficeStage";
import { nextStepOf, TopBar } from "./TopBar";
import { type PlaceId, Notice } from "./ui";
import { type OfficeHandle, useOffice } from "./useOffice";

interface PlaceInfo {
  id: PlaceId;
  name: string;
  sub: (view: OfficeView) => string;
}

const PLACES: PlaceInfo[] = [
  { id: "door", name: "출입문", sub: (v) => (v.day.checkInAt != null ? "출근 완료" : "사원증 찍고 출근") },
  { id: "meeting", name: "회의실", sub: (v) => (v.phase.value === "morningPT" ? "지금 아침보고" : "아침보고 · AI 팀장") },
  {
    id: "desk",
    name: "내 책상",
    sub: (v) => {
      const tasks = v.day.tasks;
      const done = tasks.filter((t) => t.status === "submitted" || t.status === "reviewed").length;
      return tasks.length > 0 ? `과제 · 제출 ${done}/${tasks.length}` : "과제 · 결과물 제출";
    },
  },
  { id: "share", name: "기획팀", sub: () => "AI 기획자에게 공유" },
  { id: "manager", name: "팀장 자리", sub: (v) => (v.mail.unreadCount > 0 ? `메일함 · 안 읽음 ${v.mail.unreadCount}` : "사내 메일함") },
  { id: "weekly", name: "주간보고", sub: (v) => (v.clock.isFriday ? "오늘 제출" : "금요일에 제출") },
  { id: "settings", name: "설정", sub: () => "Solar 연결 · 처음부터" },
];

/** 3D 화면에서 이름표가 없는 곳(메일함은 팀장 자리 이름표에도 있다). */
const EXTRA_PLACES: PlaceInfo[] = PLACES.filter((p) => p.id === "manager" || p.id === "weekly" || p.id === "settings");

export function OfficeApp() {
  const office = useOffice();
  const { view } = office;
  const stage = useStageMode();
  // 3D 화면에서는 패널을 닫을 수 있어 null(닫힘)이 된다. 2D 화면은 늘 한 패널을 보여 준다.
  const [place, setPlace] = useState<PlaceId | null>("door");
  const lastPhase = useRef<string | null>(null);

  // 3D 화면: Esc로 패널을 닫는다. 입력칸에서 한글을 조합하는 중의 Esc는 조합 취소이니 무시한다.
  useEffect(() => {
    if (!stage.full || place == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) setPlace(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage.full, place]);

  useEffect(() => {
    applySavedTextScale();
  }, []);

  // 출근·퇴근 연출(3D) 동안은 패널을 닫아 둔다. 그동안 열려던 패널은 연출이 끝나면 연다(맥 앱 입장·퇴근 장면).
  // 3D가 끝났다고 알리지 못하는 경우를 대비해 정해진 시간 뒤에는 연다.
  const [cutscene, setCutscene] = useState<"entrance" | "leave" | null>(null);
  const pending = useRef<PlaceId | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endCutscene = useCallback(() => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    setCutscene(null);
    if (pending.current) setPlace(pending.current);
    pending.current = null;
  }, []);
  const startCutscene = useCallback(
    (kind: "entrance" | "leave", then: PlaceId) => {
      if (fallback.current) clearTimeout(fallback.current);
      pending.current = then;
      setPlace(null);
      setCutscene(kind);
      // 실측: 입장 약 5.4초, 퇴근 약 8.6초.
      fallback.current = setTimeout(endCutscene, kind === "entrance" ? 8000 : 11000);
    },
    [endCutscene],
  );
  useEffect(() => () => {
    if (fallback.current) clearTimeout(fallback.current);
  }, []);
  /** 패널 열기. 연출 중이면 끝난 뒤로 미룬다(출근 패널의 '다음은 회의실' 같은 이동도 여기로 온다). */
  const go = useCallback(
    (next: PlaceId | null) => {
      if (cutscene && next) pending.current = next;
      else setPlace(next);
    },
    [cutscene],
  );

  // 단계가 바뀌면 그 단계의 패널로(처음 불러올 때도). 3D 화면에서 출근·퇴근 순간이면 연출부터.
  const prevPhase = useRef<string | null>(null);
  useEffect(() => {
    if (!view) return;
    const key = `${view.clock.date}:${view.phase.value}`;
    if (lastPhase.current === key) return;
    lastPhase.current = key;
    const before = prevPhase.current;
    prevPhase.current = view.phase.value;
    const target = placeForPhase(view);
    if (stage.full && before === "beforeCheckIn" && view.phase.value !== "beforeCheckIn") startCutscene("entrance", target);
    else if (stage.full && before != null && before !== "off" && view.phase.value === "off") startCutscene("leave", target);
    else setPlace(target);
  }, [view, stage.full, startCutscene]);

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
    if (stage.full) {
      // 맥 앱처럼 사무실을 뒤에 두고 입사 안내를 그 위에 띄운다.
      return (
        <FixedStage>
        <div className="o3">
          <div className="o3-canvas" aria-hidden>
            <OfficeBackdrop view={view} onGo={() => undefined} />
          </div>
          <div className="o3-modal" role="dialog" aria-modal="true" aria-label="가상회사 입사 안내">
            <div className="o3-modal-card">
              <Onboarding office={office} />
            </div>
          </div>
          <Toast text={office.toast} />
        </div>
        </FixedStage>
      );
    }
    return (
      <>
        <Onboarding office={office} />
        <Toast text={office.toast} />
      </>
    );
  }

  if (stage.full) return <FullOffice office={office} view={view} place={place} setPlace={go} onCutsceneEnd={endCutscene} />;

  const shown: PlaceId = place ?? placeForPhase(view);
  const now = nextStepOf(view)?.place;
  return (
    <div className="app">
      <TopBar office={office} view={view} onGo={setPlace} place={shown} />
      {office.loadError ? (
        <div style={{ padding: "8px 20px" }}>
          <Notice kind="warning" title="서버와 연결이 잠시 끊겼습니다">
            {office.loadError}
          </Notice>
        </div>
      ) : null}
      <div className="layout">
        <div className="sidebar">
          <NowPanel view={view} onGo={setPlace} place={shown} />
          <nav className="places" aria-label="사무실 장소">
            {PLACES.map((p) => (
              <button
                key={p.id}
                className={`place ${shown === p.id ? "active" : ""} ${now === p.id && shown !== p.id ? "now" : ""}`}
                onClick={() => setPlace(p.id)}
                aria-current={shown === p.id ? "page" : undefined}
              >
                <div className="name">{p.name}</div>
                <div className="sub">{p.sub(view)}</div>
              </button>
            ))}
          </nav>
        </div>
        <main className="panel-area">
          <OfficeStage view={view} onGo={setPlace} mode={stage} />
          {renderPanel(shown, office, view, setPlace)}
        </main>
      </div>
      <Toast text={office.toast} />
    </div>
  );
}

/** 맥 앱 배치: 3D 사무실 전체 화면 + 위 막대 + 왼쪽 '지금 할 일' 카드 + 오른쪽에서 나오는 패널. */
function FullOffice({
  office,
  view,
  place,
  setPlace,
  onCutsceneEnd,
}: {
  office: OfficeHandle;
  view: OfficeView;
  place: PlaceId | null;
  setPlace: (p: PlaceId | null) => void;
  onCutsceneEnd: () => void;
}) {
  const title = PLACES.find((p) => p.id === place)?.name ?? "";
  return (
    <FixedStage>
    <div className={`o3 ${place ? "with-panel" : ""}`}>
      <div className="o3-canvas">
        <OfficeBackdrop view={view} onGo={setPlace} onEntranceEnd={onCutsceneEnd} onLeaveEnd={onCutsceneEnd} />
      </div>

      <div className="o3-top">
        <TopBar office={office} view={view} onGo={setPlace} place={place} />
        {office.loadError ? (
          <div style={{ padding: "8px 20px" }}>
            <Notice kind="warning" title="서버와 연결이 잠시 끊겼습니다">
              {office.loadError}
            </Notice>
          </div>
        ) : null}
      </div>

      {place ? (
        <aside className="o3-panel" aria-label={`${title} 패널`} key={place}>
          <button className="o3-close" onClick={() => setPlace(null)} aria-label="패널 닫기" title="닫기 (Esc)">
            ×
          </button>
          <div className="o3-panel-body">{renderPanel(place, office, view, setPlace)}</div>
        </aside>
      ) : null}
      <Toast text={office.toast} />
    </div>
    </FixedStage>
  );
}

/** 맥 앱 기본 창(1440×900, 16:10)을 기준으로 화면 전체를 고정한다. 창 크기와 상관없이 같은 구도로 보이고, 창에 맞춰 통째로 확대·축소한다. */
const STAGE_W = 1440;
const STAGE_H = 900;

function FixedStage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="o3-frame">
      <div className="o3-scaler" style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {text}
    </div>
  );
}
