import type { NextRequest } from "next/server";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, SolarError, solarConfigFromEnv } from "@/lib/solar/client";
import { localWeeklyReply } from "@/lib/solar/weekly-fallback";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 제출한 주간보고서에 팀장 답장을 받는다. 본문: { "fallback"?: boolean }
 * fallback이 true면 Solar 없이 정해진 문구의 기본 답장을 넣는다('기본 답장 받기').
 * Solar가 실패하면 답장을 넣지 않고 solarError를 돌려준다(화면에서 '다시 시도'·'기본 답장 받기'를 고른다).
 */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const { office: before } = await withOffice(officeId.id, () => null);
    const report = before.weeklyAwaitingReply;
    if (!report) throw OfficeError.notAllowedNow("답장을 기다리는 주간보고서가 없습니다.");
    const name = before.profile.name;

    let reply;
    let source: "solar" | "localTemplate";
    if (body.fallback === true) {
      reply = localWeeklyReply(report, name);
      source = "localTemplate";
    } else {
      try {
        reply = await new SolarClient(solarConfigFromEnv()).weeklyReply(report, name);
        source = "solar";
      } catch (error) {
        if (!(error instanceof SolarError)) throw error;
        return json({ result: { solarError: error.toJSON() }, office: officeView(before) }, { officeId });
      }
    }

    const { office } = await withOffice(officeId.id, (office) => {
      office.receiveWeeklyFeedback(report.id, reply.subject, reply.body, source);
    });
    return json({ result: { source, achievement: reply.achievement, solarError: null }, office: officeView(office) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
