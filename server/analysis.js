// Analysis engine: turns a provider-neutral listening dataset into scores.
// Pure functions only; network and storage live elsewhere.

import { albumKey, clamp } from "./acclaim/score.js";

// Share of the final score per metric. Metrics without data (for example,
// critic scores that are still being collected) drop out and the rest are
// rescaled, so a missing source never drags the score down.
export const SCORE_WEIGHTS = {
  diversity: 0.22,
  detailDepth: 0.16,
  discovery: 0.16,
  concentration: 0.12,
  newReleaseSense: 0.09,
  criticTaste: 0.17,
  hiddenGems: 0.08
};

const NEW_RELEASE_WINDOW_DAYS = 180;
const ACCLAIM_MIN_COVERAGE = 0.3;
const ACCLAIM_MIN_ALBUMS = 3;
const GEM_MIN_CRITIC = 78;
const GEM_MAX_POPULARITY = 45;
const MIN_POPULATION = 30;

export function buildAnalysis(dataset, { acclaim = null, population = [] } = {}) {
  const genreWeights = new Map();
  const bucketWeights = new Map();
  const artistWeights = new Map();
  const tracks = dataset.tracks || [];
  const artists = dataset.artists || [];

  tracks.forEach((track, index) => {
    const weight = tracks.length - index;
    for (const artist of track.artists || []) {
      artistWeights.set(artist.name, (artistWeights.get(artist.name) || 0) + weight);
      for (const genre of artist.genres || []) {
        genreWeights.set(genre, (genreWeights.get(genre) || 0) + weight);
        const bucket = mapGenreBucket(genre);
        bucketWeights.set(bucket, (bucketWeights.get(bucket) || 0) + weight);
      }
    }
  });

  if (genreWeights.size === 0) {
    for (const artist of artists) {
      for (const genre of artist.genres || []) {
        genreWeights.set(genre, (genreWeights.get(genre) || 0) + 1);
        const bucket = mapGenreBucket(genre);
        bucketWeights.set(bucket, (bucketWeights.get(bucket) || 0) + 1);
      }
    }
  }

  const genres = rankMap(genreWeights);
  const buckets = rankMap(bucketWeights);
  const topArtists = rankMap(artistWeights).slice(0, 8);
  const avgPopularity = average(tracks.map((track) => track.popularity).filter(Number.isFinite));
  const mainstream = Math.round(avgPopularity || average(artists.map((artist) => artist.popularity).filter(Number.isFinite)) || 50);
  const diversity = diversityScore(bucketWeights, genreWeights);
  const detailDepth = depthScore(tracks, genres);
  const discovery = discoveryScore(tracks, artists, mainstream);
  const concentration = concentrationScore(artistWeights);
  const newReleaseSense = newReleaseScore(tracks, dataset.generatedAt);
  const acclaimResult = acclaimMetrics(tracks, acclaim);
  const parts = {
    diversity,
    detailDepth,
    discovery,
    concentration,
    newReleaseSense,
    criticTaste: acclaimResult.criticTaste,
    hiddenGems: acclaimResult.hiddenGems
  };
  const score = weightedScore(parts);

  return {
    source: dataset.source,
    generatedAt: dataset.generatedAt,
    score,
    metrics: {
      diversity,
      detailDepth,
      discovery,
      concentration,
      newReleaseSense,
      criticTaste: acclaimResult.criticTaste,
      hiddenGems: acclaimResult.hiddenGems,
      mainstream,
      label: scoreLabel(score)
    },
    weights: activeWeights(parts),
    percentile: percentileOf(score, population),
    acclaim: acclaimResult.report,
    buckets: withPercent(buckets).slice(0, 8),
    genres: withPercent(genres).slice(0, 12),
    topArtists,
    topTracks: tracks.slice(0, 8).map((track) => ({
      name: track.name,
      artist: track.artists?.map((artist) => artist.name).join(", ") || "",
      album: track.album || "",
      image: track.image,
      popularity: track.popularity
    })),
    summary: buildSummary(score, buckets, genres, concentration, acclaimResult),
    criticMatches: buildCriticMatches(genres, buckets)
  };
}

function diversityScore(bucketWeights, genreWeights) {
  const bucketEntropy = normalizedEntropy([...bucketWeights.values()]);
  const genreEntropy = normalizedEntropy([...genreWeights.values()]);
  return Math.round(bucketEntropy * 0.55 + genreEntropy * 0.45);
}

function depthScore(tracks, genres) {
  const detailedGenres = genres.filter((genre) => genre.name.includes(" ") || genre.name.includes("-")).length;
  const albums = new Set(tracks.map((track) => track.album).filter(Boolean)).size;
  return Math.round(Math.min(100, detailedGenres * 10) * 0.6 + Math.min(100, albums * 8) * 0.4);
}

