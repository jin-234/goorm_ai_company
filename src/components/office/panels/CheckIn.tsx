"use client";
/**
 * 출입문 · 출근. 버튼으로 오늘 활동을 시작한다.
 * 시작 시각만 기록하고 지각을 판정하지 않는다. 정해 둔 시작 시각은 안내에만 쓴다.
 */
import { Clock, hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";

export function CheckIn({ office, view, onDone }: { office: OfficeHandle; view: OfficeView; onDone: () => void }) {
  const day = view.day;
  const { activityStart, activityEnd } = view.profile;

  const checkIn = async () => {
    if ((await office.act("checkIn")) == null) return;
    office.notify("오늘 활동을 시작했습니다.\n회의실에서 아침보고를 해 주세요.");
    onDone();
  };

  return (
    <div className="panel">
      <PanelHeader place="출입문" title="출근" detail="버튼을 누르면 오늘 활동이 시작됩니다." />

      {day.checkInAt != null ? (
        <Notice kind="ok" title={`${hm(day.checkInAt)}에 활동을 시작했습니다`}>
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
                <div className="small muted">내가 정한 활동 시간</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {Clock.hm(activityStart)} ~ {Clock.hm(activityEnd)}
                </div>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              시간은 안내에만 씁니다. 늦게 시작해도 불이익이 없습니다.
            </p>
          </Card>
          <button className="btn" onClick={checkIn} disabled={office.busy || !view.can.checkIn}>
            출근하기
          </button>
        </>
      )}
    </div>
  );
}
