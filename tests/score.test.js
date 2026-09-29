import test from "node:test";
import assert from "node:assert/strict";
import {
  albumKey,
  calibrateScore,
  learnSourceCalibration,
  parseReviewScore,
  popularityFromListeners,
  shrinkRating,
  summarizeAlbum
} from "../server/acclaim/score.js";

test("parses the review score formats found on Wikidata", () => {
  assert.equal(parseReviewScore("8.5/10"), 85);
  assert.equal(parseReviewScore("4 / 5"), 80);
  assert.equal(parseReviewScore("86/100"), 86);
  assert.equal(parseReviewScore("3.5 out of 5"), 70);
  assert.equal(parseReviewScore("7,5/10"), 75);
  assert.equal(parseReviewScore("A-"), 90);
  assert.equal(parseReviewScore("B+"), 85);
  assert.equal(parseReviewScore("★★★★½"), 90);
  assert.equal(parseReviewScore("11/10"), null);
  assert.equal(parseReviewScore("great"), null);
  assert.equal(parseReviewScore(""), null);
});

test("album keys ignore case, punctuation and edition suffixes", () => {
  assert.equal(albumKey("Radiohead", "OK Computer"), albumKey("RADIOHEAD", "OK Computer (Remastered)"));
  assert.equal(albumKey("Kendrick Lamar", "Mr. Morale & the Big Steppers"), "kendrick lamar::mr morale the big steppers");
  assert.equal(albumKey("", "Album"), "");
  assert.notEqual(albumKey("뉴진스", "OMG"), "");
});

test("few votes are pulled toward the prior", () => {
  assert.equal(shrinkRating(100, 1), 72.7);
  assert.ok(shrinkRating(90, 1000) > 89);
  assert.equal(shrinkRating(null, 10), null);
});

test("listener counts map onto 0-100 on a log scale", () => {
  assert.equal(popularityFromListeners(1000), 0);
  assert.equal(popularityFromListeners(5_000_000), 100);
  assert.ok(popularityFromListeners(70_000) > 40 && popularityFromListeners(70_000) < 60);
  assert.equal(popularityFromListeners(0), null);
});

test("calibration aligns sources that grade on different curves", () => {
  const records = [];
  for (let i = 0; i < 30; i += 1) {
    records.push({ critics: [{ source: "harsh", score: 60 + (i % 10) }, { source: "generous", score: 80 + (i % 10) }] });
  }
  const calibration = learnSourceCalibration(records);
  assert.ok(calibration.harsh && calibration.generous);
  const harshTop = calibrateScore("harsh", 69, calibration);
  const generousTop = calibrateScore("generous", 89, calibration);
  assert.equal(harshTop, generousTop);
  assert.equal(calibrateScore("unknown", 77, calibration), 77);
});

test("sources with too few samples are left uncalibrated", () => {
  const calibration = learnSourceCalibration([{ critics: [{ source: "rare", score: 50 }] }]);
  assert.deepEqual(calibration, {});
});

test("album summary weights Metacritic above single outlets", () => {
  const summary = summarizeAlbum({
    key: "a::b",
    artist: "A",
    album: "B",
    critics: [
      { source: "metacritic", score: 90 },
      { source: "pitchfork", score: 60 }
    ],
    musicbrainz: { rating: 80, votes: 10 },
    lastfm: { listeners: 1000 }
  });
  assert.equal(summary.criticScore, 80);
  assert.equal(summary.criticCount, 2);
  assert.equal(summary.audienceScore, 75);
  assert.equal(summary.popularity, 0);
});