function discoveryScore(tracks, artists, mainstream) {
  const uniqueArtists = new Set(tracks.flatMap((track) => (track.artists || []).map((artist) => artist.name))).size;
  const artistPart = Math.min(100, uniqueArtists * 12);
  return Math.max(0, Math.min(100, Math.round(artistPart * 0.55 + (100 - mainstream) * 0.45)));
}

function concentrationScore(artistWeights) {
  const values = [...artistWeights.values()];
  if (values.length < 2) return values.length === 1 ? 25 : 50;
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const topShare = Math.max(...values) / total;
  return Math.round(Math.max(0, Math.min(100, 100 - topShare * 100)));
}

function normalizedEntropy(values) {
  if (values.length <= 1) return values.length ? 25 : 0;
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const entropy = values.reduce((sum, value) => {
    const probability = value / total;
    return sum - probability * Math.log2(probability);
  }, 0);
  return Math.round((entropy / Math.log2(values.length)) * 100);
}

function scoreLabel(score) {
  if (score >= 80) return "탐색형 리스너";
  if (score >= 60) return "균형형 리스너";
  if (score >= 40) return "취향 집중형 리스너";
  return "취향 발견 중";
}

export function mapGenreBucket(genre) {
  const value = genre.toLowerCase();
  if (value.includes("k-pop") || value.includes("korean")) return "K-pop / Korean";
  if (value.includes("j-pop") || value.includes("j-rock") || value.includes("japanese") || value.includes("vocaloid")) return "J-pop / Japanese";
  if (value.includes("hip hop") || value.includes("rap") || value.includes("trap")) return "Hip-hop / Rap";
  if (value.includes("r&b") || value.includes("soul")) return "R&B / Soul";
  if (value.includes("rock") || value.includes("metal") || value.includes("punk")) return "Rock";
  if (value.includes("indie") || value.includes("alternative")) return "Indie / Alternative";
  if (value.includes("electro") || value.includes("house") || value.includes("techno") || value.includes("edm")) return "Electronic";
  if (value.includes("pop")) return "Pop";
  if (value.includes("jazz") || value.includes("classical") || value.includes("ambient")) return "Deep Listening";
  return "Other";
}

function buildSummary(score, buckets, genres, concentration, acclaimResult) {
  const mainBucket = buckets[0]?.name || "mixed music";
  const detail = genres[0]?.name || "genre exploration";
  const stance = concentration >= 70 ? "여러 아티스트를 폭넓게 찾아 듣는 편이에요." : "좋아하는 아티스트를 깊게 파고드는 편이에요.";
  const critic = acclaimResult.report.status === "ready"
    ? ` 자주 듣는 앨범의 평단·청취자 평가는 평균 ${Math.round(acclaimResult.averageCritic)}점이에요.`
    : "";
  return `${mainBucket} 채널이 가장 크고, 세부적으로는 ${detail} 취향이 두드러져요. ${stance}${critic} 점수 ${score}점은 음악 실력의 순위가 아니라 장르 다양성, 감상 깊이, 새 음악을 찾는 성향, 평단이 주목한 음악을 듣는 정도를 합친 값이에요.`;
}

function buildCriticMatches(genres, buckets) {
  const taste = new Set([...genres.slice(0, 6).map((item) => item.name.toLowerCase()), ...buckets.slice(0, 3).map((item) => item.name.toLowerCase())]);
  const critics = [
    { name: "Indie Curator", focus: ["indie", "alternative", "bedroom pop", "rock"], note: "인디/얼터너티브 확장 추천에 강함" },
    { name: "K-pop Analyst", focus: ["k-pop", "korean", "pop", "r&b"], note: "아이돌 팝과 한국 R&B 흐름을 잘 잡음" },
    { name: "Club DJ", focus: ["electronic", "house", "techno", "edm"], note: "전자음악과 댄스 플로어 계열 발견에 적합" },
    { name: "Deep Listener", focus: ["ambient", "jazz", "classical", "deep listening"], note: "앨범 단위 감상과 사운드 질감 분석에 적합" }
  ];

  return critics
    .map((critic) => {
      const overlap = critic.focus.filter((keyword) => [...taste].some((item) => item.includes(keyword)));
      return { ...critic, overlap: overlap.length, match: Math.min(100, overlap.length * 28) };
    })
    .sort((a, b) => b.match - a.match)
    .slice(0, 3);
}

