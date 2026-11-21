import type { NextRequest } from "next/server";
import { plannerReply } from "@/lib/colleague/colleague";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 회의실 발표: 사용자의 말 한 마디를 받고 AI 기획자의 응답 하나를 돌려준다(디자인팀·운영팀 담당자는 듣기만)(개정 기획서 3.1, 4.3 B·E).
 * 본문: { "message": string }  — 건너뛰기는 "이 질문은 건너뛸게요."
 * 서버가 두 턴(사용자·기획자)을 모두 기록하고 질문 수를 센다. 응답: { source, reply, solarError, office }
 * 사용자 말은 Solar 호출 전에 먼저 기록해, AI가 실패해도 설명이 사라지지 않는다.
 */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const body = await readJson(req);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw OfficeError.notAllowedNow("설명할 내용을 적어 주세요.");

    const { office: afterUser } = await withOffice(officeId.id, (office) => {
      office.recordShareTurn({ role: "user", text: message });
    });

    const outcome = await plannerReply(new SolarClient(solarConfigFromEnv()), afterUser);

    const { office } = await withOffice(officeId.id, (office) => {
      if (office.day.phase !== "sharing") throw OfficeError.notAllowedNow("공유가 이미 끝났습니다.");
      office.recordShareTurn({ role: "planner", reply: outcome.value, source: outcome.source });
    });
    return json({ source: outcome.source, reply: outcome.value, solarError: outcome.solarError, office: officeView(office) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
