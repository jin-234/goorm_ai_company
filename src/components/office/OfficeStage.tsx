"use client";
/**
 * 3D 사무실을 화면에 붙이는 곳.
 * - WebGL이 되면 창 크기와 상관없이 맥 앱처럼 3D 사무실이 화면 전체를 채운다(OfficeBackdrop, 16:10 고정 무대).
 * - WebGL이 안 될 때만 2D 배치로 돌아간다(OfficeStage).
 *   웹 기획서 8장: 3D가 없어도 2D만으로 하루 흐름이 끝까지 이어진다.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { OfficeView } from "./api";
import type { PlaceId } from "./ui";

// three.js는 브라우저 전용이라 서버에서 그리지 않는다.
const Office3D = dynamic(() => import("@/components/office3d/Office3D").then((m) => m.Office3D), {
  ssr: false,
  loading: () => <div className="stage-loading muted">3D 사무실을 불러오는 중입니다.</div>,
});

const HIDE_KEY = "aiboss.hide3d";

const WIDE = "(min-width: 861px)";

function webglWorks(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export interface StageMode {
  /** 3D를 화면 전체에 쓴다(맥 앱 배치). */
  full: boolean;
  /** 3D를 그릴 수 있다(WebGL). */
  canDraw: boolean;
  /** 사용자가 3D를 숨겼다. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

/** 지금 화면에서 3D를 어떻게 쓸지. 처음 그릴 때(서버)는 2D로 시작하고 브라우저에서 바로 정한다. */
export function useStageMode(): StageMode {
  const [canDraw, setCanDraw] = useState(false);
  const [wide, setWide] = useState(false);
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    setCanDraw(webglWorks());
    try {
      setHiddenState(localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      // 저장소를 못 쓰면 보이는 상태로 둔다.
    }
    const media = window.matchMedia(WIDE);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next);
    try {
      localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      // 이번 화면에만 적용한다.
    }
  }, []);

  // 사용자 지시: 창 크기와 상관없이 늘 맥 앱 배치(3D 전체 화면, 16:10 고정)로 띄운다. 2D 배치는 WebGL이 안 될 때만.
  void wide;
  return { full: canDraw, canDraw, hidden, setHidden };
}

/** 화면 전체를 채우는 3D 사무실(맥 앱 배치). 장소 이름표를 누르면 그 장소의 패널을 연다. */
export function OfficeBackdrop({
  view,
  onGo,
  onEntranceEnd,
  onShareReady,
  onLeaveEnd,
  place = null,
}: {
  view: OfficeView;
  onGo: (place: PlaceId) => void;
  onEntranceEnd?: () => void;
  onShareReady?: () => void;
  onLeaveEnd?: () => void;
  /** 지금 열린 패널. 패널이 3D 화면 오른쪽을 가리므로 그 장소를 비춰 잘리지 않게 한다. */
  place?: PlaceId | null;
}) {
  return (
    <Office3D
      view={view}
      focus={focusFor(place, (view.day.share as { stage?: string | null }).stage ?? null)}
      onPlace={(p) => onGo(p)}
      onEntranceEnd={onEntranceEnd}
      onShareReady={onShareReady}
      onLeaveEnd={onLeaveEnd}
    />
  );
}

/** 패널 → 3D 구도. 장소가 있는 패널은 그 장소로 다가가고, 나머지(메일·설정·출입문)는 전체 보기.
 *  공유 패널은 진행 단계에 따라: 팀장 사전 보고(review)·컨펌(confirm) → 팀장 자리, 부서 회의(meeting)·정리(closed) → 회의실. */
function focusFor(place: PlaceId | null, shareStage: string | null): "overview" | "meeting" | "share" | "desk" | "manager" {
  switch (place) {
    case "meeting":
      return "meeting";
    case "share":
      // 개발팀장 사전 보고(review)와 컨펌 카드(confirm) 동안은 팀장 자리 앞이라 팀장 쪽을 비춘다.
      return shareStage === "review" || shareStage === "confirm" ? "manager" : "share";
    case "desk":
      return "desk";
    case "manager":
      return "manager";
    default:
      return "overview";
  }
}

/** 2D 배치 위에 놓는 3D 사무실 띠(좁은 화면) 또는 3D 다시 보기 버튼(3D를 숨긴 넓은 화면). */
export function OfficeStage({ view, onGo, mode }: { view: OfficeView; onGo: (place: PlaceId) => void; mode: StageMode }) {
  if (!mode.canDraw) {
    return <p className="small muted">이 브라우저에서는 3D 사무실을 그릴 수 없어 2D 화면으로 보여 줍니다.</p>;
  }
  const showStrip = !mode.hidden;
  return (
    <section className="stage" aria-label="3D 사무실">
      <div className="stage-head">
        <span className="small muted">{mode.hidden ? "3D 사무실을 숨겼습니다." : "장소를 누르면 그 화면이 열립니다."}</span>
        <button className="btn plain small" onClick={() => mode.setHidden(!mode.hidden)} aria-pressed={!mode.hidden}>
          {mode.hidden ? "3D 사무실 보기" : "3D 숨기기"}
        </button>
      </div>
      {showStrip ? (
        <div className="stage-canvas">
          <Office3D view={view} onPlace={(p) => onGo(p)} />
        </div>
      ) : null}
    </section>
  );
}
