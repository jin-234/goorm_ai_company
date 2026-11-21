/**
 * 회사 상태 저장소.
 *
 * Vercel 함수는 요청마다 새로 뜰 수 있어 메모리에 상태를 둘 수 없다.
 * Supabase Postgres 연결 주소가 있으면 Postgres에, 없으면 프로세스 메모리에 저장한다(로컬 개발용).
 * 상태는 참여자 한 명당 한 줄(JSONB)로 둔다.
 *
 * 연결 주소는 DATABASE_URL을 먼저 보고, 없으면 Vercel의 Supabase 연동이 넣어 주는 POSTGRES_URL을 쓴다.
 * 서버리스에서는 Supabase의 Transaction pooler 주소(포트 6543)를 쓴다. 이 풀러는 prepared statement를
 * 지원하지 않으므로 prepare: false로 연결한다.
 */
import postgres from "postgres";
import type { OfficeState } from "../office/office";

export interface StoredOffice {
  state: OfficeState;
  /** 가상 시계를 마지막으로 맞춘 실제 시각(epoch ms). */
  clockAnchor: number;
}

export interface OfficeStore {
  load(id: string): Promise<StoredOffice | null>;
  save(id: string, stored: StoredOffice): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryStore implements OfficeStore {
  private rows = new Map<string, string>();

  async load(id: string) {
    const row = this.rows.get(id);
    return row ? (JSON.parse(row) as StoredOffice) : null;
  }
  async save(id: string, stored: StoredOffice) {
    this.rows.set(id, JSON.stringify(stored));
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS offices (
  id            TEXT PRIMARY KEY,
  state         JSONB       NOT NULL,
  clock_anchor  BIGINT      NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/**
 * 드라이버가 모르는 쿼리 옵션은 뗀다.
 * Vercel Supabase 연동의 주소에는 `sslmode`와 `supa=base-pooler.x`가 붙는데,
 * postgres.js는 모르는 옵션을 서버 설정값으로 넘겨서 풀러가 연결을 끊는다. SSL은 아래 sslFor로 따로 정한다.
 */
export function cleanUrl(url: string): string {
  const parsed = new URL(url);
  parsed.search = "";
  return parsed.toString();
}

/** 로컬 Postgres(개발·시험)는 SSL 없이, 그 밖(Supabase)은 SSL로 연결한다. */
function sslFor(url: string): false | "require" {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" ? false : "require";
}

export class PostgresStore implements OfficeStore {
  /** 같은 함수 안의 다른 저장소(동료 대화 기록)도 이 연결 하나를 같이 쓴다. */
  readonly sql: postgres.Sql;
  private ready: Promise<unknown> | null = null;

  constructor(url: string) {
    this.sql = postgres(cleanUrl(url), {
      prepare: false,
      ssl: sslFor(url),
      // 함수 하나는 요청을 하나씩 처리하므로 연결 하나면 충분하다.
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }

  private ensureTable() {
    this.ready ??= this.sql.unsafe(SCHEMA_SQL).catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  async load(id: string) {
    await this.ensureTable();
    const rows = await this.sql<{ state: OfficeState; clock_anchor: string }[]>`
      SELECT state, clock_anchor FROM offices WHERE id = ${id}`;
    if (rows.length === 0) return null;
    return { state: rows[0].state, clockAnchor: Number(rows[0].clock_anchor) };
  }

  async save(id: string, stored: StoredOffice) {
    await this.ensureTable();
    await this.sql`
      INSERT INTO offices (id, state, clock_anchor)
      VALUES (${id}, ${this.sql.json(stored.state as unknown as postgres.JSONValue)}, ${stored.clockAnchor})
      ON CONFLICT (id) DO UPDATE
        SET state = EXCLUDED.state, clock_anchor = EXCLUDED.clock_anchor, updated_at = now()`;
  }

  async remove(id: string) {
    await this.ensureTable();
    await this.sql`DELETE FROM offices WHERE id = ${id}`;
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

/** Postgres 연결 주소. DATABASE_URL이 먼저, 없으면 Vercel Supabase 연동의 POSTGRES_URL. */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
  return url ? url : null;
}

const globalStore = globalThis as unknown as { __officeStore?: OfficeStore };

export function getStore(): OfficeStore {
  if (!globalStore.__officeStore) {
    const url = databaseUrl();
    globalStore.__officeStore = url ? new PostgresStore(url) : new MemoryStore();
  }
  return globalStore.__officeStore;
}

export const storeKind = () => (databaseUrl() ? "postgres" : "memory");
