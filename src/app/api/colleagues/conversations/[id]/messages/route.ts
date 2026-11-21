import type { NextRequest } from "next/server";
import { contextOf } from "@/lib/colleague/memory/context";
import { sendMessage } from "@/lib/colleague/memory/service";
import { errorResponse, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 내 말 한 마디 → 동료의 다음 말. 본문: { text }. 응답: { conversation, solarError } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, officeId } = await contextOf(req);
    const body = await readJson(req);
    return json(await sendMessage(ctx, (await params).id, body.text), { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
