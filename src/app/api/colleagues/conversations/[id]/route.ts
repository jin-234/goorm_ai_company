import type { NextRequest } from "next/server";
import { contextOf } from "@/lib/colleague/memory/context";
import { deleteConversation, editConversation, getConversation } from "@/lib/colleague/memory/service";
import { errorResponse, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 대화 기록 한 건(말 전체). */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { ctx, officeId } = await contextOf(req);
    return json({ conversation: await getConversation(ctx, (await params).id) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * 대화 기록 고치기.
 * 본문: { title?, edits?: [{ id, text }], remove?: [id], append?: [{ speaker, text }], summaryMd? }
 * 기억 MD에 반영하려면 고친 뒤 /finish를 다시 부른다.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { ctx, officeId } = await contextOf(req);
    const body = await readJson(req);
    return json({ conversation: await editConversation(ctx, (await params).id, body) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 대화 기록 지우기. 기억 MD에서도 이 대화의 기록 항목을 뺀다. */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { ctx, officeId } = await contextOf(req);
    await deleteConversation(ctx, (await params).id);
    return json({ ok: true }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
