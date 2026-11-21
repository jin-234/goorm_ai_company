"use client";
/**
 * 출입문 · 출근. 카메라 착석 판정(MediaPipe)은 AI 담당 작업이라,
 * 여기서는 카메라 없이 출근을 기록하는 경로를 먼저 둔다(웹 기획서 5장: 권한 거부·미지원 대체 경로).
 */
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";

export function CheckIn({ office, view, onDone }: { office: OfficeHandle; view: OfficeView; onDone: () => void }) {
  const day = view.state.day;
  const stats = view.monthStats;
  const workStart = view.state.profile.workStart;
  const nowMinute = Number(view.clock.hm.slice(0, 2)) * 60 + Number(view.clock.hm.slice(3));
  const willBeLate = nowMinute > workStart;

  const checkIn = async () => {
    const res = await office.act<{ attendance: "onTime" | "late" }>("checkIn");
    if (!res) return;
    office.notify(
      res.attendance === "late"
        ? "지각으로 기록했습니다.\n회의실에서 아침 PT를 시작하세요."
        : "출근했습니다.\n회의실에서 아침 PT를 시작하세요.",
    );
    onDone();
  };

  return (
    <div className="panel">
      <PanelHeader
        place="출입문"
        title="출근"
        detail={"카메라 앞에 앉으면 출근 버튼이 켜집니다.\n영상은 이 기기 안에서만 쓰고 저장하지 않습니다."}
      />

      {day.checkInAt != null ? (
        <Notice kind="ok" title={`오늘 ${day.isLate ? "지각" : "정시"} 출근을 기록했습니다`}>
          회의실에서 아침 PT를 진행해 주세요.
        </Notice>
      ) : day.absentCandidate ? (
        <Notice kind="error" title="오늘은 출근할 수 없습니다">
          {"18:00까지 출근 기록이 없어 결근 후보로 기록했습니다.\n위 막대의 '다음 근무일'로 넘어가 주세요."}
        </Notice>
      ) : (
        <>
          <Card>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="small muted">지금</div>
                <div style={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{view.clock.hm}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="small muted">출근 기준</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>09:00</div>
              </div>
            </div>
            <Notice kind="info" title="카메라 없이 시연 중">
              {"카메라 확인 없이 출근을 기록합니다.\n카메라 착석 확인은 준비 중입니다."}
            </Notice>
          </Card>

          {willBeLate ? (
            <Notice kind="warning" title="지금 출근하면 지각으로 기록됩니다">
              {`이번 달 지각 ${stats.late}회 → ${stats.late + 1}회\n지각비 예상액은 시연용이며 실제로 청구하지 않습니다.`}
            </Notice>
          ) : null}

          <button className="btn" onClick={checkIn} disabled={office.busy || !view.can.checkIn}>
            {willBeLate ? "지각 출근하기" : "출근하기"}
          </button>
        </>
      )}
    </div>
  );
}
