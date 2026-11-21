/**
 * 동료 대화 기록과 동료별 기억(MD) 저장소.
 *
 * - colleague_conversations: 대화·회의 한 건 = 한 줄. 말 한 마디(turn)는 JSONB 배열로 둔다. 고치거나 지울 수 있다.
 * - colleague_memories: 참여자 × 동료 한 줄에 요약 MD 원문(markdown)을 그대로 둔다.
 *   Vercel 함수는 파일을 쓸 수 없으므로 MD 파일은 DB에 두고, API가 .md로 내려 준다.
 * 회사 상태(offices)와 같은 연결 주소를 쓴다. 주소가 없으면 프로세스 메모리(로컬 개발용).
 */
import postgres from "postgres";
import { cleanUrl, databaseUrl } from "@/lib/server/store";
import type { PersonaId } from "./personas";

export type TurnSource = "solar" | "sample" | "manual" | "user";

export interface ChatTurn {
  id: string;
  /** me = 사용자. 그 밖에는 말한 동료. */
  speaker: "me" | PersonaId;
  text: string;
  /** 실제 시각(ISO). */
  at: string;
  /** 누가 만든 말인지. user = 사용자가 쓰거나 손으로 추가한 말. */
  source: TurnSource;
  /** 사용자가 나중에 고쳤는지. */
  edited?: boolean;
}

export type ConversationKind = "chat" | "meeting";

export interface Conversation {
  id: string;
  officeId: string;
  kind: ConversationKind;
  title: string;
  participants: PersonaId[];
  turns: ChatTurn[];
  status: "open" | "closed";
  /** 마칠 때 만든 이 대화의 요약(MD). */
  summaryMd: string;
  /** 시작할 때 읽은 기억이 있었는지(동료별). */
  memoryUsed: PersonaId[];
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
}

export interface ColleagueMemory {
  officeId: string;
  personaId: PersonaId;
  markdown: string;
  updatedAt: string;
}

