"use client";
/**
 * 2D 화면 위에 놓는 3D 사무실 띠. 장소를 누르면 그 장소의 2D 패널을 연다.
 * 3D가 무겁거나 방해되면 숨길 수 있다(웹 기획서 8장: 3D가 없어도 2D만으로 흐름이 끝까지 이어진다).
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { OfficeView } from "./api";
import type { PlaceId } from "./ui";

// three.js는 브라우저 전용이라 서버에서 그리지 않는다.
const Office3D = dynamic(() => import("@/components/office3d/Office3D").then((m) => m.Office3D), {
  ssr: false,
  loading: () => <div className="stage-loading muted">3D 사무실을 불러오는 중입니다.</div>,
});

const HIDE_KEY = "aiboss.hide3d";

export function OfficeStage({ view, onGo }: { view: OfficeView; onGo: (place: PlaceId) => void }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      // 저장소를 못 쓰면 보이는 상태로 둔다.
    }
  }, []);

  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      // 이번 화면에만 적용한다.
    }
  };

  return (
    <section className="stage" aria-label="3D 사무실">
      <div className="stage-head">
        <span className="small muted">{hidden ? "3D 사무실을 숨겼습니다." : "장소를 누르면 그 화면이 열립니다."}</span>
        <button className="btn plain small" onClick={toggle} aria-pressed={!hidden}>
          {hidden ? "3D 사무실 보기" : "3D 숨기기"}
        </button>
      </div>
      {hidden ? null : (
        <div className="stage-canvas">
          <Office3D view={view} onPlace={(p) => onGo(p)} />
        </div>
      )}
    </section>
  );
}
