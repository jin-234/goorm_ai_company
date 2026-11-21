import { afterAll, describe, expect, test } from "vitest";
import { applyAction } from "./actions";
import { withOffice } from "./session";
import { databaseUrl, PostgresStore } from "./store";

describe("연결 주소 고르기", () => {
  test("DATABASE_URL이 먼저, 없으면 Supabase 연동의 POSTGRES_URL", () => {
    expect(databaseUrl({ DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" })).toBe("postgres://a");
    expect(databaseUrl({ DATABASE_URL: " ", POSTGRES_URL: "postgres://b" })).toBe("postgres://b");
    expect(databaseUrl({})).toBeNull();
  });
});

/** 실제 Postgres가 있을 때만 돈다. 예: TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres npm test */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres 저장소 (TEST_DATABASE_URL)", () => {
  const store = url ? new PostgresStore(url) : (null as unknown as PostgresStore);
  const id = crypto.randomUUID();

  afterAll(async () => {
    await store.remove(id);
    await store.close();
  });

  test("저장하고 다시 읽으면 같은 상태로 이어진다", async () => {
    const realNow = Date.UTC(2026, 10, 18, 5, 0);
    await withOffice(id, (o) => applyAction(o, { type: "onboard", name: "김서울" }), { store, realNow });
    await withOffice(id, (o) => applyAction(o, { type: "checkIn" }), { store, realNow: realNow + 1000 });

    const stored = await store.load(id);
    expect(stored?.state.day.phase).toBe("morningPT");
    expect(stored?.state.profile.name).toBe("김서울");
    expect(stored?.clockAnchor).toBe(realNow + 1000);

    const { office } = await withOffice(id, () => null, { store, realNow: realNow + 2000 });
    expect(office.day.checkInAt).not.toBeNull();
    expect(office.mails.length).toBeGreaterThanOrEqual(2);
  });

  test("지우면 없어진다", async () => {
    const other = crypto.randomUUID();
    await withOffice(other, () => null, { store });
    await store.remove(other);
    expect(await store.load(other)).toBeNull();
  });
});
