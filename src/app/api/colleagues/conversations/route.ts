import type { NextRequest } from "next/server";
import { contextOf } from "@/lib/colleague/memory/context";
import { isPersonaId } from "@/lib/colleague/memory/personas";
import { listConversations, participantsOf, startConversation } from "@/lib/colleague/memory/service";
import { errorResponse, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 대화 기록 목록(최근 것부터). ?persona=designer 로 한 동료만. */
export async function GET(req: NextRequest) {
  try {
    const { ctx, officeId } = await contextOf(req);
    const persona = req.nextUrl.searchParams.get("persona");
    return json({ conversations: await listConversations(ctx, isPersonaId(persona) ? persona : undefined) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * 대화·회의 시작. 참여 동료의 기억 MD를 읽고 그 기억을 바탕으로 첫마디를 만든다.
 * 본문: { participants: PersonaId[], title?: string, kind?: "chat" | "meeting", opening?: boolean }
 * opening=false면 첫마디 없이 빈 기록(회의 내용을 손으로 옮겨 적을 때).
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx, officeId } = await contextOf(req);
    const body = await readJson(req);
    const result = await startConversation(ctx, {
      participants: participantsOf(body.participants),
      title: typeof body.title === "string" ? body.title : undefined,
      kind: body.kind === "meeting" || body.kind === "chat" ? body.kind : undefined,
      opening: body.opening !== false,
    });
    return json(result, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
