import type { NextRequest } from "next/server";
import { contextOf } from "@/lib/colleague/memory/context";
import { PERSONA_IDS, PERSONAS } from "@/lib/colleague/memory/personas";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** 대화할 수 있는 동료와 기억 MD가 있는지. */
export async function GET(req: NextRequest) {
  try {
    const { ctx, officeId } = await contextOf(req);
    const memories = new Map((await ctx.store.listMemories(ctx.officeId)).map((m) => [m.personaId, m]));
    const aiMode = process.env.OFFICE_AI_MODE?.trim() === "sample" || !ctx.client.hasKey ? "sample" : "solar";
    return json(
      {
        aiMode,
        colleagues: PERSONA_IDS.map((id) => {
          const { sampleQuestions: _unused, ...p } = PERSONAS[id];
          const m = memories.get(id);
          return { ...p, memoryUpdatedAt: m && m.markdown.trim() ? m.updatedAt : null };
        }),
      },
      { officeId },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
