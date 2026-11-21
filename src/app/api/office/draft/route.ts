import type { NextRequest } from "next/server";
import { proposeScope } from "@/lib/colleague/colleague";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI 팀장: 오늘 목표를 작은 과제·완료 기준·공유 형태로 제안한다(개정 기획서 3.1 아침보고, 4.3 C).
 * 본문: { "goal": string, "availableMinutes"?: number }
 * 제안만 돌려주고 과제는 확정하지 않는다(확정은 사용자가 confirmTasks). 목표 원문은 남긴다(saveGoal, 새로고침 후 복원).
 * Solar가 없거나 실패하면 서버 안 규칙으로 만든 초안(수동 양식)을 준다.
 *
 * 응답은 두 화면 모두와 맞춘다.
 * - 분담표 3.4: { source: "solar" | "manual", proposal: { tasks, question }, solarError }
 * - feat/ui-vision-engine 화면: { result: { source: "solar" | "localRules", seconds, tasks, question, solarError }, office }
 */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const body = await readJson(req);
    const { office } = await withOffice(officeId.id, (office) => {
      if (office.day.phase !== "morningPT" && office.day.phase !== "working") {
        throw OfficeError.notAllowedNow("출근한 뒤 아침보고에서 범위를 정합니다.");
      }
      if (typeof body.goal === "string") office.saveGoal(body.goal);
      if (!office.day.goal.trim()) throw OfficeError.notAllowedNow("오늘 목표가 비어 있습니다.\n말하거나 직접 적어 주세요.");
    });
    const goal = office.day.goal.trim();
    const profile = office.profile;
    const available =
      typeof body.availableMinutes === "number" && body.availableMinutes > 0
        ? Math.round(body.availableMinutes)
        : profile.activityEnd > profile.activityStart
          ? profile.activityEnd - profile.activityStart
          : null;
    // 아침보고에서는 아직 확정한 과제가 없으므로, 이월 과제는 pendingCarry에서 본다.
    const carried = [...office.pendingCarry, ...office.day.tasks.filter((t) => t.carriedFrom != null)].map((t) => t.title);
    const started = Date.now();
    const outcome = await proposeScope(new SolarClient(solarConfigFromEnv()), {
      goal,
      targetRole: profile.targetRole,
      availableMinutes: available,
      carried,
      activityEnd: profile.activityEnd,
    });
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    return json(
      {
        source: outcome.source,
        proposal: outcome.value,
        solarError: outcome.solarError,
        result: {
          source: outcome.source === "solar" ? "solar" : "localRules",
          seconds,
          tasks: outcome.value.tasks,
          question: outcome.value.question,
          solarError: outcome.solarError,
        },
        office: officeView(office),
      },
      { officeId },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
