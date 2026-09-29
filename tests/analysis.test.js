import test from "node:test";
import assert from "node:assert/strict";
import { acclaimMetrics, buildAnalysis, newReleaseScore, percentileOf } from "../server/analysis.js";
import { albumKey, summarizeAlbum } from "../server/acclaim/score.js";

const genres = ["indie rock"];
const tracks = [
  { name: "t1", album: "Loved", releaseDate: "2024-05-01", popularity: 30, artists: [{ name: "Quiet Band", genres }] },
  { name: "t2", album: "Hit", releaseDate: "2020-01-01", popularity: 90, artists: [{ name: "Star", genres: ["pop"] }] },
  { name: "t3", album: "Middle", releaseDate: "2019", popularity: 60, artists: [{ name: "Other", genres: ["house"] }] },
  { name: "t4", album: "Unknown", releaseDate: "", popularity: 50, artists: [{ name: "Nobody", genres: ["jazz"] }] }
];

function acclaimFor(records, extra = {}) {
  const summaries = new Map(records.map((record) => {
    const key = albumKey(record.artist, record.album);
    return [key, summarizeAlbum({ ...record, key })];
  }));
  return { summaries, pending: 0, notFound: 0, total: 4, enabled: true, ...extra };
}

const records = [
  { artist: "Quiet Band", album: "Loved", critics: [{ source: "metacritic", score: 90 }], lastfm: { listeners: 5000 } },
  { artist: "Star", album: "Hit", critics: [{ source: "metacritic", score: 65 }], lastfm: { listeners: 4_000_000 } },
  { artist: "Other", album: "Middle", critics: [{ source: "metacritic", score: 75 }], lastfm: { listeners: 200_000 } }
];

test("new release metric counts music from the last six months", () => {
  assert.equal(newReleaseScore(tracks, "2024-06-01T00:00:00Z"), 100);
  assert.equal(newReleaseScore(tracks, "2026-01-01T00:00:00Z"), 0);
  assert.equal(newReleaseScore([{ releaseDate: "" }], "2024-06-01T00:00:00Z"), null);
});

test("critic metrics need enough covered albums", () => {
  const sparse = acclaimMetrics(tracks, acclaimFor(records.slice(0, 1)));
  assert.equal(sparse.criticTaste, null);
  assert.equal(sparse.report.status, "insufficient");

  const collecting = acclaimMetrics(tracks, acclaimFor(records.slice(0, 1), { pending: 3 }));
  assert.equal(collecting.report.status, "collecting");

  const ready = acclaimMetrics(tracks, acclaimFor(records));
  assert.equal(ready.report.status, "ready");
  assert.ok(ready.criticTaste > 0 && ready.criticTaste <= 100);
  assert.ok(ready.hiddenGems > 0, "the acclaimed, rarely played album counts as a hidden gem");
  assert.equal(ready.report.albums[0].album, "Loved");
  assert.equal(ready.report.albums[0].gem, true);
});

test("disabled acclaim leaves critic metrics out of the score", () => {
  const without = buildAnalysis({ tracks, artists: [], generatedAt: "2024-06-01T00:00:00Z" });
  assert.equal(without.metrics.criticTaste, null);
  assert.equal(without.acclaim.status, "unavailable");
  assert.equal(without.weights.criticTaste, undefined);
  assert.equal(Object.values(without.weights).reduce((a, b) => a + b, 0) >= 99, true);

  const withData = buildAnalysis({ tracks, artists: [], generatedAt: "2024-06-01T00:00:00Z" }, { acclaim: acclaimFor(records) });
  assert.ok(Number.isFinite(withData.metrics.criticTaste));
  assert.ok(withData.weights.criticTaste > 0);
  assert.match(withData.summary, /평단 점수/);
});

test("percentile needs a large enough population", () => {
  assert.equal(percentileOf(70, [60, 80]), null);
  const population = Array.from({ length: 100 }, (_, index) => index);
  assert.equal(percentileOf(50, population), 51);
  assert.equal(percentileOf(0, population), 1);
});

test("network failures are reported separately from missing data", () => {
  const result = acclaimMetrics(tracks, { summaries: new Map(), pending: 0, notFound: 0, failed: 4, total: 4, enabled: true });
  assert.equal(result.report.status, "unreachable");
  assert.equal(result.criticTaste, null);
});
