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
 * 회의실 발표: 사용자의 말 한 마디를 받고, 지금 파트를 맡은 타 부서 동료의 응답 하나를 돌려준다(개정 기획서 3.1, 4.3 B·E).
 * 파트는 과제마다 하나이고 부서 한 곳이 듣는다. 그 부서가 질문 없이 답하면 이 파트가 끝나고,
 * 사용자가 다음 파트를 설명하면 다음 파트를 맡은 부서가 답한다(Office.shareSpeaker).
 * 본문: { "message": string }  — 건너뛰기는 "이 질문은 건너뛸게요."
 * 응답: { source, reply, solarError, office }
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

    const client = new SolarClient(solarConfigFromEnv());
    const outcome = await plannerReply(client, afterUser);
    const { office } = await withOffice(officeId.id, (o) => {
      if (o.day.phase !== "sharing") throw OfficeError.notAllowedNow("공유가 이미 끝났습니다.");
      o.recordShareTurn({ role: "planner", reply: outcome.value, source: outcome.source });
    });
    return json({ source: outcome.source, reply: outcome.value, solarError: outcome.solarError, office: officeView(office) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
