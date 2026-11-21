import { type NextRequest, NextResponse } from "next/server";
import { OfficeError } from "../office/rules";
import { SolarError } from "../solar/client";
import { SttError } from "../stt/client";
import { BadRequest } from "./actions";

/** 참여자 구분. 로그인 없이 브라우저 쿠키 하나로 회사 상태를 찾는다. */
export const OFFICE_COOKIE = "office_id";
const ONE_YEAR = 60 * 60 * 24 * 365;
const ID_PATTERN = /^[0-9a-f-]{36}$/;

export function officeIdOf(req: NextRequest): { id: string; isNew: boolean } {
  const existing = req.cookies.get(OFFICE_COOKIE)?.value;
  if (existing && ID_PATTERN.test(existing)) return { id: existing, isNew: false };
  return { id: crypto.randomUUID(), isNew: true };
}

export function json(body: unknown, init: { status?: number; officeId?: { id: string; isNew: boolean } } = {}) {
  const res = NextResponse.json(body, { status: init.status ?? 200 });
  if (init.officeId?.isNew) {
    res.cookies.set(OFFICE_COOKIE, init.officeId.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_YEAR,
    });
  }
  return res;
}

/** 오류를 화면에 그대로 보여 줄 수 있는 한국어 응답으로 바꾼다. */
export function errorResponse(error: unknown) {
  if (error instanceof OfficeError) {
    return json({ error: { type: "rule", code: error.code, message: error.message, details: error.details } }, { status: 409 });
  }
  if (error instanceof BadRequest) {
    return json({ error: { type: "badRequest", message: error.message } }, { status: 400 });
  }
  if (error instanceof SolarError) {
    return json({ error: { type: "solar", ...error.toJSON() } }, { status: 502 });
  }
  if (error instanceof SttError) {
    return json({ error: { type: "stt", ...error.toJSON() } }, { status: 502 });
  }
  console.error(error);
  return json({ error: { type: "server", message: "서버에서 처리하지 못했습니다.\n잠시 뒤 다시 시도해 주세요." } }, { status: 500 });
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (typeof body !== "object" || body == null || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new BadRequest("요청 본문은 JSON 객체여야 합니다.");
  }
}