function rankMap(map) {
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function withPercent(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  return items.map((item) => ({ ...item, percent: Math.round((item.value / total) * 100) }));
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedScore(parts) {
  let total = 0;
  let weights = 0;
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    if (!Number.isFinite(parts[key])) continue;
    total += parts[key] * weight;
    weights += weight;
  }
  return weights ? Math.round(total / weights) : 0;
}

function activeWeights(parts) {
  const active = Object.entries(SCORE_WEIGHTS).filter(([key]) => Number.isFinite(parts[key]));
  const sum = active.reduce((total, [, weight]) => total + weight, 0) || 1;
  return Object.fromEntries(active.map(([key, weight]) => [key, Math.round((weight / sum) * 100)]));
}

// How much of the listening is music released in the last six months.
export function newReleaseScore(tracks, generatedAt) {
  const now = Date.parse(generatedAt) || Date.now();
  let dated = 0;
  let fresh = 0;
  tracks.forEach((track, index) => {
    const released = parseReleaseDate(track.releaseDate);
    if (!released) return;
    const weight = tracks.length - index;
    dated += weight;
    const ageDays = (now - released) / (24 * 60 * 60 * 1000);
    if (ageDays >= -7 && ageDays <= NEW_RELEASE_WINDOW_DAYS) fresh += weight;
  });
  if (!dated) return null;
  return Math.round(clamp(((fresh / dated) / 0.4) * 100));
}

function parseReleaseDate(value) {
  const text = String(value || "");
  if (!/^\d{4}/.test(text)) return null;
  // Year-only or year-month dates are treated as the middle of that period.
  const normalized = text.length === 4 ? `${text}-07-01` : text.length === 7 ? `${text}-15` : text;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

// Acclaim metrics from album data. Each album uses its critic score, or its
// community rating when no critic score exists (qualityScore).
// criticTaste: rank-weighted average quality score of the albums listened to.
// hiddenGems: share of listening on highly rated albums that few people play.
export function acclaimMetrics(tracks, acclaim) {
  const empty = (status, extra = {}) => ({
    criticTaste: null,
    hiddenGems: null,
    averageCritic: null,
    report: { status, coverage: 0, albumsTotal: acclaim?.total || 0, albumsWithData: 0, pending: acclaim?.pending || 0, albums: [], ...extra }
  });
  if (!acclaim || !acclaim.enabled) return empty("unavailable");

  const albums = new Map();
  let totalWeight = 0;
  let coveredWeight = 0;
  let criticSum = 0;
  let gemWeight = 0;

  tracks.forEach((track, index) => {
    const weight = tracks.length - index;
    const artist = track.artists?.[0]?.name;
    const key = albumKey(artist, track.album);
    if (!key) return;
    totalWeight += weight;
    const summary = acclaim.summaries.get(key);
    if (!summary || !Number.isFinite(summary.qualityScore)) return;

    coveredWeight += weight;
    criticSum += summary.qualityScore * weight;
    const popularity = Number.isFinite(summary.popularity) ? summary.popularity : track.popularity;
    const gem = summary.qualityScore >= GEM_MIN_CRITIC && Number.isFinite(popularity) && popularity < GEM_MAX_POPULARITY;
    if (gem) gemWeight += weight;

    const entry = albums.get(key) || { ...summary, popularity: Number.isFinite(popularity) ? Math.round(popularity) : null, gem, weight: 0 };
    entry.weight += weight;
    albums.set(key, entry);
  });

  const coverage = totalWeight ? coveredWeight / totalWeight : 0;
  const list = [...albums.values()]
    .sort((a, b) => b.weight - a.weight)
    .map(({ weight, key, ...album }) => album);
  const base = {
    coverage: Math.round(coverage * 100),
    albumsTotal: acclaim.total,
    albumsWithData: albums.size,
    pending: acclaim.pending,
    albums: list.slice(0, 10)
  };

  if (coverage < ACCLAIM_MIN_COVERAGE || albums.size < ACCLAIM_MIN_ALBUMS) {
    const status = acclaim.pending ? "collecting" : acclaim.failed > (acclaim.total - albums.size) / 2 ? "unreachable" : "insufficient";
    return { ...empty(status), report: { status, ...base } };
  }

  const averageCritic = criticSum / coveredWeight;
  return {
    criticTaste: Math.round(clamp(((averageCritic - 55) / (88 - 55)) * 100)),
    hiddenGems: Math.round(clamp(((gemWeight / coveredWeight) / 0.35) * 100)),
    averageCritic,
    report: { status: acclaim.pending ? "updating" : "ready", ...base }
  };
}

// Where this score sits among everyone who consented to store results.
export function percentileOf(score, population) {
  if (!Array.isArray(population) || population.length < MIN_POPULATION) return null;
  const below = population.filter((value) => value < score).length;
  const equal = population.filter((value) => value === score).length;
  return Math.round(((below + equal / 2) / population.length) * 100);
}

