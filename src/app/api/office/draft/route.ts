import type { NextRequest } from "next/server";
import type { TaskDraft, TaskInput } from "@/lib/office/models";
import { parse } from "@/lib/office/pt-parser";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, SolarError, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 초안 한 줄을 아침보고 과제 칸 모양으로. 빈 칸은 화면에서 '확인 필요'로 보인다. */
function toTaskInput(d: TaskDraft): TaskInput {
  return { title: (d.title ?? "").trim(), completionCriteria: (d.doneCriteria ?? "").trim(), shareForm: "" };
}

/** 규칙으로도 과제를 못 찾으면, 목표 글의 줄마다 과제 한 건으로 둔다(완료 기준은 사용자가 채운다). */
function linesAsTasks(goal: string): TaskInput[] {
  return goal
    .split(/\n+/)
    .map((l) => l.replace(/^[\s\-·•*\d.)]+/, "").trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((title) => ({ title: title.slice(0, 120), completionCriteria: "", shareForm: "" }));
}

/**
 * 아침보고 목표 글로 오늘 과제 초안을 만든다. 본문: { "goal"?: string }
 * 목표 글은 먼저 저장하고(새로고침 후 복원), 초안은 저장하지 않고 돌려준다. 사용자가 고친 뒤 confirmTasks로 확정한다.
 * Solar가 실패하면 서버 안 규칙으로 만든 초안을 돌려주고, 무엇이 실패했는지 solarError로 알린다.
 */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const body = await readJson(req);
    const { office } = await withOffice(officeId.id, (office) => {
      if (office.day.phase !== "morningPT") throw OfficeError.notAllowedNow("출근한 뒤 아침보고에서 과제 초안을 만듭니다.");
      if (typeof body.goal === "string") office.saveGoal(body.goal);
      if (!office.day.goal.trim()) throw OfficeError.notAllowedNow("오늘 목표가 비어 있습니다.\n말하거나 직접 적어 주세요.");
    });

    const goal = office.day.goal;
    const workEnd = office.profile.activityEnd;
    const solar = new SolarClient(solarConfigFromEnv());
    let solarError: SolarError | null = null;
    let tasks: TaskInput[];
    let source: "solar" | "localRules" = "solar";
    const started = Date.now();
    try {
      tasks = (await solar.checklist(goal, workEnd)).map(toTaskInput).filter((t) => t.title);
    } catch (error) {
      if (!(error instanceof SolarError)) throw error;
      solarError = error;
      source = "localRules";
      tasks = parse(goal, workEnd).map(toTaskInput).filter((t) => t.title);
    }
    if (tasks.length === 0) tasks = linesAsTasks(goal);
    const seconds = Math.round((Date.now() - started) / 100) / 10;

    return json(
      { result: { source, seconds, tasks, solarError: solarError?.toJSON() ?? null }, office: officeView(office) },
      { officeId },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
