import type { NextRequest } from "next/server";
import { plannerReply } from "@/lib/colleague/colleague";
import { MEETING_ORDER } from "@/lib/office/models";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 회의실 발표: 사용자의 말 한 마디를 받고, 차례인 타 부서 동료의 응답을 돌려준다(개정 기획서 3.1, 4.3 B·E).
 * 차례: 기획자 → 디자이너 → 운영 담당자가 질문 하나씩, 모두 물은 뒤 기획자가 마무리(Office.shareSpeaker).
 * 차례인 부서가 물을 것이 없으면 다음 부서가 이어서 말한다(누군가 질문하거나 회의가 정리될 때까지).
 * 본문: { "message": string }  — 건너뛰기는 "이 질문은 건너뛸게요."
 * 응답: { source, reply(마지막 동료 응답), solarError, office }
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
    let office = afterUser;
    let outcome: Awaited<ReturnType<typeof plannerReply>>;
    // 부서 수 + 마무리 한 번이 최대. 질문이 나오거나, 회의가 정리되거나, AI가 실패하면 멈춘다.
    for (let i = 0; ; i++) {
      outcome = await plannerReply(client, office);
      const reply = outcome;
      ({ office } = await withOffice(officeId.id, (o) => {
        if (o.day.phase !== "sharing") throw OfficeError.notAllowedNow("공유가 이미 끝났습니다.");
        o.recordShareTurn({ role: "planner", reply: reply.value, source: reply.source });
      }));
      if (outcome.value.question || outcome.source === "manual" || office.day.share.state === "ready_to_summarize" || i >= MEETING_ORDER.length) break;
    }
    return json({ source: outcome.source, reply: outcome.value, solarError: outcome.solarError, office: officeView(office) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
