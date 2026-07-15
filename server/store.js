import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = join(process.cwd(), "data", "music-ability.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    consented_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analysis_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    score INTEGER NOT NULL,
    metrics_json TEXT NOT NULL,
    buckets_json TEXT NOT NULL,
    genres_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`);

export function saveConsent({ userId, provider, consentedAt }) {
  const statement = database.prepare(`
    INSERT INTO users (user_id, provider, consented_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      consented_at = excluded.consented_at,
      updated_at = excluded.updated_at
  `);
  statement.run(userId, provider, consentedAt, consentedAt, consentedAt);
}

export function saveAnalysisSnapshot({ userId, provider, analysis }) {
  const createdAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO analysis_snapshots
      (user_id, provider, score, metrics_json, buckets_json, genres_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    provider,
    analysis.score,
    JSON.stringify(analysis.metrics),
    JSON.stringify(analysis.buckets),
    JSON.stringify(analysis.genres),
    createdAt
  );
}

export function saveFeedback({ userId, targetType, targetId, rating }) {
  database.prepare(`
    INSERT INTO feedback (user_id, target_type, target_id, rating, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, targetType, targetId, rating, new Date().toISOString());
}

export function deleteUserData(userId) {
  database.prepare("DELETE FROM users WHERE user_id = ?").run(userId);
}

export function getCollectionStats() {
  const users = database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const snapshots = database.prepare("SELECT COUNT(*) AS count FROM analysis_snapshots").get().count;
  const feedback = database.prepare("SELECT COUNT(*) AS count FROM feedback").get().count;
  return { users, snapshots, feedback };
}
