"use client";
/**
 * 회사 상태를 들고 있는 훅.
 * - 5초마다 GET /api/office로 가상 시계를 맞춘다(서버가 흐른 실제 시간만큼 시계를 보낸다).
 * - 행동은 act()로 보내고, 서버가 돌려준 새 상태로 바꾼다.
 * - 규칙 위반·입력 오류는 서버의 한국어 메시지를 알림으로 보여 준다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type OfficeView } from "./api";

const POLL_MS = 5000;
const TOAST_MS = 4500;

export interface OfficeHandle {
  view: OfficeView | null;
  loadError: string | null;
  busy: boolean;
  toast: string | null;
  notify: (message: string) => void;
  /** 행동 하나. 성공하면 결과(result)를, 실패하면 null을 돌려준다(오류는 알림으로 보여 준다). */
  act: <T = unknown>(type: string, payload?: Record<string, unknown>) => Promise<T | null>;
  /** 서버를 부르는 다른 일(초안 만들기 등)을 같은 방식으로 감싼다. */
  run: <T extends { office: OfficeView }>(work: () => Promise<T>) => Promise<T | null>;
  refresh: () => Promise<void>;
  setView: (view: OfficeView) => void;
}

export function useOffice(): OfficeHandle {
  const [view, setView] = useState<OfficeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inFlight = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const refresh = useCallback(async () => {
    // 행동을 보내는 중이면 폴링 결과가 새 상태를 덮어쓰지 않게 건너뛴다.
    if (inFlight.current > 0) return;
    try {
      const next = await api.office();
      if (inFlight.current === 0) setView(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "상태를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = useCallback(
    async <T extends { office: OfficeView }>(work: () => Promise<T>): Promise<T | null> => {
      inFlight.current += 1;
      setBusy(true);
      try {
        const res = await work();
        setView(res.office);
        return res;
      } catch (error) {
        notify(error instanceof ApiError ? error.message : "처리하지 못했습니다.\n잠시 뒤 다시 시도해 주세요.");
        return null;
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setBusy(false);
      }
    },
    [notify],
  );

  const act = useCallback(
    async <T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T | null> => {
      const res = await run(() => api.act(type, payload));
      return res ? ((res.result ?? {}) as T) : null;
    },
    [run],
  );

  return { view, loadError, busy, toast, notify, act, run, refresh, setView };
}
