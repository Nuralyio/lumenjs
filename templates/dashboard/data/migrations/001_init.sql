CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,
  value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO stats (label, value, unit) VALUES
  ('Total Users', 1284, 'users'),
  ('Revenue', 42500, 'USD'),
  ('Active Sessions', 89, 'sessions'),
  ('Uptime', 99.97, '%');
