import { displayName, Organization, RANK_TITLE } from "@/lib/office/organization";
import { json } from "@/lib/server/http";

/** 가상회사 1팀 조직도. 나를 뺀 모두가 AI다. */
export async function GET() {
  return json({
    members: Organization.members.map((m) => ({ ...m, rankTitle: RANK_TITLE[m.rank], displayName: displayName(m) })),
    morningPTAudience: Organization.morningPTAudience().map((m) => m.id),
  });
}
