CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_index INTEGER NOT NULL,
  phase TEXT NOT NULL,
  phase_idx INTEGER NOT NULL,
  cat TEXT NOT NULL,
  prio TEXT NOT NULL,
  title TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  concept TEXT NOT NULL,
  howto JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_phase_order_idx
ON tasks (phase_idx, order_index, id);
