"use client";
/**
 * 기본 녹음 버튼. 화면을 새로 꾸밀 때는 이 파일을 고치거나, useVoiceInput만 가져다 직접 그려도 된다.
 * 글 입력 칸은 이 컴포넌트 밖(부르는 쪽)에 그대로 두어, 녹음이 안 돼도 언제든 적을 수 있게 한다.
 */
import { Notice } from "../ui";
import { useVoiceInput, type VoiceInputOptions } from "./useVoiceInput";

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export function VoiceInput({ disabled, ...options }: VoiceInputOptions & { disabled?: boolean }) {
  const voice = useVoiceInput(options);
  const { phase, error } = voice;

  if (phase === "checking") return null;
  if (phase === "unavailable") {
    return <Notice kind="info" title="말로 하기를 쓸 수 없습니다">{voice.unavailableReason}</Notice>;
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        {phase === "recording" ? (
          <>
            <button className="btn" onClick={voice.stop}>
              녹음 끝내고 글로 옮기기
            </button>
            <button className="btn plain small" onClick={voice.cancel}>
              취소
            </button>
            <span className="small muted" aria-live="polite">
              ● 녹음 중 {mmss(voice.elapsed)} / {mmss(voice.maxSeconds)}
            </span>
          </>
        ) : (
          <button className="btn secondary" onClick={voice.start} disabled={disabled || phase === "transcribing"}>
            {phase === "transcribing" ? "글로 옮기는 중" : "말로 하기 (녹음 시작)"}
          </button>
        )}
      </div>
      {phase === "failed" && error ? (
        <Notice kind="warning" title={error.title}>
          {error.guidance}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn plain small" onClick={voice.dismiss}>
              닫기
            </button>
          </div>
        </Notice>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          말한 내용을 글로 옮깁니다. 소리는 브라우저(Chrome·Edge) 제공사의 음성 인식으로 처리되고, 이 서비스에는 글만 남습니다.
        </p>
      )}
    </div>
  );
}
