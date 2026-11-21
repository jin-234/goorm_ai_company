/**
 * 출근 카메라 제어(React와 무관). 카메라 켜기 → 얼굴 검출 반복 → SeatJudge로 판정 → 상태 알림.
 * 영상은 기기 안에서만 쓰고 저장·전송하지 않는다. 멈추면 스트림의 모든 트랙을 끈다.
 */
import { cameraFailure, type SeatCameraState, SeatJudge } from "./seatJudge";

/** 얼굴 검출기. 영상 한 장면에 얼굴이 있는지만 알려 준다(누구인지는 보지 않는다). */
export interface FaceDetectorLike {
  hasFace(video: HTMLVideoElement, now: number): Promise<boolean> | boolean;
  close(): void;
}

export interface SeatCameraSnapshot {
  state: SeatCameraState;
  reason: string | null;
  noFaceSeconds: number;
}

export interface SeatCameraDeps {
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null;
  loadDetector: () => Promise<FaceDetectorLike>;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

/** 검출 간격. 너무 잦으면 노트북이 뜨거워지고, 너무 드물면 판정이 늦다. */
export const DETECT_INTERVAL_MS = 250;

export const IDLE: SeatCameraSnapshot = { state: "idle", reason: null, noFaceSeconds: 0 };

export class SeatCameraController {
  private stream: MediaStream | null = null;
  private detector: FaceDetectorLike | null = null;
  private judge: SeatJudge | null = null;
  private timer: unknown = null;
  private busy = false;
  /** start/stop이 겹칠 때 늦게 끝난 옛 start가 상태를 덮지 않게 한다. */
  private generation = 0;
  private snapshot: SeatCameraSnapshot = IDLE;

  constructor(
    private readonly deps: SeatCameraDeps,
    private readonly getVideo: () => HTMLVideoElement | null,
    private readonly onChange: (s: SeatCameraSnapshot) => void,
  ) {}

  get current(): SeatCameraSnapshot {
    return this.snapshot;
  }

  async start(): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this.emit({ state: "asking", reason: null, noFaceSeconds: 0 });
    if (!this.deps.getUserMedia) {
      this.emit({ state: "unavailable", reason: "이 브라우저에서는 카메라를 쓸 수 없습니다.\n카메라 없이 출근할 수 있습니다.", noFaceSeconds: 0 });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (error) {
      if (gen !== this.generation) return;
      const f = cameraFailure(error);
      this.emit({ state: f.state, reason: f.reason, noFaceSeconds: 0 });
      return;
    }
    if (gen !== this.generation) return stopTracks(stream);
    this.stream = stream;

    let detector: FaceDetectorLike;
    try {
      detector = await this.deps.loadDetector();
    } catch (error) {
      if (gen !== this.generation) return;
      this.stop();
      const f = cameraFailure(error);
      this.emit({ state: f.state, reason: f.reason, noFaceSeconds: 0 });
      return;
    }
    if (gen !== this.generation) return detector.close();
    this.detector = detector;
    this.judge = new SeatJudge(this.deps.now());
    this.emit({ state: "noFace", reason: null, noFaceSeconds: 0 });
    this.timer = this.deps.setInterval(() => void this.tick(), DETECT_INTERVAL_MS);
  }

  /** 검출 한 번. 시험에서 직접 부른다. */
  async tick(): Promise<void> {
    const video = this.getVideo();
    if (this.busy || !this.judge || !this.detector || !this.stream || !video) return;
    if (video.srcObject !== this.stream) {
      video.srcObject = this.stream;
      video.muted = true;
      void video.play?.()?.catch?.(() => {});
    }
    if (video.readyState < 2) return; // 첫 장면이 아직 없다
    const gen = this.generation;
    this.busy = true;
    try {
      const now = this.deps.now();
      const seen = await this.detector.hasFace(video, now);
      if (gen !== this.generation || !this.judge) return;
      const state = this.judge.observe(seen, now);
      this.emit({ state, reason: null, noFaceSeconds: this.judge.noFaceSeconds(now) });
    } catch {
      // 한 장면 검출 실패는 '안 보임'과 같게 본다.
      if (gen === this.generation && this.judge) {
        const now = this.deps.now();
        const state = this.judge.observe(false, now);
        this.emit({ state, reason: null, noFaceSeconds: this.judge.noFaceSeconds(now) });
      }
    } finally {
      this.busy = false;
    }
  }

  /** 카메라를 끄고 idle로. 몇 번을 불러도 된다. */
  stop(): void {
    this.generation++;
    if (this.timer != null) this.deps.clearInterval(this.timer);
    this.timer = null;
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
    this.detector?.close();
    this.detector = null;
    this.judge = null;
    const video = this.getVideo();
    if (video && video.srcObject) video.srcObject = null;
    this.emit(IDLE);
  }

  private emit(next: SeatCameraSnapshot): void {
    const s = this.snapshot;
    if (s.state === next.state && s.reason === next.reason && s.noFaceSeconds === next.noFaceSeconds) return;
    this.snapshot = next;
    this.onChange(next);
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

// MARK: - 브라우저 기본값

/**
 * 기본 검출기: 브라우저 내장 얼굴 검출(Shape Detection API의 FaceDetector).
 * 지원하지 않는 브라우저면 DetectorUnavailable로 실패하고, 화면은 '카메라 없이 출근'을 보여 준다.
 * MediaPipe FaceDetector(blaze_face_short_range)로 바꾸려면 이 함수만 교체하면 된다.
 */
export async function loadBrowserFaceDetector(): Promise<FaceDetectorLike> {
  type NativeDetector = { detect(source: CanvasImageSource): Promise<unknown[]> };
  const Native = (globalThis as { FaceDetector?: new (o: { fastMode: boolean; maxDetectedFaces: number }) => NativeDetector }).FaceDetector;
  if (!Native) throw Object.assign(new Error("FaceDetector 없음"), { name: "DetectorUnavailable" });
  const native = new Native({ fastMode: true, maxDetectedFaces: 1 });
  return {
    async hasFace(video) {
      return (await native.detect(video)).length > 0;
    },
    close() {},
  };
}

export function browserDeps(): SeatCameraDeps {
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return {
    getUserMedia: media?.getUserMedia ? (c) => media.getUserMedia(c) : null,
    loadDetector: loadBrowserFaceDetector,
    now: () => Date.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
  };
}
