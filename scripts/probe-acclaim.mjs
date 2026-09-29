// Collects acclaim data for one album from the live APIs and prints what each
// source returned, without touching the cache. Useful to check matching and
// parsing against real data.
//
//   npm run probe -- "Frank Ocean" "Blonde"
//
// Behind an HTTP proxy on Node 22, run with NODE_USE_ENV_PROXY=1.

import { createSources } from "../server/acclaim/sources.js";
import { albumKey, summarizeAlbum } from "../server/acclaim/score.js";

const [artist, album] = process.argv.slice(2);
if (!artist || !album) {
  console.error('Usage: npm run probe -- "<artist>" "<album>"');
  process.exit(1);
}

const sources = createSources({
  contact: process.env.ACCLAIM_CONTACT,
  discogsToken: process.env.DISCOGS_TOKEN,
  lastfmKey: process.env.LASTFM_API_KEY
});
const started = Date.now();
const { status, partial, record, error } = await sources.collect({ key: albumKey(artist, album), artist, album });
const summary = summarizeAlbum(record);

console.log(`${artist} - ${album}: ${status}${partial ? " (partial)" : ""} in ${Date.now() - started}ms`);
if (error) console.log(`  errors: ${error}`);
console.log(`  musicbrainz: ${record.mbid || "-"}, released ${record.releaseDate || "-"}, rating ${record.musicbrainz?.rating ?? "-"} (${record.musicbrainz?.votes ?? 0} votes)`);
console.log(`  critics (${summary.criticCount}): ${summary.critics.map((review) => `${review.label} ${review.raw}`).join(", ") || "-"}`);
console.log(`  awards: ${summary.awards.join(", ") || "-"}; nominations: ${summary.nominations.join(", ") || "-"}; wikipedia editions: ${summary.sitelinks}`);
console.log(`  listenbrainz: ${record.listenbrainz ? `${record.listenbrainz.users} listeners` : "-"}; popularity ${summary.popularity ?? "-"}`);
console.log(`  => quality ${summary.qualityScore ?? "-"} (${summary.qualityBasis || "no direct evidence"}), confidence ${Math.round(summary.confidence * 100)}%`);
