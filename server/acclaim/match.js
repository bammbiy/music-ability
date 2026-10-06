// Pure title and artist matching between streaming metadata and MusicBrainz.
//
// Streaming services and MusicBrainz often spell the same release differently:
//   "Jang Beom June 1st Album"  vs  "장범준 1집"
//   "Love Yourself: Tear"       vs  "LOVE YOURSELF 轉 ‘Tear’"
//   "Fantome"                   vs  "Fantôme"
// These helpers compare titles on a canonical form and only accept a fuzzy
// match when it is unambiguous.

import { normalizeKey } from "./score.js";

const MIN_SIMILARITY = 0.85;

// Lowercase, strip accents and punctuation, collapse whitespace.
export function foldText(value) {
  // Only Latin accents are dropped (ô -> o); marks in other scripts, such as
  // Japanese dakuten, change the word and are kept.
  return normalizeKey(String(value || "").normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1"));
}

// Canonical ordinal album names and part numbers:
// "Pt. 1", "pt.1", "Part 1" -> "part 1"; "Vol. 2" -> "volume 2"; "1st Album", "The 1st Full Album", "정규 1집" -> "album 1";
// "2nd Mini Album", "미니 2집" -> "mini album 2".
export function canonicalOrdinals(text) {
  return text
    .replace(/\bpt\s*(\d+)\b/g, "part $1")
    .replace(/\bvol\s*(\d+)\b/g, "volume $1")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/정규\s*/g, "")
    .replace(/\b(the|full|studio|regular)\b/g, " ")
    .replace(/미니\s*(\d+)\s*집/g, " mini album $1 ")
    .replace(/(\d+)\s*집/g, " album $1 ")
    .replace(/\b(\d+)\s+mini\s+album\b/g, " mini album $1 ")
    .replace(/\bmini\s+album\s+(\d+)\b/g, " mini album $1 ")
    .replace(/\b(\d+)\s+album\b/g, " album $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

// Title reduced for comparison. Artist names are removed because many
// Korean releases are titled "<artist> <n>집" and the artist may be written
// in another script on each side.
export function comparableTitle(title, artistNames = []) {
  const folded = canonicalOrdinals(foldText(title));
  let stripped = folded;
  for (const name of artistNames) {
    const artist = foldText(name);
    if (artist.length < 2) continue;
    stripped = ` ${stripped} `.replace(` ${artist} `, " ").trim();
  }
  return stripped || folded;
}

const EDITION_WORDS = /remaster|deluxe|edition|version|expanded|anniversary|explicit|bonus|live|mono|stereo/i;

// Search-friendly title: drops bracketed edition notes and " - Single"/" - EP".
export function searchTitle(album) {
  const cleaned = String(album || "")
    .replace(/\s*[([][^)\]]*[)\]]/g, (part) => (EDITION_WORDS.test(part) ? "" : part))
    .replace(/\s+-\s+(single|ep)$/i, "")
    .trim();
  return cleaned || String(album || "");
}

// Title forms worth comparing. Streaming titles often append a descriptor
// after a dash ("Armageddon - The 1st Album", "Night Visions - Deluxe"),
// while MusicBrainz stores only the main title.
export function titleVariants(album) {
  const base = searchTitle(album);
  const variants = [base];
  const dash = base.split(/\s+[-–—]\s+/);
  if (dash.length > 1 && dash[0].trim().length >= 2) variants.push(dash[0].trim());
  return [...new Set(variants)];
}

export function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.replace(/\s/g, "") === b.replace(/\s/g, "")) return 0.98;

  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  const overlap = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  const jaccard = overlap / union;

  // Every word of the shorter title appears in the longer one, with at most
  // two extra words (for example the Hanja in "LOVE YOURSELF 轉 Tear").
  const shorter = Math.min(left.size, right.size);
  const extra = Math.max(left.size, right.size) - shorter;
  const contained = overlap === shorter && shorter >= 2 && extra <= 2;
  return contained ? Math.max(jaccard, 0.9 - extra * 0.02) : jaccard;
}

// Picks the release group whose title best matches. Returns null when nothing
// is close enough or when two different titles tie for the best score.
export function bestTitleMatch(groups, album, artistNames = []) {
  const wants = titleVariants(album).map((variant) => comparableTitle(variant, artistNames));
  const scored = groups
    .map((group) => {
      // MusicBrainz aliases carry titles in other languages
      // ("화양연화 pt.1" -> "The Most Beautiful Moment in Life, Part 1").
      const titles = [group.title, ...(group.aliases || []).map((alias) => alias.name)]
        .filter(Boolean)
        .map((title) => comparableTitle(title, artistNames));
      return { group, score: Math.max(...titles.flatMap((title) => wants.map((want) => titleSimilarity(want, title)))) };
    })
    .filter((entry) => entry.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score || typeRank(a.group) - typeRank(b.group));

  if (!scored.length) return null;
  const [best, runnerUp] = scored;
  if (runnerUp && runnerUp.score === best.score && best.score < 1 && foldText(runnerUp.group.title) !== foldText(best.group.title)) {
    return null;
  }
  return best.group;
}

// Chooses the MusicBrainz artist for a streaming artist name. Prefers an exact
// match on name, sort name or alias, ignores special-purpose entries such as
// "[unknown]" or "[Hikaru Utada's son]", and falls back to a very high score.
export function pickArtist(candidates, name) {
  const want = foldText(name).replace(/\s/g, "");
  const real = candidates.filter((candidate) => !/^\[.*\]$/.test(String(candidate.name || "").trim()));
  const names = (candidate) => [
    candidate.name,
    candidate["sort-name"],
    reverseSortName(candidate["sort-name"]),
    ...(candidate.aliases || []).flatMap((alias) => [alias.name, alias["sort-name"], reverseSortName(alias["sort-name"])])
  ];
  const exact = real.find((candidate) => names(candidate).some((value) => value && foldText(value).replace(/\s/g, "") === want));
  return exact || real.find((candidate) => (candidate.score ?? 0) >= 95) || null;
}

function reverseSortName(value) {
  const [last, first] = String(value || "").split(/,\s*/);
  return first ? `${first} ${last}` : "";
}

// Studio albums before EPs before singles; compilations and live albums last.
function typeRank(group) {
  const secondary = group["secondary-types"] || [];
  const base = { Album: 0, EP: 1, Single: 2 }[group["primary-type"]] ?? 3;
  return base + (secondary.length ? 4 : 0);
}
