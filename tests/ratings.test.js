import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { combineEvidence, summarizeAlbum } from "../server/acclaim/score.js";

const dir = mkdtempSync(join(tmpdir(), "music-ability-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");
const store = await import("../server/store.js");
const { createAcclaimService } = await import("../server/acclaim/index.js");

test.after(() => rmSync(dir, { recursive: true, force: true }));

function consent(userId) {
  store.saveConsent({ userId, provider: "spotify", consentedAt: new Date().toISOString() });
}

test("one rating per user and album; rating again replaces it", () => {
  consent("u1");
  store.saveAlbumRating({ userId: "u1", key: "a::x", artist: "A", album: "X", rating: 6 });
  store.saveAlbumRating({ userId: "u1", key: "a::x", artist: "A", album: "X", rating: 9 });
  assert.equal(store.getUserRatings("u1", ["a::x"]).get("a::x"), 9);
  assert.deepEqual(store.getCommunityRatings(["a::x"]).get("a::x"), { average: 9, votes: 1 });
});

test("a viewer's own ratings are left out of their community stats", () => {
  consent("u2");
  consent("u3");
  store.saveAlbumRating({ userId: "u2", key: "b::y", artist: "B", album: "Y", rating: 10 });
  store.saveAlbumRating({ userId: "u3", key: "b::y", artist: "B", album: "Y", rating: 6 });
  assert.equal(store.getCommunityRatings(["b::y"]).get("b::y").votes, 2);
  assert.deepEqual(store.getCommunityRatings(["b::y"], "u2").get("b::y"), { average: 6, votes: 1 });
  assert.equal(store.getCommunityRatings(["b::y", "none"], "u2").has("none"), false);
});

test("ratings need a consented user and are deleted with the account", () => {
  assert.throws(() => store.saveAlbumRating({ userId: "stranger", key: "c::z", artist: "C", album: "Z", rating: 5 }));
  consent("u4");
  store.saveAlbumRating({ userId: "u4", key: "c::z", artist: "C", album: "Z", rating: 5 });
  store.deleteUserData("u4");
  assert.equal(store.getCommunityRatings(["c::z"]).has("c::z"), false);
});

test("ratings outside 1-10 are rejected by the database", () => {
  consent("u5");
  assert.throws(() => store.saveAlbumRating({ userId: "u5", key: "d::w", artist: "D", album: "W", rating: 11 }));
});

test("user ratings become evidence, weighted by vote count", () => {
  const few = combineEvidence({ communityScore: 90, communityVotes: 2 });
  const many = combineEvidence({ communityScore: 90, communityVotes: 200 });
  assert.equal(many.qualityBasis, "members");
  assert.ok(many.confidence > few.confidence);

  const summary = summarizeAlbum({ key: "e::v", artist: "E", album: "V", critics: [] }, {}, { average: 8.5, votes: 30 });
  assert.equal(summary.communityAverage, 8.5);
  assert.equal(summary.communityVotes, 30);
  assert.ok(summary.qualityScore > 75);
});

test("albums without open data still get a summary from user ratings", () => {
  const service = createAcclaimService({ enabled: false });
  store.saveAlbumScore({ key: "hyukoh::23", artist: "Hyukoh", album: "23", status: "not_found", record: {}, ttlMs: 60_000 });
  for (const user of ["m1", "m2", "m3"]) {
    consent(user);
    store.saveAlbumRating({ userId: user, key: "hyukoh::23", artist: "Hyukoh", album: "23", rating: 9 });
  }
  const forOthers = service.lookup([{ artist: "Hyukoh", album: "23" }]);
  assert.equal(forOthers.summaries.get("hyukoh::23").qualityBasis, "members");
  assert.equal(forOthers.summaries.get("hyukoh::23").communityVotes, 3);

  const forRater = service.lookup([{ artist: "Hyukoh", album: "23" }], { excludeUserId: "m1" });
  assert.equal(forRater.summaries.get("hyukoh::23").communityVotes, 2);
});
