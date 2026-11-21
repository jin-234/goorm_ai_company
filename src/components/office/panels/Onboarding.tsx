"use client";
/**
 * 입사(개정 기획서 3.1): 희망 직무·현재 경험·가능한 활동 시간을 받고,
 * 가상 역할이라는 점과 AI 동료에게 무엇이 전송되는지 안내한다.
 */
import { useState } from "react";
import { minutesOf } from "../api";
import type { OfficeHandle } from "../useOffice";
import { Card, Notice } from "../ui";

const STEPS = [
  ["출근", "버튼을 눌러 오늘 활동을 시작합니다."],
  ["아침보고", "AI 팀장과 오늘 끝낼 작은 범위를 정합니다."],
  ["결과물 제출", "한 일을 글·링크·코드로 남깁니다."],
  ["기획팀 공유", "AI 기획자에게 오늘 한 일을 설명합니다."],
  ["하루 마감", "요약을 고쳐 확정하고 다음 행동을 고릅니다."],
] as const;

const ROLE_EXAMPLES = ["프런트엔드 개발", "백엔드 개발", "서비스 기획", "데이터 분석"];

export function Onboarding({ office }: { office: OfficeHandle }) {
  const [name, setName] = useState("김서울");
  const [targetRole, setTargetRole] = useState("프런트엔드 개발");
  const [experience, setExperience] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("17:00");

  const startMin = minutesOf(start);
  const endMin = minutesOf(end);
  const timeError =
    startMin == null || endMin == null
      ? "활동 시간은 HH:MM 형식으로 적어 주세요."
      : endMin <= startMin
        ? "마감 시각은 시작 시각보다 늦어야 합니다."
        : null;
  const ready = name.trim() && targetRole.trim() && !timeError;

  const join = async () => {
    if (!ready) return;
    const res = await office.act("onboard", {
      name,
      targetRole: targetRole.trim(),
      experience: experience.trim(),
      activityStart: startMin,
      activityEnd: endMin,
    });
    if (res != null) office.notify("입사를 환영합니다.\n출입문에서 활동을 시작해 주세요.");
  };

  return (
    <div className="panel onboarding">
      <header className="panel-head">
        <h1>VISION COMPANY 입사 안내</h1>
        <p className="pre">
          {"목표는 내가 정하고,\n실행과 방향은 AI 동료와 함께 점검합니다."}
        </p>
      </header>

      <Notice kind="info" title="가상 역할입니다">
        {"이곳의 회사·직급·업무는 연습을 위한 가상 설정입니다.\n실제 고용이나 근무 경력이 아닙니다.\nAI 팀장과 AI 기획자는 사람이 아닌 AI입니다."}
      </Notice>

      <Card title="하루는 이렇게 흘러갑니다">
        <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
          {STEPS.map(([title, detail]) => (
            <li key={title}>
              <strong>{title}</strong> <span className="muted">· {detail}</span>
            </li>
          ))}
        </ol>
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
          <input className="field" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} maxLength={40} />
        </label>
        <div className="row">
          {ROLE_EXAMPLES.map((r) => (
            <button key={r} type="button" className="btn plain small" onClick={() => setTargetRole(r)}>
              {r}
            </button>
          ))}
        </div>
        <label className="stack">
          지금까지의 경험 (선택)
          <textarea
            className="field"
            rows={3}
            value={experience}
            placeholder="예: HTML·CSS로 소개 페이지를 만들어 봤고, React는 강의로 배우는 중입니다."
            onChange={(e) => setExperience(e.target.value)}
          />
        </label>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="stack" style={{ width: 130 }}>
            활동 시작
            <input className="field" value={start} inputMode="numeric" placeholder="HH:MM" onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="stack" style={{ width: 130 }}>
            활동 마감
            <input className="field" value={end} inputMode="numeric" placeholder="HH:MM" onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {timeError ? <div className="small" style={{ color: "var(--warn)" }}>! {timeError}</div> : null}
        <p className="small muted pre" style={{ margin: 0 }}>
          {"정한 시간은 안내에만 씁니다. 늦게 시작하거나 일찍 마쳐도 불이익이 없습니다.\nAI 동료가 답하려면 아침보고·공유 대화와 제출한 글이 서버와 AI 제공사(Upstage)로 전송됩니다.\n비밀키·고객 정보·비공개 회사 코드는 적지 마세요."}
        </p>
        <button className="btn" type="submit" disabled={office.busy || !ready}>
          확인했습니다 · 입사하기
        </button>
      </form>
    </div>
  );
}
