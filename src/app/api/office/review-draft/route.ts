import type { NextRequest } from "next/server";
import { reviewDraft } from "@/lib/colleague/colleague";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json, officeIdOf } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 하루 마감 요약 초안(개정 기획서 4.3 E). 실제 대화·읽은 제출물만 근거로 쓴다.
 * 서버가 day.review에 초안으로 저장한다(AI 원본은 따로 보존). 응답: { source, review, solarError, office }
 * 사용자가 고친 뒤 확정은 confirmReview 행동으로 한다.
 */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const { office: before } = await withOffice(officeId.id, (office) => {
      if (office.day.phase !== "checkoutReview") throw OfficeError.notAllowedNow("마감 요약은 하루 마감에서 만듭니다.");
    });
    const outcome = await reviewDraft(new SolarClient(solarConfigFromEnv()), before);
    const { office } = await withOffice(officeId.id, (office) => {
      office.saveReviewDraft(outcome.value, outcome.source);
    });
    return json({ source: outcome.source, review: outcome.value, solarError: outcome.solarError, office: officeView(office) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
