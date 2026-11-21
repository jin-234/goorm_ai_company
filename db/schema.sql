-- 첫 요청 때 서버가 자동으로 만든다. 직접 만들 때만 실행.
CREATE TABLE IF NOT EXISTS offices (
  id            TEXT PRIMARY KEY,
  state         JSONB       NOT NULL,
  clock_anchor  BIGINT      NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
