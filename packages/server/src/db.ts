import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { defaultDataDir } from '@githanger/shared';

export type Db = Database.Database;

export function openDb(dbPath?: string): Db {
  const dir = defaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = dbPath ?? path.join(dir, 'githanger.sqlite');
  const db = new Database(finalPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      repoPath TEXT NOT NULL,
      worktreePath TEXT NOT NULL,
      branch TEXT NOT NULL,
      pid INTEGER,
      status TEXT NOT NULL,
      startedAt INTEGER NOT NULL,
      endedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      sessionId TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT,
      FOREIGN KEY(sessionId) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(sessionId, ts);
  `);
}
