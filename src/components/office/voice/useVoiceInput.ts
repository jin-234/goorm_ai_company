"use client";
/**
 * 말 → 글. 브라우저 내장 음성 인식(Web Speech API, 한국어)을 쓴다. 키·요금이 없다.
 * 화면(버튼 모양·문구·배치)은 담지 않는다. 화면은 phase와 error만 보고 그리면 되고, 기본 모양은 VoiceInput.tsx에 있다.
 *
 * - Chrome·Edge에서 동작한다. 소리는 브라우저 회사 서버에서 글로 바뀌고, 우리 서버는 거치지 않는다.
 * - 지원하지 않는 브라우저면 phase = "unavailable" → 버튼을 숨기고 글 칸만 둔다.
 * - 인식이 실패하면 phase = "failed" + error. 사용자가 적은 글은 건드리지 않고, 인식된 글은 onText로만 넘긴다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type VoicePhase = "checking" | "unavailable" | "idle" | "recording" | "transcribing" | "failed";

export interface VoiceError {
  kind: string;
  title: string;
  guidance: string;
}

export interface VoiceInputOptions {
  /** 인식된 글. 기존 글에 덧붙일지 바꿀지는 부르는 쪽이 정한다. */
  onText: (text: string) => void;
  /** 이 시간이 지나면 저절로 멈추고 글로 옮긴다. 기본 180초. */
  maxSeconds?: number;
}

export interface VoiceInput {
  phase: VoicePhase;
  /** unavailable일 때 이유(글로 적어 달라는 안내 포함). */
  unavailableReason: string | null;
  error: VoiceError | null;
  /** 말한 초 */
  elapsed: number;
  maxSeconds: number;
  start: () => void;
  /** 듣기를 끝내고 글로 옮긴다. */
  stop: () => void;
  /** 들은 것을 버린다. */
  cancel: () => void;
  /** 오류 안내를 닫고 처음으로. */
  dismiss: () => void;
}

const TYPE_HINT = "아래 칸에 직접 적어도 됩니다.";

/** 브라우저 내장 음성 인식. 표준 타입이 없어 필요한 만큼만 적는다. */
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

const voiceError = (kind: string, title: string, guidance: string): VoiceError => ({ kind, title, guidance: `${guidance}\n${TYPE_HINT}` });

function errorOf(code: string): VoiceError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return voiceError("micDenied", "마이크를 쓸 수 없습니다", "주소창 옆 마이크 권한을 허용한 뒤 다시 눌러 주세요.");
    case "audio-capture":
      return voiceError("noMic", "마이크를 찾지 못했습니다", "마이크가 연결되어 있는지 확인해 주세요.");
    case "network":
      return voiceError("offline", "음성 인식 서버에 연결하지 못했습니다", "인터넷 연결을 확인한 뒤 다시 눌러 주세요.");
    case "no-speech":
      return voiceError("noSpeech", "말소리를 듣지 못했습니다", "마이크 가까이에서 다시 말해 주세요.");
    default:
      return voiceError("browser", "음성 인식을 하지 못했습니다", "잠시 뒤 다시 눌러 주세요.");
  }
}

export function useVoiceInput({ onText, maxSeconds = 180 }: VoiceInputOptions): VoiceInput {
  const [phase, setPhase] = useState<VoicePhase>("checking");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [error, setError] = useState<VoiceError | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const heard = useRef<string[]>([]);
  const discard = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  // 처음 한 번: 이 브라우저가 음성 인식을 지원하는지.
  useEffect(() => {
    mounted.current = true;
    if (browserSpeech()) setPhase("idle");
    else {
      setUnavailableReason(`이 브라우저는 음성 인식을 지원하지 않습니다.\nChrome이나 Edge에서 열면 말로 할 수 있습니다.\n${TYPE_HINT}`);
      setPhase("unavailable");
    }
    return () => {
      mounted.current = false;
      discard.current = true;
      recognition.current?.abort();
      clearTimer();
    };
  }, []);

  /** 말하는 동안 확정된 문장을 모았다가, 멈추면 한 번에 넘긴다. */
  const start = useCallback(() => {
    const Recognition = browserSpeech();
    if (!Recognition || recognition.current) return;
    setError(null);
    const rec = new Recognition();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = false;
    heard.current = [];
    discard.current = false;
    let failure: VoiceError | null = null;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal && r[0].transcript.trim()) heard.current.push(r[0].transcript.trim());
      }
    };
    rec.onerror = (ev) => {
      if (ev.error !== "aborted") failure = errorOf(ev.error);
    };
    // 멈춤 버튼·시간 초과·조용해서 브라우저가 스스로 끝낸 경우 모두 여기로 온다.
    rec.onend = () => {
      clearTimer();
      recognition.current = null;
      if (!mounted.current) return;
      const text = heard.current.join(" ").trim();
      heard.current = [];
      if (discard.current) return setPhase("idle");
      if (text) {
        setPhase("idle");
        onTextRef.current(text);
      } else {
        setError(failure ?? errorOf("no-speech"));
        setPhase("failed");
      }
    };
    recognition.current = rec;
    try {
      rec.start();
    } catch {
      recognition.current = null;
      setError(errorOf("start"));
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

  const stop = useCallback(() => {
    if (!recognition.current) return;
    // 마지막 문장이 확정될 때까지 잠깐 걸린다. onend에서 글을 넘긴다.
    setPhase("transcribing");
    recognition.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recognition.current) recognition.current.abort();
    else setPhase("idle");
  }, []);

  const dismiss = useCallback(() => {
    setError(null);
    setPhase("idle");
  }, []);

  return { phase, unavailableReason, error, elapsed, maxSeconds, start, stop, cancel, dismiss };
}
