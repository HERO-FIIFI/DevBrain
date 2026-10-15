-- Authoritative table declarations. The in-memory database validates every column name against this file.
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  joined_at TEXT NOT NULL
);
