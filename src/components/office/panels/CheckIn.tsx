"use client";
/** 출입문 · 출근(개정판): 버튼으로 활동을 시작한다. 카메라·지각 판정은 하지 않는다. */
import { hhmm, type OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";

export function CheckIn({ office, view, onDone }: { office: OfficeHandle; view: OfficeView; onDone: () => void }) {
  const { day, profile } = view;
  const start = async () => {
    if ((await office.act("checkIn")) == null) return;
    office.notify("오늘 활동을 시작했습니다.\n회의실에서 AI 팀장과 오늘 범위를 정해 주세요.");
    onDone();
  };

  return (
    <div className="panel">
      <PanelHeader place="출입문" title="출근" detail="버튼을 누르면 오늘 활동이 시작됩니다." />
      {day.checkInAt != null ? (
        <Notice kind="ok" title={`${view.clock.dateShort} 활동을 시작했습니다`}>
          회의실에서 아침보고를 진행해 주세요.
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
                <div className="small muted">정해 둔 활동 시간</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {hhmm(profile.activityStart)}~{hhmm(profile.activityEnd)}
                </div>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              늦게 시작해도 괜찮습니다. 시작 시각은 기록에만 남습니다.
            </p>
          </Card>
          {view.pendingCarry.length > 0 ? (
            <Notice kind="info" title={`지난 활동일에서 넘어온 일 ${view.pendingCarry.length}건`}>
              {view.pendingCarry.map((t) => `· ${t.title}`).join("\n")}
            </Notice>
          ) : null}
          <button className="btn" onClick={start} disabled={office.busy || !view.can.checkIn}>
            활동 시작
          </button>
        </>
      )}
    </div>
  );
}
