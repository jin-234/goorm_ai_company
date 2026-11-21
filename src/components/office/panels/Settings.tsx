"use client";
/** 설정: 관리 강도, Solar 연결 상태·연결 확인, 출근 때 카메라 사용, 처음부터 다시. 키는 서버 환경변수로만 넣는다. */
import { useEffect, useState } from "react";
import type { EnforcementLevel } from "@/lib/office/rules";
import { api, type OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice, PanelHeader } from "../ui";
import { loadCameraPref, saveCameraPref } from "./cameraPref";
import { EnforcementPicker, LowerTodayButton, MonthLine } from "./Enforcement";

export function Settings({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const [solar, setSolar] = useState<{ hasKey: boolean; key: string; model: string; baseURL: string } | null>(null);
  const [ping, setPing] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinging, setPinging] = useState(false);
  const [camera, setCamera] = useState(true);

  useEffect(() => {
    api.solarStatus().then(setSolar).catch(() => setSolar(null));
    setCamera(loadCameraPref());
  }, []);

  const check = async () => {
    setPinging(true);
    try {
      const res = await api.solarPing();
      setPing(res.ok ? { ok: true, text: `연결됐습니다. 응답한 모델: ${res.model}` } : { ok: false, text: `${res.error?.title}\n${res.error?.guidance}` });
    } catch (e) {
      setPing({ ok: false, text: e instanceof Error ? e.message : "연결 확인에 실패했습니다." });
    }
    setPinging(false);
  };

  const reset = async () => {
    if (!window.confirm("모두 지우고 다시 시작할까요?\n활동 기록·메일·대화가 모두 지워집니다.")) return;
    if (await office.run(async () => ({ office: await api.reset() }))) office.notify("처음부터 다시 시작합니다.");
  };

  const setLevel = async (level: EnforcementLevel) => {
    if (level === view.enforcement.chosen) return;
    const checkedIn = view.day.checkInAt != null && view.phase.value !== "off";
    const label = view.enforcement.options.find((o) => o.id === level)?.label ?? level;
    if (checkedIn && !window.confirm(`관리 강도를 ${label}(으)로 바꿀까요?\n오늘부터 바로 적용합니다. 이미 남은 지각·결근 기록은 그대로입니다.`)) return;
    if ((await office.act("setEnforcement", { level })) != null) office.notify(`관리 강도를 ${label}(으)로 바꿨습니다.`);
  };

  return (
    <div className="panel">
      <PanelHeader place="설정" title="설정" />
      <Card
        title="관리 강도"
        aside={view.enforcement.lowered ? <span className="badge tag">{`오늘만 ${view.enforcement.rules.label}`}</span> : undefined}
      >
        <EnforcementPicker
          options={view.enforcement.options}
          value={view.enforcement.chosen}
          onChange={setLevel}
          start={view.profile.activityStart}
          end={view.profile.activityEnd}
          disabled={office.busy}
        />
        <MonthLine view={view} />
        <div className="row">
          <LowerTodayButton office={office} view={view} />
        </div>
      </Card>
      <Card title="Upstage Solar">
        {solar ? (
          <div className="small" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
            <span className="muted">키</span>
            <span>{solar.hasKey ? solar.key : "없음"}</span>
            <span className="muted">모델</span>
            <span>{solar.model}</span>
            <span className="muted">주소</span>
            <span>{solar.baseURL}</span>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            설정을 불러오는 중입니다.
          </p>
        )}
        {solar && !solar.hasKey ? (
          <Notice kind="warning" title="Solar 키가 없습니다">
            {"서버 환경변수 UPSTAGE_API_KEY를 넣어 주세요.\n키가 없으면 아침보고 제안·회의실 발표 대화·마감 요약이 예시 응답으로 이어집니다."}
          </Notice>
        ) : null}
        <button className="btn secondary" onClick={check} disabled={pinging}>
          {pinging ? "확인 중" : "연결 확인"}
        </button>
        {ping ? <Notice kind={ping.ok ? "ok" : "error"} title={ping.text} /> : null}
        <p className="small muted pre" style={{ margin: 0 }}>
          {"Solar는 사용량에 따라 요금이 나오는 클라우드 API입니다.\n키는 서버 환경변수에만 두고 화면에는 앞뒤 4자만 보입니다."}
        </p>
      </Card>
      <Card title="카메라">
        <label className="row" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={camera}
            onChange={(e) => {
              setCamera(e.target.checked);
              saveCameraPref(e.target.checked);
            }}
            style={{ width: 22, height: 22, accentColor: "var(--green)" }}
          />
          출근 때 카메라 사용
        </label>
        <p className="small muted pre" style={{ margin: 0 }}>
          {"켜면 자리에 앉은 것을 카메라로 확인한 뒤 출근합니다.\n영상은 이 기기 안에서만 쓰고 저장·전송하지 않습니다.\n꺼도 출근 방식에 따른 불이익은 없습니다(지각·결근은 관리 강도가 정합니다)."}
        </p>
      </Card>
      <Card title="시연">
        <button className="btn danger" onClick={reset} disabled={office.busy}>
          처음부터 다시
        </button>
      </Card>
    </div>
  );
}
