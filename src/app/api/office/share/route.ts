import type { NextRequest } from "next/server";
import { advanceShare } from "@/lib/colleague/v2/engine";
import { turnView } from "@/lib/colleague/v2/view";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";
/**
 * 한 번 말하면 동료 발언이 최대 3번(피드백·다음 질문·정리) 생기고, 각 발언은 검사에 걸리면 1회 다시 요청하며,
 * 마지막에는 회의록 요약까지 부른다. 실제 Solar로 한 요청에 27초까지 걸렸고 최악이면 60초를 넘을 수 있어
 * Vercel 기본값(300초)으로 둔다. 중간에 끊기면 동료 발언이 저장되지 않는다.
 */
export const maxDuration = 300;

/**
 * 회의실 발표: 사용자 말 한 마디 → 단계에 맞는 AI 동료 발언(docs/ai-colleague/AI동료_프롬프트.md 13.1).
 * 본문: { "message": string }
 * - 팀장 사전 보고(stage review): 질문(최대 2회) → 컨펌 카드(stage confirm)
 * - 부서 회의(stage meeting): 방금 질문한 부서의 피드백 → 다음 부서의 질문 → 한 바퀴 끝나면 진행자 정리와 회의록(stage closed)
 * 응답: { source, replies: Turn[], solarError, office }. 한 번 말하면 동료 발언이 여러 개 생길 수 있다.
 * 사용자 말은 AI 호출 전에 먼저 저장해, AI가 실패해도 설명이 사라지지 않는다.
 */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const body = await readJson(req);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw OfficeError.notAllowedNow("설명할 내용을 적어 주세요.");

    const { result: lowered } = await withOffice(officeId.id, (office) => office.recordUserTurn(message).lowered);

    const client = new SolarClient(solarConfigFromEnv());
    const { office, result } = await withOffice(officeId.id, async (office) => {
      if (office.day.phase !== "sharing") throw OfficeError.notAllowedNow("회의실 발표가 이미 끝났습니다.");
      return advanceShare(office, client, { lowered });
    });
    // 화면이 replies만 써도 되게 office의 턴과 같은 화면용 값(basisLabel·termFallback·decisionLabel)을 붙인다.
    const replies = result.turns.map((t) => turnView(t, office.day.share.turns));
    return json({ source: result.source, replies, solarError: result.solarError, office: officeView(office) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
