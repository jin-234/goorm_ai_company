import { maskKey, SolarClient, SolarError, solarConfigFromEnv } from "@/lib/solar/client";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Solar 설정 상태. 키는 앞 4자…뒤 4자만 보인다. */
export async function GET() {
  const config = solarConfigFromEnv();
  return json({ hasKey: !!config.apiKey, key: maskKey(config.apiKey), model: config.model, baseURL: config.baseURL });
}

/** '연결 확인': 짧은 요청을 보내 응답한 모델 이름을 돌려준다. */
export async function POST() {
  try {
    const model = await new SolarClient(solarConfigFromEnv()).ping();
    return json({ ok: true, model });
  } catch (error) {
    if (error instanceof SolarError) return json({ ok: false, error: error.toJSON() });
    return errorResponse(error);
  }
}
