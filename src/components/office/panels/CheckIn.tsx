"use client";
/**
 * 출입문 · 출근. 버튼으로 오늘 활동을 시작한다.
 * 가볍게: 시작 시각만 기록하고 지각을 판정하지 않는다.
 * 보통·엄격: 정해 둔 시작 시각보다 늦으면 지각, 마감 시각까지 오지 않으면 결근 후보.
 * 놓친 날 복귀: 쉬는 날을 미리 알릴 수 있고, 쉰 날 다음에 돌아온 날은 지각으로 세지 않는다.
 */
import { Clock, hm } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";
import { LowerTodayButton, MonthLine } from "./Enforcement";

export function CheckIn({ office, view, onDone }: { office: OfficeHandle; view: OfficeView; onDone: () => void }) {
  const day = view.day;
  const a = view.attendance;
  const rules = view.enforcement.rules;
  const { activityStart, activityEnd } = view.profile;

  const checkIn = async () => {
    const res = await office.act<{ late: boolean }>("checkIn");
    if (res == null) return;
    office.notify(
      res.late
        ? `지각으로 기록했습니다.\n${view.attendance.lateFee.recoveryStreak}일 연속 제시간에 오면 1점씩 덜어 드립니다.\n회의실에서 아침보고를 해 주세요.`
        : "오늘 활동을 시작했습니다.\n회의실에서 아침보고를 해 주세요.",
    );
    onDone();
  };
  const dayOff = async (off: boolean) => {
    if ((await office.act("setDayOff", { off })) != null) office.notify(off ? "오늘은 쉬는 날로 알렸습니다.\n결근 후보로 세지 않습니다." : "쉬는 날 알림을 거뒀습니다.");
  };
  const nextDay = () => office.act("startNextWorkday");

  return (
    <div className="panel">
      <PanelHeader place="출입문" title="출근" detail={`버튼을 누르면 오늘 활동이 시작됩니다. 관리 강도: ${rules.label}`} />

      {a.returning && day.checkInAt == null ? (
        <Notice kind="ok" title="다시 와서 반갑습니다">
          {`쉬어 간 날이 있어도 괜찮습니다. 오늘부터 다시 이어 가면 됩니다.${rules.attendance ? "\n돌아온 오늘은 늦게 출근해도 지각으로 세지 않습니다." : ""}`}
        </Notice>
      ) : null}

      {day.checkInAt != null ? (
        <>
          <Notice kind={a.isLate ? "warning" : "ok"} title={`${hm(day.checkInAt)}에 활동을 시작했습니다${a.isLate ? " · 지각" : ""}`}>
            회의실에서 아침보고를 진행해 주세요.
          </Notice>
          <MonthLine view={view} />
        </>
      ) : a.absentCandidate ? (
        <>
          <Notice kind="warning" title="오늘은 결근 후보로 남았습니다">
            {`${Clock.hm(activityEnd)}까지 출근 기록이 없었습니다.\n다음 활동일에 돌아오면 그날은 늦어도 지각으로 세지 않습니다.`}
          </Notice>
          <MonthLine view={view} />
          <button className="btn" onClick={nextDay} disabled={office.busy || !view.can.startNextWorkday}>
            다음 활동일로
          </button>
        </>
      ) : a.dayOff ? (
        <>
          <Notice kind="info" title="오늘은 쉬는 날로 알렸습니다">
            결근 후보로 세지 않습니다. 마음이 바뀌면 그냥 출근해도 됩니다.
          </Notice>
          <div className="row">
            <button className="btn" onClick={nextDay} disabled={office.busy || !view.can.startNextWorkday}>
              다음 활동일로
            </button>
            <button className="btn secondary" onClick={checkIn} disabled={office.busy || !view.can.checkIn}>
              그래도 출근하기
            </button>
          </div>
        </>
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
            <p className="small muted pre" style={{ margin: 0 }}>
              {!rules.attendance
                ? "시간은 안내에만 씁니다. 늦게 시작해도 불이익이 없습니다."
                : a.returning
                  ? "오늘은 돌아온 날이라 늦어도 지각으로 세지 않습니다."
                  : `${Clock.hm(activityStart)}보다 늦으면 지각, ${Clock.hm(activityEnd)}까지 출근하지 않으면 결근 후보로 기록합니다.`}
            </p>
            <MonthLine view={view} />
          </Card>
          <button className="btn" onClick={checkIn} disabled={office.busy || !view.can.checkIn}>
            출근하기
          </button>
          {rules.attendance ? (
            <Card title="오늘 쉬어야 하나요?">
              <p className="small muted pre" style={{ margin: 0 }}>
                {"쉬는 날로 알리면 결근 후보로 세지 않습니다.\n오늘만 강도를 낮춰 가볍게 지낼 수도 있습니다."}
              </p>
              <div className="row">
                <button className="btn secondary" onClick={() => dayOff(true)} disabled={office.busy || !view.can.setDayOff}>
                  오늘은 쉬는 날
                </button>
                <LowerTodayButton office={office} view={view} />
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
