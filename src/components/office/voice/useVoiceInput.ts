"use client";
/**
 * 녹음 → 서버(/api/stt, OpenAI) → 글. 화면(버튼 모양·문구·배치)은 담지 않는다.
 * 화면은 phase와 error만 보고 그리면 되고, 기본 모양은 VoiceInput.tsx에 있다.
 *
 * 글 입력으로 대신하는 길
 * - 브라우저가 녹음을 못 하거나 서버에 키가 없으면 phase = "unavailable" → 녹음 버튼을 숨기고 글 칸만 둔다.
 * - 인식이 실패하면 phase = "failed" + error. 녹음은 남겨 두므로 error.canRetry면 retry()로 다시 보낸다.
 *   error.typeOnly(키 없음·인증·한도)면 다시 해도 안 되니 글 입력을 권한다.
 * - 어느 경우든 사용자가 적은 글은 건드리지 않는다. 인식된 글은 onText로만 넘긴다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type SttErrorInfo } from "../api";

export type VoicePhase = "checking" | "unavailable" | "idle" | "recording" | "transcribing" | "failed";

export interface VoiceInputOptions {
  /** 인식된 글. 기존 전사문에 덧붙일지 바꿀지는 부르는 쪽이 정한다. */
  onText: (text: string) => void;
  /** 이 시간이 지나면 저절로 멈추고 보낸다. 기본 180초(32kbps면 약 0.7MB). */
  maxSeconds?: number;
}

export interface VoiceInput {
  phase: VoicePhase;
  /** unavailable일 때 이유(글로 적어 달라는 안내 포함). */
  unavailableReason: string | null;
  error: SttErrorInfo | null;
  /** 녹음한 초 */
  elapsed: number;
  maxSeconds: number;
  start: () => Promise<void>;
  /** 녹음을 끝내고 글로 옮긴다. */
  stop: () => void;
  /** 녹음을 버린다. */
  cancel: () => void;
  /** 실패한 녹음을 다시 보낸다. */
  retry: () => Promise<void>;
  /** 오류 안내를 닫고 처음으로. */
  dismiss: () => void;
}

const TYPE_HINT = "아래 칸에 직접 적어도 됩니다.";
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

function browserCanRecord(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

const localError = (kind: string, title: string, guidance: string): SttErrorInfo => ({
  kind,
  title,
  guidance: `${guidance}\n${TYPE_HINT}`,
  canRetry: false,
  typeOnly: false,
});

export function useVoiceInput({ onText, maxSeconds = 180 }: VoiceInputOptions): VoiceInput {
  const [phase, setPhase] = useState<VoicePhase>("checking");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [error, setError] = useState<SttErrorInfo | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const lastAudio = useRef<Blob | null>(null);
  const discard = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const releaseMic = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  // 처음 한 번: 브라우저와 서버가 음성 인식을 할 수 있는지.
  useEffect(() => {
    mounted.current = true;
    if (!browserCanRecord()) {
      setUnavailableReason(`이 브라우저는 녹음을 지원하지 않습니다.\n${TYPE_HINT}`);
      setPhase("unavailable");
    } else {
      api
        .sttStatus()
        .then((s) => {
          if (!mounted.current) return;
          if (s.enabled) setPhase("idle");
          else {
            setUnavailableReason(`음성 인식이 아직 켜지지 않았습니다.\n${TYPE_HINT}`);
            setPhase("unavailable");
          }
        })
        // 상태 확인만 실패한 것이면 녹음은 해 보게 둔다. 실제 실패는 보낼 때 알린다.
        .catch(() => mounted.current && setPhase("idle"));
    }
    return () => {
      mounted.current = false;
      discard.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      releaseMic();
    };
  }, [releaseMic]);

  const send = useCallback(async (audio: Blob) => {
    setPhase("transcribing");
    setError(null);
    try {
      const { text } = await api.transcribe(audio);
      if (!mounted.current) return;
      lastAudio.current = null;
      setPhase("idle");
      onTextRef.current(text);
    } catch (e) {
      if (!mounted.current) return;
      const info =
        e instanceof ApiError && e.stt
          ? e.stt
          : e instanceof ApiError && e.type === "network"
            ? { ...localError("offline", "서버에 연결하지 못했습니다", "인터넷 연결을 확인한 뒤 다시 시도해 주세요."), canRetry: true }
            : { ...localError("server", "음성 인식을 하지 못했습니다", e instanceof Error ? e.message : "잠시 뒤 다시 시도해 주세요."), canRetry: true };
      if (info.typeOnly) lastAudio.current = null;
      setError(info);
      setPhase("failed");
    }
  }, []);

  const start = useCallback(async () => {
    if (recorder.current?.state === "recording") return;
    setError(null);
    lastAudio.current = null;
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? localError("micDenied", "마이크를 쓸 수 없습니다", "주소창 옆 마이크 권한을 허용한 뒤 다시 눌러 주세요.")
          : localError("noMic", "마이크를 찾지 못했습니다", "마이크가 연결되어 있는지 확인해 주세요."),
      );
      setPhase("failed");
      return;
    }
    if (!mounted.current) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    stream.current = media;
    const mimeType = pickMime();
    const rec = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
    chunks.current = [];
    discard.current = false;
    rec.ondataavailable = (ev) => ev.data.size > 0 && chunks.current.push(ev.data);
    rec.onstop = () => {
      releaseMic();
      recorder.current = null;
      if (discard.current || !mounted.current) {
        if (mounted.current) setPhase("idle");
        return;
      }
      const audio = new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" });
      chunks.current = [];
      lastAudio.current = audio;
      void send(audio);
    };
    recorder.current = rec;
    rec.start(1000);
    setElapsed(0);
    const began = Date.now();
    timer.current = setInterval(() => {
      const sec = Math.floor((Date.now() - began) / 1000);
      setElapsed(sec);
      if (sec >= maxSeconds && rec.state === "recording") rec.stop();
    }, 250);
    setPhase("recording");
  }, [maxSeconds, releaseMic, send]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    else setPhase("idle");
  }, []);

  const retry = useCallback(async () => {
    if (lastAudio.current) await send(lastAudio.current);
  }, [send]);

  const dismiss = useCallback(() => {
    lastAudio.current = null;
    setError(null);
    setPhase("idle");
  }, []);

  return { phase, unavailableReason, error, elapsed, maxSeconds, start, stop, cancel, retry, dismiss };
}
