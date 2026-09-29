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

  CREATE TABLE IF NOT EXISTS album_scores (
    album_key TEXT PRIMARY KEY,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'not_found', 'error')),
    record_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
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

export function getAlbumScores(keys) {
  if (keys.length === 0) return new Map();
  const now = new Date().toISOString();
  const statement = database.prepare("SELECT album_key, status, record_json FROM album_scores WHERE album_key = ? AND expires_at > ?");
  const found = new Map();
  for (const key of keys) {
    const row = statement.get(key, now);
    if (row) found.set(row.album_key, { status: row.status, record: JSON.parse(row.record_json) });
  }
  return found;
}

export function saveAlbumScore({ key, artist, album, status, record, ttlMs }) {
  const now = Date.now();
  database.prepare(`
    INSERT INTO album_scores (album_key, artist, album, status, record_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(album_key) DO UPDATE SET
      status = excluded.status,
      record_json = excluded.record_json,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at
  `).run(key, artist, album, status, JSON.stringify(record), new Date(now).toISOString(), new Date(now + ttlMs).toISOString());
}

export function listAlbumRecords(limit = 5000) {
  return database.prepare("SELECT record_json FROM album_scores WHERE status = 'ok' ORDER BY fetched_at DESC LIMIT ?")
    .all(limit)
    .map((row) => JSON.parse(row.record_json));
}

export function getAlbumCacheStats() {
  return database.prepare("SELECT status, COUNT(*) AS count FROM album_scores GROUP BY status").all()
    .reduce((stats, row) => ({ ...stats, [row.status]: row.count }), { ok: 0, not_found: 0, error: 0 });
}

// Latest score per user, used to place a new result within everyone else's.
export function getLatestScores() {
  return database.prepare(`
    SELECT score FROM analysis_snapshots AS s
    WHERE created_at = (SELECT MAX(created_at) FROM analysis_snapshots WHERE user_id = s.user_id)
  `).all().map((row) => row.score);
}
