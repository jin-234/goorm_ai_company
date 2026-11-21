"use client";
/**
 * 출입문 · 출근. 카메라로 자리에 앉은 것을 확인한 뒤 사원증을 찍어 들어간다(맥 앱 CheckInView 구성).
 * - 기본은 카메라 켜짐. 착석이 확인돼야 [사원증 찍고 출근하기]가 켜진다(checkIn method "camera").
 * - 권한 거부·카메라 없음·10초 넘게 사람이 안 보이면 [카메라 없이 출근]을 함께 준다(method "noCamera").
 * - 설정에서 카메라를 끄면 미리보기 없이 바로 출근한다. 카메라를 안 써도 불이익은 없다(개정 기획서 5장).
 * - 버튼을 누르면 카메라를 먼저 끄고 출근을 보낸다. 문이 열리는 연출은 3D가 맡는다.
 * 영상은 이 기기 안에서만 쓰고 저장·전송하지 않는다.
 * 관리 강도 보통·엄격: 시작 시각보다 늦으면 지각, 마감 시각까지 오지 않으면 결근 후보.
 * 놓친 날 복귀: 쉬는 날을 미리 알릴 수 있고, 쉰 날 다음에 돌아온 날은 지각으로 세지 않는다.
 */
import { useState } from "react";
import { hm } from "@/lib/office/time";
import { hhmm, type OfficeView } from "../api";
import { type SeatCameraState, useSeatCamera } from "../camera/useSeatCamera";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";
import { loadCameraPref } from "./cameraPref";
import { LowerTodayButton, MonthLine } from "./Enforcement";

const NO_FACE_FALLBACK_SECONDS = 10;

const STATUS: Record<SeatCameraState, { title: string; detail: string; kind: "info" | "ok" | "warning" }> = {
  idle: { title: "카메라를 켜는 중", detail: "", kind: "info" },
  asking: { title: "카메라를 켜는 중", detail: "브라우저가 카메라 권한을 물으면 '허용'을 눌러 주세요.", kind: "info" },
  noFace: { title: "자리에 앉아 주세요", detail: "카메라 정면에 앉아 주세요.\n얼굴이나 어깨가 화면에 들어오면 됩니다.", kind: "info" },
  seated: { title: "착석 확인됨", detail: "사람이 보입니다. 출근할 수 있습니다.", kind: "ok" },
  denied: { title: "카메라 권한이 꺼져 있습니다", detail: "주소창 왼쪽의 자물쇠에서 카메라를 '허용'으로 바꾼 뒤 다시 시도해 주세요.", kind: "warning" },
  unavailable: {
    title: "이 환경에서는 자리 확인을 쓸 수 없습니다",
    detail: "카메라가 없거나, 이 브라우저가 얼굴 확인을 지원하지 않습니다.\n아래 '카메라 없이 출근'을 눌러 주세요. 불이익은 없습니다.",
    kind: "warning",
  },
};

