import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export type Db = Database.Database;

function defaultDataDir() {
  return path.join(os.homedir(), '.githanger');
}

export function openDb(dbPath?: string): Db {
  const dir = defaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = dbPath ?? path.join(dir, 'githanger.sqlite');
  const db = new Database(finalPath);
  db.pragma('journal_mode = WAL');
  // keep migration duplicated for now; later move to shared.
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS branch_stashes (
      repoPath TEXT NOT NULL,
      branch TEXT NOT NULL,
      stashRef TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (repoPath, branch)
    );

    CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(sessionId, ts);
  `);
  return db;
}
