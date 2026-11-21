import type { NextRequest } from "next/server";
import { proposeScope } from "@/lib/colleague/colleague";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI 팀장: 오늘 목표를 작은 과제·완료 기준·공유 형태로 제안한다(개정 기획서 3.1 아침보고, 4.3 C).
 * 본문: { "goal": string, "availableMinutes"?: number }
 * 응답: { source: "solar" | "manual", proposal, solarError }. 제안만 돌려주고 과제는 확정하지 않는다(확정은 사용자가 confirmTasks).
 * 목표 원문은 남긴다(saveGoal). Solar가 없거나 실패하면 사용자의 글을 그대로 한 과제 초안으로 준다.
 */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const body = await readJson(req);
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    if (!goal) throw OfficeError.notAllowedNow("오늘 하려는 일을 먼저 적어 주세요.");
    const { office } = await withOffice(officeId.id, (office) => {
      if (office.day.phase !== "morningPT" && office.day.phase !== "working") {
        throw OfficeError.notAllowedNow("출근한 뒤 아침보고에서 범위를 정합니다.");
      }
      office.saveGoal(goal);
    });
    const profile = office.profile;
    const available =
      typeof body.availableMinutes === "number" && body.availableMinutes > 0
        ? Math.round(body.availableMinutes)
        : profile.activityEnd > profile.activityStart
          ? profile.activityEnd - profile.activityStart
          : null;
    const carried = office.day.tasks.filter((t) => t.carriedFrom != null).map((t) => t.title);
    const outcome = await proposeScope(new SolarClient(solarConfigFromEnv()), {
      goal,
      targetRole: profile.targetRole,
      availableMinutes: available,
      carried,
    });
    return json({ source: outcome.source, proposal: outcome.value, solarError: outcome.solarError }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