export interface ConversationStore {
  list(officeId: string): Promise<Conversation[]>;
  get(officeId: string, id: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
  remove(officeId: string, id: string): Promise<void>;
  getMemory(officeId: string, personaId: PersonaId): Promise<ColleagueMemory | null>;
  listMemories(officeId: string): Promise<ColleagueMemory[]>;
  saveMemory(memory: ColleagueMemory): Promise<void>;
  /** 처음부터 다시: 이 참여자의 대화와 기억을 모두 지운다. */
  removeAll(officeId: string): Promise<void>;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryConversationStore implements ConversationStore {
  private conversations = new Map<string, Conversation>();
  private memories = new Map<string, ColleagueMemory>();

  async list(officeId: string) {
    return [...this.conversations.values()]
      .filter((c) => c.officeId === officeId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(copy);
  }
  async get(officeId: string, id: string) {
    const c = this.conversations.get(id);
    return c && c.officeId === officeId ? copy(c) : null;
  }
  async save(conversation: Conversation) {
    this.conversations.set(conversation.id, copy(conversation));
  }
  async remove(officeId: string, id: string) {
    if (this.conversations.get(id)?.officeId === officeId) this.conversations.delete(id);
  }
  async getMemory(officeId: string, personaId: PersonaId) {
    const m = this.memories.get(`${officeId}/${personaId}`);
    return m ? copy(m) : null;
  }
  async listMemories(officeId: string) {
    return [...this.memories.values()].filter((m) => m.officeId === officeId).map(copy);
  }
  async saveMemory(memory: ColleagueMemory) {
    this.memories.set(`${memory.officeId}/${memory.personaId}`, copy(memory));
  }
  async removeAll(officeId: string) {
    for (const [id, c] of this.conversations) if (c.officeId === officeId) this.conversations.delete(id);
    for (const [k, m] of this.memories) if (m.officeId === officeId) this.memories.delete(k);
  }
}

/** 한 문장씩 따로 실행한다(풀러에서 여러 문장을 한 번에 보내지 않는다). */
export const CONVERSATION_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS colleague_conversations (
  id            TEXT PRIMARY KEY,
  office_id     TEXT        NOT NULL,
  kind          TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  participants  JSONB       NOT NULL,
  turns         JSONB       NOT NULL,
  status        TEXT        NOT NULL,
  summary_md    TEXT        NOT NULL DEFAULT '',
  memory_used   JSONB       NOT NULL DEFAULT '[]',
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS colleague_conversations_office ON colleague_conversations (office_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS colleague_memories (
  office_id     TEXT        NOT NULL,
  persona_id    TEXT        NOT NULL,
  markdown      TEXT        NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (office_id, persona_id)
)`,
];

interface ConversationRow {
  id: string;
  office_id: string;
  kind: ConversationKind;
  title: string;
  participants: PersonaId[];
  turns: ChatTurn[];
  status: "open" | "closed";
  summary_md: string;
  memory_used: PersonaId[];
  started_at: Date;
  ended_at: Date | null;
  updated_at: Date;
}

const fromRow = (r: ConversationRow): Conversation => ({
  id: r.id,
  officeId: r.office_id,
  kind: r.kind,
  title: r.title,
  participants: r.participants,
  turns: r.turns,
  status: r.status,
  summaryMd: r.summary_md,
  memoryUsed: r.memory_used ?? [],
  startedAt: new Date(r.started_at).toISOString(),
  endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
  updatedAt: new Date(r.updated_at).toISOString(),
});

export class PostgresConversationStore implements ConversationStore {
  private sql: postgres.Sql;
  private ready: Promise<unknown> | null = null;

  constructor(url: string) {
    const host = new URL(url).hostname;
    this.sql = postgres(cleanUrl(url), {
      prepare: false,
      ssl: host === "localhost" || host === "127.0.0.1" ? false : "require",
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }

  private ensureTables() {
    this.ready ??= (async () => {
      for (const statement of CONVERSATION_SCHEMA_SQL) await this.sql.unsafe(statement);
    })().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private json(v: unknown) {
    return this.sql.json(v as postgres.JSONValue);
  }

  async list(officeId: string) {
    await this.ensureTables();
    const rows = await this.sql<ConversationRow[]>`
      SELECT * FROM colleague_conversations WHERE office_id = ${officeId} ORDER BY updated_at DESC LIMIT 200`;
    return rows.map(fromRow);
  }

  async get(officeId: string, id: string) {
    await this.ensureTables();
    const rows = await this.sql<ConversationRow[]>`
      SELECT * FROM colleague_conversations WHERE office_id = ${officeId} AND id = ${id}`;
    return rows.length ? fromRow(rows[0]) : null;
  }

  async save(c: Conversation) {
    await this.ensureTables();
    await this.sql`
      INSERT INTO colleague_conversations
        (id, office_id, kind, title, participants, turns, status, summary_md, memory_used, started_at, ended_at, updated_at)
      VALUES
        (${c.id}, ${c.officeId}, ${c.kind}, ${c.title}, ${this.json(c.participants)}, ${this.json(c.turns)}, ${c.status},
         ${c.summaryMd}, ${this.json(c.memoryUsed)}, ${c.startedAt}, ${c.endedAt}, ${c.updatedAt})
      ON CONFLICT (id) DO UPDATE SET
        kind = EXCLUDED.kind, title = EXCLUDED.title, participants = EXCLUDED.participants, turns = EXCLUDED.turns,
        status = EXCLUDED.status, summary_md = EXCLUDED.summary_md, memory_used = EXCLUDED.memory_used,
        ended_at = EXCLUDED.ended_at, updated_at = EXCLUDED.updated_at
      WHERE colleague_conversations.office_id = EXCLUDED.office_id`;
  }

  async remove(officeId: string, id: string) {
    await this.ensureTables();
    await this.sql`DELETE FROM colleague_conversations WHERE office_id = ${officeId} AND id = ${id}`;
  }

  async getMemory(officeId: string, personaId: PersonaId) {
    await this.ensureTables();
    const rows = await this.sql<{ markdown: string; updated_at: Date }[]>`
      SELECT markdown, updated_at FROM colleague_memories WHERE office_id = ${officeId} AND persona_id = ${personaId}`;
    return rows.length ? { officeId, personaId, markdown: rows[0].markdown, updatedAt: new Date(rows[0].updated_at).toISOString() } : null;
  }

  async listMemories(officeId: string) {
    await this.ensureTables();
    const rows = await this.sql<{ persona_id: PersonaId; markdown: string; updated_at: Date }[]>`
      SELECT persona_id, markdown, updated_at FROM colleague_memories WHERE office_id = ${officeId}`;
    return rows.map((r) => ({ officeId, personaId: r.persona_id, markdown: r.markdown, updatedAt: new Date(r.updated_at).toISOString() }));
  }

  async saveMemory(m: ColleagueMemory) {
    await this.ensureTables();
    await this.sql`
      INSERT INTO colleague_memories (office_id, persona_id, markdown, updated_at)
      VALUES (${m.officeId}, ${m.personaId}, ${m.markdown}, ${m.updatedAt})
      ON CONFLICT (office_id, persona_id) DO UPDATE SET markdown = EXCLUDED.markdown, updated_at = EXCLUDED.updated_at`;
  }

  async removeAll(officeId: string) {
    await this.ensureTables();
    await this.sql`DELETE FROM colleague_conversations WHERE office_id = ${officeId}`;
    await this.sql`DELETE FROM colleague_memories WHERE office_id = ${officeId}`;
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

const globalStore = globalThis as unknown as { __conversationStore?: ConversationStore };

export function getConversationStore(): ConversationStore {
  if (!globalStore.__conversationStore) {
    const url = databaseUrl();
    globalStore.__conversationStore = url ? new PostgresConversationStore(url) : new MemoryConversationStore();
  }
  return globalStore.__conversationStore;
}
