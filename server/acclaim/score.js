// Pure helpers that turn raw ratings from different sites into one 0-100 scale.
// Nothing here touches the network or the database, so it is easy to test.

// Robert Christgau-style letter grades, mapped onto 0-100.
const LETTER_GRADES = {
  "A+": 100, A: 95, "A-": 90,
  "B+": 85, B: 80, "B-": 75,
  "C+": 70, C: 65, "C-": 60,
  "D+": 55, D: 50, "D-": 45,
  E: 35, F: 30
};

// Sources that publish their own editorial or aggregated critic score.
// Metacritic is already an aggregate of many reviews, so it counts more.
export const CRITIC_SOURCE_WEIGHTS = {
  metacritic: 2,
  pitchfork: 1,
  allmusic: 1,
  "rolling stone": 1,
  "the guardian": 1,
  nme: 1,
  "robert christgau": 1,
  "consequence": 1,
  "entertainment weekly": 1,
  "slant magazine": 1
};

const PRIOR_MEAN = 70;
const PRIOR_VOTES = 10;

export function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*[([].*?(remaster|deluxe|edition|version|expanded|anniversary|explicit|bonus).*?[)\]]/g, "")
    .replace(/\s+-\s+(single|ep)$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function albumKey(artist, album) {
  const a = normalizeKey(artist);
  const b = normalizeKey(album);
  return a && b ? `${a}::${b}` : "";
}

// Parses review score strings like "8.5/10", "4 / 5", "86/100", "A-", "★★★★½".
// Returns a 0-100 number or null when the format is not understood.
export function parseReviewScore(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const fraction = value.match(/^(\d+(?:[.,]\d+)?)\s*(?:\/|out of)\s*(\d+(?:[.,]\d+)?)/i);
  if (fraction) {
    const score = Number(fraction[1].replace(",", "."));
    const max = Number(fraction[2].replace(",", "."));
    if (max > 0 && score >= 0 && score <= max) return round1((score / max) * 100);
    return null;
  }

  const letter = value.toUpperCase().replace(/\s+/g, "");
  if (letter in LETTER_GRADES) return LETTER_GRADES[letter];

  const stars = [...value].filter((character) => character === "★").length;
  const half = value.includes("½") ? 0.5 : 0;
  if (stars > 0) return round1(((stars + half) / 5) * 100);

  return null;
}

// Shrinks averages with few votes toward the prior so that one 5-star vote
// does not outrank thousands of 4.5-star votes.
export function shrinkRating(percent, votes, priorMean = PRIOR_MEAN, priorVotes = PRIOR_VOTES) {
  if (!Number.isFinite(percent)) return null;
  const count = Math.max(0, Number(votes) || 0);
  return round1((count * percent + priorVotes * priorMean) / (count + priorVotes));
}

// Maps Last.fm listener counts onto 0-100: 1k listeners -> 0, 5M -> 100.
export function popularityFromListeners(listeners) {
  const count = Number(listeners);
  if (!Number.isFinite(count) || count <= 0) return null;
  const low = Math.log10(1_000);
  const high = Math.log10(5_000_000);
  return clamp(Math.round(((Math.log10(count) - low) / (high - low)) * 100));
}

// Learns each critic source's mean and spread from every album cached so far.
// Sources grade differently (Pitchfork rarely gives 10, AllMusic is generous),
// so scores are compared as distance from that source's own average.
export function learnSourceCalibration(records, minSamples = 20) {
  const bySource = new Map();
  for (const record of records) {
    for (const review of record.critics || []) {
      if (!Number.isFinite(review.score)) continue;
      const list = bySource.get(review.source) || [];
      list.push(review.score);
      bySource.set(review.source, list);
    }
  }

  const calibration = {};
  for (const [source, scores] of bySource) {
    if (scores.length < minSamples) continue;
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
    const std = Math.sqrt(variance);
    if (std < 1) continue;
    calibration[source] = { mean: round1(mean), std: round1(std), samples: scores.length };
  }
  return calibration;
}

export function calibrateScore(source, score, calibration = {}) {
  const stats = calibration[source];
  if (!stats) return score;
  // Common target scale: mean 72, spread 10, the typical shape of Metacritic scores.
  return clamp(round1(72 + ((score - stats.mean) / stats.std) * 10));
}

// Combines one album's raw source data into comparable scores.
export function summarizeAlbum(record, calibration = {}) {
  const critics = (record.critics || []).filter((review) => Number.isFinite(review.score));
  let criticScore = null;
  if (critics.length) {
    let weighted = 0;
    let weights = 0;
    for (const review of critics) {
      const weight = CRITIC_SOURCE_WEIGHTS[review.source] || 1;
      weighted += calibrateScore(review.source, review.score, calibration) * weight;
      weights += weight;
    }
    criticScore = round1(weighted / weights);
  }

  const audienceParts = [];
  if (Number.isFinite(record.musicbrainz?.rating)) {
    audienceParts.push({ score: shrinkRating(record.musicbrainz.rating, record.musicbrainz.votes), votes: record.musicbrainz.votes || 0 });
  }
  if (Number.isFinite(record.discogs?.rating)) {
    audienceParts.push({ score: shrinkRating(record.discogs.rating, record.discogs.votes), votes: record.discogs.votes || 0 });
  }
  const audienceScore = audienceParts.length
    ? round1(audienceParts.reduce((sum, part) => sum + part.score, 0) / audienceParts.length)
    : null;

  const popularity = popularityFromListeners(record.lastfm?.listeners);

  return {
    key: record.key,
    artist: record.artist,
    album: record.album,
    releaseDate: record.releaseDate || "",
    criticScore,
    criticCount: critics.length,
    critics: critics.map((review) => ({ source: review.source, label: review.label || review.source, raw: review.raw, score: review.score })),
    audienceScore,
    popularity,
    collectorRatio: record.discogs?.have > 0 ? round1((record.discogs.want || 0) / record.discogs.have) : null,
    sources: record.sources || [],
    sample: Boolean(record.sample)
  };
}

export function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
