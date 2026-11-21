"use client";
/**
 * 말 → 글. 화면(버튼 모양·문구·배치)은 담지 않는다.
 * 화면은 phase와 error만 보고 그리면 되고, 기본 모양은 VoiceInput.tsx에 있다.
 *
 * 인식 방식(engine)
 * - openai: 녹음 → 서버(/api/stt, OpenAI). 서버에 OPENAI_API_KEY가 있을 때. 사용량만큼 요금이 나간다.
 * - browser: 브라우저 내장 음성 인식(Web Speech API). 키가 없을 때 쓰는 무료 방식.
 *   Chrome·Edge에서 잘 되고, 소리는 브라우저 회사 서버에서 글로 바뀐다(우리 서버는 거치지 않는다).
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
export type VoiceEngine = "openai" | "browser";

export interface VoiceInputOptions {
  /** 인식된 글. 기존 전사문에 덧붙일지 바꿀지는 부르는 쪽이 정한다. */
  onText: (text: string) => void;
  /** 이 시간이 지나면 저절로 멈추고 보낸다. 기본 180초(32kbps면 약 0.7MB). */
  maxSeconds?: number;
}

export interface VoiceInput {
  phase: VoicePhase;
  /** 지금 쓰는 인식 방식. 확인 전에는 null. */
  engine: VoiceEngine | null;
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

/** 브라우저 내장 음성 인식(Web Speech API). 표준 타입이 없어 필요한 만큼만 적는다. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function browserSpeech(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return ((w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined) ?? null;
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
  const [engine, setEngine] = useState<VoiceEngine | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const heard = useRef<string[]>([]);
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

  // 처음 한 번: 서버 키(OpenAI)가 있으면 그걸, 없으면 브라우저 내장 인식을 쓴다.
  useEffect(() => {
    mounted.current = true;
    const use = (next: VoiceEngine | null) => {
      if (!mounted.current) return;
      setEngine(next);
      if (next) setPhase("idle");
      else {
        setUnavailableReason(
          browserCanRecord()
            ? `이 브라우저는 무료 음성 인식을 지원하지 않습니다.\nChrome이나 Edge에서 열면 말로 할 수 있습니다.\n${TYPE_HINT}`
            : `이 브라우저는 녹음을 지원하지 않습니다.\n${TYPE_HINT}`,
        );
        setPhase("unavailable");
      }
    };
    const fallback = () => use(browserSpeech() ? "browser" : null);
    if (!browserCanRecord()) fallback();
    else
      api
        .sttStatus()
        .then((s) => (s.enabled ? use("openai") : fallback()))
        // 상태 확인만 실패한 것이면 브라우저 인식이 되면 그걸, 아니면 서버로 녹음을 보내 본다.
        .catch(() => use(browserSpeech() ? "browser" : "openai"));
    return () => {
      mounted.current = false;
      discard.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      recognition.current?.abort();
      releaseMic();
    };
  }, [releaseMic]);

  /** 브라우저 내장 인식: 말하는 동안 확정된 문장을 모았다가, 멈추면 한 번에 넘긴다. */
  const startBrowser = useCallback(() => {
    const Recognition = browserSpeech();
    if (!Recognition) return;
    const rec = new Recognition();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = false;
    heard.current = [];
    discard.current = false;
    let failure: SttErrorInfo | null = null;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal && r[0].transcript.trim()) heard.current.push(r[0].transcript.trim());
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "aborted") return;
      failure =
        ev.error === "not-allowed" || ev.error === "service-not-allowed"
          ? localError("micDenied", "마이크를 쓸 수 없습니다", "주소창 옆 마이크 권한을 허용한 뒤 다시 눌러 주세요.")
          : ev.error === "audio-capture"
            ? localError("noMic", "마이크를 찾지 못했습니다", "마이크가 연결되어 있는지 확인해 주세요.")
            : ev.error === "network"
              ? localError("offline", "음성 인식 서버에 연결하지 못했습니다", "인터넷 연결을 확인한 뒤 다시 눌러 주세요.")
              : ev.error === "no-speech"
                ? localError("noSpeech", "말소리를 듣지 못했습니다", "마이크 가까이에서 다시 말해 주세요.")
                : localError("browser", "음성 인식을 하지 못했습니다", "잠시 뒤 다시 눌러 주세요.");
    };
    // 멈춤 버튼·시간 초과·조용해서 브라우저가 스스로 끝낸 경우 모두 여기로 온다.
    rec.onend = () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      recognition.current = null;
      if (!mounted.current) return;
      const text = heard.current.join(" ").trim();
      heard.current = [];
      if (discard.current) return setPhase("idle");
      if (text) {
        setPhase("idle");
        onTextRef.current(text);
      } else {
        setError(failure ?? localError("noSpeech", "말소리를 듣지 못했습니다", "마이크 가까이에서 다시 말해 주세요."));
        setPhase("failed");
      }
    };
    recognition.current = rec;
    try {
      rec.start();
    } catch {
      recognition.current = null;
      setError(localError("browser", "음성 인식을 시작하지 못했습니다", "잠시 뒤 다시 눌러 주세요."));
      setPhase("failed");
      return;
    }
    setElapsed(0);
    const began = Date.now();
    timer.current = setInterval(() => {
      const sec = Math.floor((Date.now() - began) / 1000);
      setElapsed(sec);
      if (sec >= maxSeconds) rec.stop();
    }, 250);
    setPhase("recording");
  }, [maxSeconds]);

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
    if (recorder.current?.state === "recording" || recognition.current) return;
    setError(null);
    lastAudio.current = null;
    if (engine === "browser") return startBrowser();
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
  }, [engine, maxSeconds, releaseMic, send, startBrowser]);

  const stop = useCallback(() => {
    if (recognition.current) {
      // 마지막 문장이 확정될 때까지 잠깐 걸린다. onend에서 글을 넘긴다.
      setPhase("transcribing");
      recognition.current.stop();
    } else if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recognition.current) recognition.current.abort();
    else if (recorder.current?.state === "recording") recorder.current.stop();
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

  return { phase, engine, unavailableReason, error, elapsed, maxSeconds, start, stop, cancel, retry, dismiss };
}
