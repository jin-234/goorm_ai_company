/**
 * 회사 상태 저장소.
 *
 * Vercel 함수는 요청마다 새로 뜰 수 있어 메모리에 상태를 둘 수 없다.
 * DATABASE_URL(Neon Postgres)이 있으면 Postgres에, 없으면 프로세스 메모리에 저장한다(로컬 개발용).
 * 상태는 참여자 한 명당 한 줄(JSONB)로 둔다.
 */
import { neon } from "@neondatabase/serverless";
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

export class PostgresStore implements OfficeStore {
  private sql: ReturnType<typeof neon>;
  private ready: Promise<unknown> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private ensureTable() {
    this.ready ??= this.sql.query(SCHEMA_SQL);
    return this.ready;
  }

  async load(id: string) {
    await this.ensureTable();
    const rows = (await this.sql.query("SELECT state, clock_anchor FROM offices WHERE id = $1", [id])) as {
      state: OfficeState;
      clock_anchor: string | number;
    }[];
    if (rows.length === 0) return null;
    return { state: rows[0].state, clockAnchor: Number(rows[0].clock_anchor) };
  }

  async save(id: string, stored: StoredOffice) {
    await this.ensureTable();
    await this.sql.query(
      `INSERT INTO offices (id, state, clock_anchor) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, clock_anchor = EXCLUDED.clock_anchor, updated_at = now()`,
      [id, JSON.stringify(stored.state), stored.clockAnchor],
    );
  }

  async remove(id: string) {
    await this.ensureTable();
    await this.sql.query("DELETE FROM offices WHERE id = $1", [id]);
  }
}

const globalStore = globalThis as unknown as { __officeStore?: OfficeStore };

export function getStore(): OfficeStore {
  if (!globalStore.__officeStore) {
    const url = process.env.DATABASE_URL?.trim();
    globalStore.__officeStore = url ? new PostgresStore(url) : new MemoryStore();
  }
  return globalStore.__officeStore;
}

export const storeKind = () => (process.env.DATABASE_URL?.trim() ? "postgres" : "memory");
