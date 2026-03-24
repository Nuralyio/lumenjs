/**
 * Communication module DB schema.
 * Call ensureCommunicationTables(db) to create all required tables.
 */

interface Db {
  exec(sql: string): void;
}

export function ensureCommunicationTables(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'text',
      reply_to TEXT,
      attachment TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      encrypted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS read_receipts (
      message_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS encryption_keys (
      user_id TEXT PRIMARY KEY,
      identity_key TEXT NOT NULL,
      signed_pre_key_id INTEGER NOT NULL,
      signed_pre_key TEXT NOT NULL,
      signed_pre_key_signature TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS encryption_prekeys (
      user_id TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      public_key TEXT NOT NULL,
      PRIMARY KEY (user_id, key_id),
      FOREIGN KEY (user_id) REFERENCES encryption_keys(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);
  `);
}
