import type { NextRequest } from "next/server";
import { contextOf } from "@/lib/colleague/memory/context";
import { finishConversation } from "@/lib/colleague/memory/service";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 대화 마치기: 요약을 대화 기록에 붙이고 참여 동료의 기억 MD에 합친다. 고친 뒤 다시 부르면 새 요약으로 바뀐다. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, officeId } = await contextOf(req);
    return json(await finishConversation(ctx, (await params).id), { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