export function CheckIn({ office, view, onDone }: { office: OfficeHandle; view: OfficeView; onDone: () => void }) {
  const { day, profile } = view;
  const a = view.attendance;
  const rules = view.enforcement.rules;
  const waiting = day.checkInAt == null && view.can.checkIn && !a.dayOff;
  // 설정은 처음 그릴 때 한 번 읽는다(설정 화면에서 바꾸면 다음에 출입문을 열 때 적용).
  const [useCamera] = useState(loadCameraPref);
  const cam = useSeatCamera(waiting && useCamera);

  const checkIn = async (method: "camera" | "noCamera") => {
    cam.stop();
    const res = await office.act<{ late: boolean }>("checkIn", { method });
    if (res == null) return;
    office.notify(
      res.late
        ? `출근했습니다. 지각으로 기록했습니다.\n${a.lateFee.recoveryStreak}일 연속 제시간에 오면 1점씩 덜어 드립니다.`
        : "출근했습니다.\n회의실에서 AI 팀장과 오늘 범위를 정해 주세요.",
    );
    onDone();
  };
  const setDayOff = async (off: boolean) => {
    if ((await office.act("setDayOff", { off })) != null) office.notify(off ? "오늘은 쉬는 날로 알렸습니다.\n결근 후보로 세지 않습니다." : "쉬는 날 알림을 거뒀습니다.");
  };
  const nextDay = () => office.act("startNextWorkday");

  const header = (
    <PanelHeader
      place="출입문"
      title="출근"
      detail={useCamera ? "카메라 앞에 앉으면 출근 버튼이 켜집니다.\n문 옆 단말기에 사원증을 찍으면 자동문이 열립니다." : "문 옆 단말기에 사원증을 찍으면 자동문이 열리고 하루가 시작됩니다."}
    />
  );

  if (day.checkInAt != null) {
    return (
      <div className="panel">
        {header}
        <Notice kind={a.isLate ? "warning" : "ok"} title={`${view.clock.dateShort} ${hm(day.checkInAt)}에 활동을 시작했습니다${a.isLate ? " · 지각" : ""}`}>
          회의실에서 아침보고를 진행해 주세요.
        </Notice>
        <MonthLine view={view} />
      </div>
    );
  }

  if (a.absentCandidate) {
    return (
      <div className="panel">
        {header}
        <Notice kind="warning" title="오늘은 결근 후보로 남았습니다">
          {`${hhmm(profile.activityEnd)}까지 출근 기록이 없었습니다.\n다음 활동일에 돌아오면 그날은 늦어도 지각으로 세지 않습니다.`}
        </Notice>
        <MonthLine view={view} />
        <button className="btn" onClick={nextDay} disabled={office.busy || !view.can.startNextWorkday}>
          다음 활동일로
        </button>
      </div>
    );
  }

  if (a.dayOff) {
    return (
      <div className="panel">
        {header}
        <Notice kind="info" title="오늘은 쉬는 날로 알렸습니다">
          결근 후보로 세지 않습니다. 마음이 바뀌면 알림을 거두고 출근해도 됩니다.
        </Notice>
        <div className="row">
          <button className="btn" onClick={nextDay} disabled={office.busy || !view.can.startNextWorkday}>
            다음 활동일로
          </button>
          <button className="btn secondary" onClick={() => setDayOff(false)} disabled={office.busy || !view.can.setDayOff}>
            쉬는 날 취소하고 출근하기
          </button>
        </div>
      </div>
    );
  }

  const status = STATUS[cam.state];
  const cameraFailed = cam.state === "denied" || cam.state === "unavailable";
  const showFallback = !useCamera || cameraFailed || (cam.state === "noFace" && cam.noFaceSeconds >= NO_FACE_FALLBACK_SECONDS);

  return (
    <div className="panel">
      {header}

      {a.returning ? (
        <Notice kind="ok" title="다시 와서 반갑습니다">
          {`쉬어 간 날이 있어도 괜찮습니다. 오늘부터 다시 이어 가면 됩니다.${rules.attendance ? "\n돌아온 오늘은 늦게 출근해도 지각으로 세지 않습니다." : ""}`}
        </Notice>
      ) : null}

      {useCamera ? (
        <Card>
          <div
            style={{
              position: "relative",
              aspectRatio: "4 / 3",
              borderRadius: 12,
              overflow: "hidden",
              background: "#1f2421",
            }}
          >
            {/* 거울처럼 보이게 좌우 반전. 영상은 저장하지 않는다. */}
            <video
              ref={cam.videoRef}
              autoPlay
              muted
              playsInline
              aria-label="카메라 미리보기"
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: cameraFailed ? "none" : "block" }}
            />
            {cameraFailed ? (
              <div
                role="alert"
                style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 8, padding: 20, textAlign: "center", color: "#eef3f0" }}
              >
                <div style={{ fontWeight: 700 }}>! {status.title}</div>
                {cam.reason ? <div className="small">{cam.reason}</div> : null}
                <div className="small pre" style={{ opacity: 0.85 }}>
                  {status.detail}
                </div>
                {cam.state === "denied" ? (
                  <div>
                    <button className="btn secondary small" onClick={cam.retry}>
                      카메라 다시 켜기
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <span
                className={`chip ${cam.state === "seated" ? "" : "muted"}`}
                role="status"
                style={{
                  position: "absolute",
                  left: 10,
                  bottom: 10,
                  background: cam.state === "seated" ? "var(--green)" : "rgba(255,255,255,0.9)",
                  color: cam.state === "seated" ? "#fff" : "var(--ink)",
                }}
              >
                {cam.state === "seated" ? "✓ " : ""}
                {status.title}
              </span>
            )}
          </div>
          {cam.state === "noFace" ? <div className="small muted pre">{status.detail}</div> : null}
          <p className="small muted" style={{ margin: 0 }}>
            영상은 이 기기 안에서만 쓰고 저장·전송하지 않습니다.
          </p>
        </Card>
      ) : (
        <Notice kind="info" title="카메라 없이 출근합니다">
          {"설정에서 '출근 때 카메라 사용'을 껐습니다.\n켜면 자리에 앉은 것을 확인한 뒤 출근합니다."}
        </Notice>
      )}

      <Card>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="small muted">지금</div>
            <div style={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{view.clock.hm}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="small muted">정해 둔 활동 시간</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {hhmm(profile.activityStart)}~{hhmm(profile.activityEnd)}
            </div>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {!rules.attendance
            ? "늦게 시작해도 괜찮습니다. 시작 시각은 기록에만 남습니다."
            : a.returning
              ? "오늘은 돌아온 날이라 늦어도 지각으로 세지 않습니다."
              : `관리 강도 ${rules.label}: ${hhmm(profile.activityStart)}보다 늦으면 지각, ${hhmm(profile.activityEnd)}까지 출근하지 않으면 결근 후보로 기록합니다.`}
        </p>
        <MonthLine view={view} />
      </Card>

      {view.pendingCarry.length > 0 ? (
        <Notice kind="info" title={`지난 활동일에서 넘어온 일 ${view.pendingCarry.length}건`}>
          {view.pendingCarry.map((t) => `· ${t.title}`).join("\n")}
        </Notice>
      ) : null}

      {useCamera && !cameraFailed ? (
        <>
          <button className="btn" onClick={() => checkIn("camera")} disabled={office.busy || !view.can.checkIn || cam.state !== "seated"}>
            사원증 찍고 출근하기
          </button>
          {cam.state !== "seated" ? <div className="small muted">자리에 앉으면 켜집니다.</div> : null}
        </>
      ) : useCamera ? (
        // 카메라를 못 쓰면 대체 경로를 주 버튼으로 둔다.
        <button className="btn" onClick={() => checkIn("noCamera")} disabled={office.busy || !view.can.checkIn}>
          카메라 없이 출근
        </button>
      ) : (
        <button className="btn" onClick={() => checkIn("noCamera")} disabled={office.busy || !view.can.checkIn}>
          사원증 찍고 출근하기
        </button>
      )}
      {useCamera && showFallback && !cameraFailed ? (
        <button className="btn plain" onClick={() => checkIn("noCamera")} disabled={office.busy || !view.can.checkIn}>
          카메라 없이 출근
        </button>
      ) : null}
      {rules.attendance ? (
        <Card title="오늘 쉬어야 하나요?">
          <p className="small muted pre" style={{ margin: 0 }}>
            {"쉬는 날로 알리면 결근 후보로 세지 않습니다.\n오늘만 강도를 낮춰 가볍게 지낼 수도 있습니다."}
          </p>
          <div className="row">
            <button className="btn secondary" onClick={() => setDayOff(true)} disabled={office.busy || !view.can.setDayOff}>
              오늘은 쉬는 날
            </button>
            <LowerTodayButton office={office} view={view} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
