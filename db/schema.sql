-- 첫 요청 때 서버가 자동으로 만든다. 직접 만들 때만 실행.
CREATE TABLE IF NOT EXISTS offices (
  id            TEXT PRIMARY KEY,
  state         JSONB       NOT NULL,
  clock_anchor  BIGINT      NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 동료 대화 기록과 동료별 기억 MD(src/lib/colleague/memory/store.ts). 이것도 첫 요청 때 자동으로 만든다.
CREATE TABLE IF NOT EXISTS colleague_conversations (
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
);
CREATE INDEX IF NOT EXISTS colleague_conversations_office ON colleague_conversations (office_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS colleague_memories (
  office_id     TEXT        NOT NULL,
  persona_id    TEXT        NOT NULL,
  markdown      TEXT        NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (office_id, persona_id)
);
