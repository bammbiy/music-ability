import test from "node:test";
import assert from "node:assert/strict";
import { bestTitleMatch, canonicalOrdinals, comparableTitle, foldText, pickArtist, searchTitle, titleSimilarity, titleVariants } from "../server/acclaim/match.js";

test("folds accents on Latin letters only", () => {
  assert.equal(foldText("Fantôme"), "fantome");
  assert.notEqual(foldText("ブルー"), foldText("フルー"));
  assert.equal(foldText("장범준 1집"), "장범준 1집");
});

test("ordinal album names share one form in English and Korean", () => {
  assert.equal(canonicalOrdinals("1st album"), "album 1");
  assert.equal(canonicalOrdinals("the 1st full album"), "album 1");
  assert.equal(canonicalOrdinals("정규 1집"), "album 1");
  assert.equal(canonicalOrdinals("2nd mini album"), "mini album 2");
  assert.equal(canonicalOrdinals("미니 2집"), "mini album 2");
  assert.equal(canonicalOrdinals("집에 가지 않는 연인들"), "집에 가지 않는 연인들");
});

test("artist names are removed from titles on both sides", () => {
  const names = ["Jang Beom June", "장범준"];
  assert.equal(comparableTitle("Jang Beom June 1st Album", names), "album 1");
  assert.equal(comparableTitle("장범준 1집", names), "album 1");
  // Self-titled albums keep their title instead of becoming empty.
  assert.equal(comparableTitle("BTS", ["BTS"]), "bts");
});

test("title similarity accepts extra script characters but not different subtitles", () => {
  const tear = comparableTitle("LOVE YOURSELF 轉 ‘Tear’");
  assert.ok(titleSimilarity(comparableTitle("Love Yourself: Tear"), tear) >= 0.85);
  assert.ok(titleSimilarity(comparableTitle("Love Yourself: Her"), tear) < 0.85);
  assert.ok(titleSimilarity("folklore", "folk lore") >= 0.85);
});

const btsGroups = [
  { id: "her", title: "LOVE YOURSELF 承 ‘Her’", "primary-type": "EP" },
  { id: "tear", title: "LOVE YOURSELF 轉 ‘Tear’", "primary-type": "Album" },
  { id: "answer", title: "LOVE YOURSELF 結 ‘Answer’", "primary-type": "Album", "secondary-types": ["Compilation"] },
  { id: "mots7", title: "MAP OF THE SOUL : 7", "primary-type": "Album" },
  { id: "mots7j", title: "MAP OF THE SOUL : 7 〜 THE JOURNEY 〜", "primary-type": "Album" }
];

test("picks the right release from an artist catalog", () => {
  assert.equal(bestTitleMatch(btsGroups, "Love Yourself: Tear", ["BTS"]).id, "tear");
  assert.equal(bestTitleMatch(btsGroups, "LOVE YOURSELF 結 'Answer'", ["BTS"]).id, "answer");
  assert.equal(bestTitleMatch(btsGroups, "MAP OF THE SOUL : 7", ["BTS"]).id, "mots7");
  assert.equal(bestTitleMatch(btsGroups, "Wings", ["BTS"]), null);
});

test("ambiguous fuzzy matches are rejected", () => {
  const groups = [
    { id: "a", title: "Songs Vol 1 Deluxe", "primary-type": "Album" },
    { id: "b", title: "Songs Vol 1 Remixes", "primary-type": "Album" }
  ];
  assert.equal(bestTitleMatch(groups, "Songs Vol 1", []), null);
});

test("artist picker prefers exact names and aliases over special entries", () => {
  const candidates = [
    { id: "son", score: 100, name: "[Hikaru Utada’s son]" },
    { id: "utada", score: 94, name: "宇多田ヒカル", "sort-name": "Utada, Hikaru", aliases: [{ name: "Utada" }] }
  ];
  assert.equal(pickArtist(candidates, "Hikaru Utada").id, "utada");
  assert.equal(pickArtist([{ id: "x", score: 80, name: "Someone Else" }], "Nobody"), null);
});

test("edition notes and dash descriptors do not block a match", () => {
  assert.equal(searchTitle("OK Computer (Remastered)"), "OK Computer");
  assert.equal(searchTitle("Blonde [Explicit]"), "Blonde");
  assert.equal(searchTitle("Songs (feat. Someone)"), "Songs (feat. Someone)");
  assert.equal(searchTitle("Ditto - Single"), "Ditto");
  assert.deepEqual(titleVariants("Armageddon - The 1st Album"), ["Armageddon - The 1st Album", "Armageddon"]);
  const groups = [{ id: "arm", title: "Armageddon", "primary-type": "Album" }, { id: "sp", title: "Supernova", "primary-type": "Single" }];
  assert.equal(bestTitleMatch(groups, "Armageddon - The 1st Album", ["aespa"]).id, "arm");
});

test("titles in another language match through release-group aliases", () => {
  const groups = [
    { id: "p1", title: "화양연화 pt.1", "primary-type": "EP", aliases: [{ name: "The Most Beautiful Moment in Life, Part 1" }] },
    { id: "p2", title: "화양연화 pt.2", "primary-type": "EP", aliases: [{ name: "The Most Beautiful Moment In Life, Pt. 2" }, { name: "The Most Beautiful Moment in Life, Part 2" }] },
    { id: "yf", title: "화양연화 Young Forever", "primary-type": "Album", "secondary-types": ["Compilation"], aliases: [{ name: "The Most Beautiful Moment in Life: Young Forever" }] }
  ];
  assert.equal(bestTitleMatch(groups, "The Most Beautiful Moment in Life, Pt.1", ["BTS"]).id, "p1");
  assert.equal(bestTitleMatch(groups, "The Most Beautiful Moment in Life, Pt. 2", ["BTS"]).id, "p2");
  assert.equal(bestTitleMatch(groups, "화양연화 Young Forever", ["BTS"]).id, "yf");
  assert.equal(bestTitleMatch(groups, "The Most Beautiful Moment in Life", ["BTS"]), null, "ambiguous without a part number");
});

test("part and volume numbers share one form", () => {
  assert.equal(canonicalOrdinals("songs pt 1"), "songs part 1");
  assert.equal(canonicalOrdinals("songs pt1"), "songs part 1");
  assert.equal(canonicalOrdinals("songs vol 2"), "songs volume 2");
});
