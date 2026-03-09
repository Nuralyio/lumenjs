CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now'))
);

INSERT INTO posts (title, slug, content, date) VALUES
  ('Hello World', 'hello-world', 'Welcome to your new LumenJS blog! This post was loaded from SQLite.', '2025-01-15'),
  ('Getting Started with LumenJS', 'getting-started', 'LumenJS makes it easy to build full-stack web apps with Lit web components and file-based routing.', '2025-01-20'),
  ('SQLite Persistence', 'sqlite-persistence', 'LumenJS includes built-in SQLite support via better-sqlite3. Just use useDb() in your loaders and API routes.', '2025-01-25');
