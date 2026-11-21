import type { NextRequest } from "next/server";
import { parse } from "@/lib/office/pt-parser";
import { OfficeError } from "@/lib/office/rules";
import { SolarClient, SolarError, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { getStore } from "@/lib/server/store";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 아침 PT 전사문으로 업무 초안을 만든다. 본문: { "transcript"?: string }
 * Solar가 실패하면 서버 안 규칙(PTParser)으로 만든 초안을 넣고, 무엇이 실패했는지 solarError로 알린다.
 * 전사문은 실패해도 지우지 않는다.
 */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const body = await readJson(req);
    // 1) 전사문 저장(Solar 호출이 길어도 전사문은 먼저 남긴다)
    const { office: before } = await withOffice(officeId.id, (office) => {
      if (office.day.phase !== "morningPT") throw OfficeError.notAllowedNow("출근한 뒤 아침 PT에서 업무 초안을 만듭니다.");
      if (typeof body.transcript === "string") office.setTranscript(body.transcript);
      if (!office.day.transcript.trim()) throw OfficeError.notAllowedNow("전사문이 비어 있습니다.\n말하거나 직접 적어 주세요.");
    });

    // 2) Solar → 실패하면 서버 안 규칙
    const transcript = before.day.transcript;
    const workEnd = before.profile.workEnd;
    const solar = new SolarClient(solarConfigFromEnv());
    let solarError: SolarError | null = null;
    let drafts;
    let source: "solar" | "localRules" = "solar";
    const started = Date.now();
    try {
      drafts = await solar.checklist(transcript, workEnd);
    } catch (error) {
      if (!(error instanceof SolarError)) throw error;
      solarError = error;
      drafts = parse(transcript, workEnd);
      source = "localRules";
    }
    const seconds = Math.round((Date.now() - started) / 100) / 10;

    // 3) 초안 반영(이월 업무는 그대로 남는다)
    const { office } = await withOffice(officeId.id, (office) => {
      if (office.day.phase !== "morningPT") throw OfficeError.notAllowedNow("아침 PT가 끝나 초안을 넣지 않았습니다.");
      office.replaceDrafts(drafts, source);
    }, { store: getStore() });

    return json({ result: { source, seconds, solarError: solarError?.toJSON() ?? null }, office: officeView(office) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
