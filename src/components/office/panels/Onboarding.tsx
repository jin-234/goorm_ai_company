"use client";
/** 입사 안내. 첫날 규칙을 빽빽하게 늘어놓지 않고, 세부 근태 기준은 [인사] 메일에 둔다. */
import { useState } from "react";
import type { OfficeHandle } from "../useOffice";
import { Card } from "../ui";

const STEPS = [
  ["09:00 출근", "문 앞에서 출근 버튼을 누릅니다."],
  ["아침 PT", "회의실에서 오늘 할 일을 정합니다."],
  ["18:00 퇴근 점검", "끝낸 일을 체크하고 퇴근합니다."],
] as const;

export function Onboarding({ office }: { office: OfficeHandle }) {
  const [name, setName] = useState("김서울");
  const join = async () => {
    if ((await office.act("onboard", { name })) != null) {
      office.notify("입사를 환영합니다.\n출입문에서 출근 버튼을 눌러 주세요.");
    }
  };
  return (
    <div className="onboarding">
      <div className="panel" style={{ maxWidth: 560, margin: "40px auto", padding: "0 16px" }}>
        <header className="panel-head">
          <h1>가상회사 입사 안내</h1>
          <p className="pre">
            {"목표는 내가 정하고,\n회사는 출근·마감·보고를 챙겨 줍니다.\n나를 뺀 팀장과 동료는 모두 AI입니다."}
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
            {"카메라 영상과 녹음은 저장하거나 보내지 않습니다.\n자세한 근태 기준은 입사 후 메일함 [인사] 메일에 있습니다."}
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
          <button className="btn" type="submit" disabled={office.busy}>
            확인했습니다 · 입사하기
          </button>
        </form>
      </div>
    </div>
  );
}
