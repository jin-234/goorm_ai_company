import { type NextRequest, NextResponse } from "next/server";
import { contextOf } from "@/lib/colleague/memory/context";
import { isPersonaId } from "@/lib/colleague/memory/personas";
import { readMemory, writeMemory } from "@/lib/colleague/memory/service";
import { BadRequest } from "@/lib/server/actions";
import { errorResponse, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ personaId: string }> };

async function personaOf(params: Params["params"]) {
  const { personaId } = await params;
  if (!isPersonaId(personaId)) throw new BadRequest("없는 동료입니다.");
  return personaId;
}

/** 동료 기억 MD. ?format=md 면 .md 파일로 내려받는다. */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { ctx, officeId } = await contextOf(req);
    const personaId = await personaOf(params);
    const memory = await readMemory(ctx, personaId);
    if (req.nextUrl.searchParams.get("format") === "md") {
      return new NextResponse(memory.markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="colleague-${personaId}-memory.md"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return json({ memory: { ...memory, exists: memory.updatedAt !== "" } }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 기억 MD 직접 고치기. 본문: { markdown } */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { ctx, officeId } = await contextOf(req);
    const personaId = await personaOf(params);
    const body = await readJson(req);
    if (typeof body.markdown !== "string") throw new BadRequest("markdown 글이 필요합니다.");
    return json({ memory: { ...(await writeMemory(ctx, personaId, body.markdown)), exists: true } }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
