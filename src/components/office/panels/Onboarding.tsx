"use client";
/** 입사. 희망 직무·현재 경험·활동 시간·관리 강도를 받고, 역할과 데이터 처리, AI 동료임을 안내한다. */
import { useState } from "react";
import { Cast } from "@/lib/office/models";
import type { EnforcementLevel } from "@/lib/office/rules";
import { Clock } from "@/lib/office/time";
import type { OfficeView } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card } from "../ui";
import { EnforcementPicker } from "./Enforcement";

const STEPS = [
  ["출근", "버튼으로 오늘 활동을 시작합니다."],
  ["아침보고", "오늘 할 일을 말하면 AI 팀장이 결과물과 완료 기준을 제안합니다."],
  ["수행·제출", "과제를 하고 글·코드·링크로 결과물을 남깁니다."],
  ["기획팀 공유", "AI 기획자에게 오늘 한 일을 설명합니다."],
  ["하루 마감", "기록을 바탕으로 요약을 고쳐 확정합니다."],
] as const;

export function Onboarding({ office, view }: { office: OfficeHandle; view: OfficeView }) {
  const p = view.profile;
  const [name, setName] = useState(p.name);
  const [targetRole, setTargetRole] = useState(p.targetRole);
  const [experience, setExperience] = useState(p.experience);
  const [start, setStart] = useState(Clock.hm(p.activityStart));
  const [end, setEnd] = useState(Clock.hm(p.activityEnd));
  const [level, setLevel] = useState<EnforcementLevel>(p.enforcement);
  const timeOk = Clock.minutesFromHM(start) != null && Clock.minutesFromHM(end) != null;

  const join = async () => {
    if ((await office.act("onboard", { name, targetRole, experience, activityStart: start, activityEnd: end, enforcement: level })) != null) {
      office.notify("입사를 환영합니다.\n출입문에서 출근 버튼을 눌러 주세요.");
    }
  };
  return (
    <div className="onboarding">
      <div className="panel" style={{ maxWidth: 560, margin: "40px auto", padding: "0 16px" }}>
        <header className="panel-head">
          <h1>{Cast.companyName} 입사 안내</h1>
          <p className="pre">
            {`목표는 내가 정하고, 회사는 실행과 설명과 기록을 돕습니다.\n나를 뺀 ${Cast.managerName} 팀장과 동료는 모두 AI이고, 가상 역할입니다.`}
          </p>
        </header>
        <Card title="하루는 이렇게 흘러갑니다">
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
            {STEPS.map(([title, detail], i) => (
              <li key={title} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                <span
                  aria-hidden
                  style={{
                    flex: "none",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--green)",
                    color: "#fff",
                    fontWeight: 700,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {i + 1}
                </span>
                <div>
                  <div style={{ fontWeight: 700 }}>{title}</div>
                  <div className="muted">{detail}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="small muted pre" style={{ margin: 0 }}>
            {"녹음은 글로 옮긴 뒤 저장하지 않습니다.\nAI 동료는 붙여 넣은 글·코드만 읽고, 링크 안의 내용은 읽지 않습니다."}
          </p>
        </Card>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <label className="stack">
            이름
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
          </label>
          <label className="stack">
            희망 직무
            <input className="field" value={targetRole} placeholder="예: 프런트엔드 개발" onChange={(e) => setTargetRole(e.target.value)} maxLength={100} />
          </label>
          <label className="stack">
            현재 경험
            <textarea
              className="field"
              rows={2}
              value={experience}
              placeholder="예: React 독학 3개월, 팀 프로젝트 1회"
              onChange={(e) => setExperience(e.target.value)}
            />
          </label>
          <div className="row">
            <label className="stack" style={{ width: 130 }}>
              활동 시작
              <input className="field" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="stack" style={{ width: 130 }}>
              활동 마감
              <input className="field" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <div className="stack">
            <div style={{ fontWeight: 600 }}>관리 강도</div>
            <p className="small muted pre" style={{ margin: 0 }}>
              {"자리를 지키게 하는 장치를 얼마나 쓸지 고릅니다.\n설정에서 언제든 바꿀 수 있고, 힘든 날에는 그날만 한 단계 낮출 수 있습니다."}
            </p>
            <EnforcementPicker
              options={view.enforcement.options}
              value={level}
              onChange={setLevel}
              start={Clock.minutesFromHM(start) ?? p.activityStart}
              end={Clock.minutesFromHM(end) ?? p.activityEnd}
              disabled={office.busy}
            />
            <p className="small muted pre" style={{ margin: 0 }}>
              {level === "light"
                ? "시간은 안내에만 씁니다. 지나도 강제로 넘어가지 않습니다."
                : "착석 확인은 지금은 버튼으로 알립니다.\n카메라를 쓰게 되면 영상은 브라우저 안에서만 판정하고, 서버에는 '자리에 있음·없음·카메라 꺼짐'과 시각만 남습니다.\n카메라가 꺼진 시간은 자리 비움으로 세지 않습니다."}
            </p>
          </div>
          <button className="btn" type="submit" disabled={office.busy || !name.trim() || !timeOk}>
            확인했습니다 · 입사하기
          </button>
        </form>
      </div>
    </div>
  );
}
