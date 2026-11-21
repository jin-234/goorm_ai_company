import type { NextRequest } from "next/server";
import { applyAction } from "@/lib/server/actions";
import { errorResponse, json, officeIdOf, readJson } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";

/** 행동 하나를 적용한다. 본문: { "type": "checkIn" } 처럼 type과 그 행동에 필요한 값. */
export async function POST(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const body = await readJson(req);
    const { office, result } = await withOffice(officeId.id, (office) => applyAction(office, body));
    return json({ result, office: officeView(office) }, { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
