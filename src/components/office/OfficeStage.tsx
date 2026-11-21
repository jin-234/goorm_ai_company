"use client";
/**
 * 3D 사무실을 화면에 붙이는 곳.
 * - 넓은 화면(861px 이상)이고 WebGL이 되면 맥 앱처럼 3D 사무실이 화면 전체를 채운다(OfficeBackdrop).
 * - 3D를 숨겼거나, WebGL이 안 되거나, 좁은 화면이면 2D 배치로 돌아간다. 좁은 화면에서는 2D 위에 3D 띠를 둔다(OfficeStage).
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

  return { full: canDraw && wide && !hidden, canDraw, hidden, setHidden };
}

/** 화면 전체를 채우는 3D 사무실(맥 앱 배치). 장소 이름표를 누르면 그 장소의 패널을 연다. */
export function OfficeBackdrop({
  view,
  onGo,
  onEntranceEnd,
  onShareReady,
  onLeaveEnd,
}: {
  view: OfficeView;
  onGo: (place: PlaceId) => void;
  onEntranceEnd?: () => void;
  onShareReady?: () => void;
  onLeaveEnd?: () => void;
}) {
  return <Office3D view={view} onPlace={(p) => onGo(p)} onEntranceEnd={onEntranceEnd} onShareReady={onShareReady} onLeaveEnd={onLeaveEnd} />;
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
