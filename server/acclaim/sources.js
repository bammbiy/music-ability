// Fetchers for open or official music data APIs. Only documented APIs are used:
// no scraping of sites whose terms forbid automated access.
//
// - MusicBrainz: album identity (release group MBID), release date, community rating.
// - Wikidata: critic review scores (P444) keyed by the MusicBrainz release group ID (P436).
// - Discogs (optional, DISCOGS_TOKEN): community rating, have/want counts.
// - Last.fm (optional, LASTFM_API_KEY): listener and play counts.

import { criticSourceFor, normalizeKey, parseReviewScore } from "./score.js";

const FETCH_TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;
const hostQueues = new Map();

// Minimum spacing between requests per host, from each API's published limits.
const HOST_INTERVAL_MS = {
  "musicbrainz.org": 1100,
  "query.wikidata.org": 500,
  "api.discogs.com": 1100,
  "ws.audioscrobbler.com": 250
};

export class SourceError extends Error {
  constructor(source, message) {
    super(`${source}: ${message}`);
    this.source = source;
  }
}

export function createSources({ contact, discogsToken, lastfmKey } = {}) {
  const userAgent = `MusicAbility/0.1 ( ${contact || "https://github.com/bammbiy/music-ability"} )`;

  async function getJson(url, { headers = {}, source } = {}, attempt = 0) {
    const host = new URL(url).hostname;
    await throttle(host);
    let response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
    } catch (error) {
      throw new SourceError(source, `network ${error.name}`);
    }
    if (response.status === 404) return null;
    // 503/429 mean "slow down" (MusicBrainz answers 503 when over its rate limit).
    if ((response.status === 503 || response.status === 429) && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2000 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return getJson(url, { headers, source }, attempt + 1);
    }
    if (!response.ok) throw new SourceError(source, `http ${response.status}`);
    return response.json();
  }

  async function musicbrainz(artist, album) {
    const query = `releasegroup:"${luceneEscape(album)}" AND artist:"${luceneEscape(artist)}"`;
    const search = await getJson(
      `https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=${encodeURIComponent(query)}`,
      { source: "musicbrainz" }
    );
    let match = pickReleaseGroup(search?.["release-groups"] || [], artist, album);
    if (!match) match = await findByArtistAlias(artist, album);
    if (!match) return null;

    const detail = await getJson(
      `https://musicbrainz.org/ws/2/release-group/${match.id}?fmt=json&inc=ratings+genres`,
      { source: "musicbrainz" }
    );
    const rating = detail?.rating;
    return {
      mbid: match.id,
      title: match.title,
      releaseDate: match["first-release-date"] || "",
      rating: Number.isFinite(rating?.value) ? rating.value * 20 : null,
      votes: rating?.["votes-count"] || 0,
      genres: (detail?.genres || []).map((genre) => genre.name).slice(0, 8)
    };
  }

  // Streaming services often use a romanized or English artist name while
  // MusicBrainz credits the original script (Fujii Kaze -> 藤井風). The artist
  // search covers aliases, so resolve the artist ID and search by ID instead.
  async function findByArtistAlias(artist, album) {
    const artists = await getJson(
      `https://musicbrainz.org/ws/2/artist/?fmt=json&limit=3&query=${encodeURIComponent(`artist:"${luceneEscape(artist)}" OR alias:"${luceneEscape(artist)}"`)}`,
      { source: "musicbrainz" }
    );
    const found = (artists?.artists || []).find((candidate) => (candidate.score ?? 0) >= 90);
    if (!found) return null;
    const query = `releasegroup:"${luceneEscape(album)}" AND arid:${found.id}`;
    const search = await getJson(
      `https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=${encodeURIComponent(query)}`,
      { source: "musicbrainz" }
    );
    return (search?.["release-groups"] || []).find((group) => normalizeKey(group.title) === normalizeKey(album)) || null;
  }

  async function wikidataCritics(mbid) {
    const sparql = `
      SELECT ?raw ?by ?byLabel WHERE {
        ?album wdt:P436 "${mbid.replace(/[^0-9a-f-]/gi, "")}" .
        ?album p:P444 ?statement .
        ?statement ps:P444 ?raw .
        OPTIONAL { ?statement pq:P447 ?by . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }`;
    const data = await getJson(
      `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
      { source: "wikidata", headers: { Accept: "application/sparql-results+json" } }
    );
    const critics = [];
    const seen = new Set();
    for (const row of data?.results?.bindings || []) {
      const qid = String(row.by?.value || "").split("/").pop();
      const outlet = criticSourceFor(qid, row.byLabel?.value);
      if (!outlet || seen.has(outlet.key)) continue;
      const raw = row.raw?.value || "";
      const score = parseReviewScore(raw, outlet.scale);
      if (score === null) continue;
      seen.add(outlet.key);
      critics.push({ source: outlet.key, label: outlet.name, raw, score });
    }
    return critics;
  }

  async function discogs(artist, album) {
    if (!discogsToken) return null;
    const headers = { Authorization: `Discogs token=${discogsToken}` };
    const search = await getJson(
      `https://api.discogs.com/database/search?type=master&per_page=5&artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}`,
      { source: "discogs", headers }
    );
    const master = (search?.results || []).find((result) => {
      const [, title = ""] = String(result.title || "").split(/\s+-\s+(.+)/);
      return normalizeKey(title) === normalizeKey(album);
    });
    if (!master) return null;

    const masterDetail = await getJson(`https://api.discogs.com/masters/${master.id}`, { source: "discogs", headers });
    if (!masterDetail?.main_release) return null;
    const release = await getJson(`https://api.discogs.com/releases/${masterDetail.main_release}`, { source: "discogs", headers });
    const community = release?.community || {};
    return {
      rating: Number.isFinite(community.rating?.average) && community.rating.count > 0 ? community.rating.average * 20 : null,
      votes: community.rating?.count || 0,
      have: master.community?.have ?? community.have ?? 0,
      want: master.community?.want ?? community.want ?? 0
    };
  }

  async function lastfm(artist, album) {
    if (!lastfmKey) return null;
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.searchParams.set("method", "album.getinfo");
    url.searchParams.set("artist", artist);
    url.searchParams.set("album", album);
    url.searchParams.set("autocorrect", "1");
    url.searchParams.set("api_key", lastfmKey);
    url.searchParams.set("format", "json");
    const data = await getJson(url.toString(), { source: "lastfm" });
    if (!data?.album) return null;
    return {
      listeners: Number(data.album.listeners) || 0,
      playcount: Number(data.album.playcount) || 0
    };
  }

  // Collects everything available for one album. A failure in one optional
  // source does not throw away what the others returned.
  async function collect({ key, artist, album }) {
    const record = { key, artist, album, critics: [], sources: [] };
    const errors = [];

    let mb = null;
    try {
      mb = await musicbrainz(artist, album);
    } catch (error) {
      errors.push(error);
    }
    if (mb) {
      record.mbid = mb.mbid;
      record.releaseDate = mb.releaseDate;
      record.musicbrainz = { rating: mb.rating, votes: mb.votes, genres: mb.genres };
      record.sources.push("musicbrainz");
      try {
        record.critics = await wikidataCritics(mb.mbid);
        if (record.critics.length) record.sources.push("wikidata");
      } catch (error) {
        errors.push(error);
      }
    }

    for (const [name, fetcher] of [["discogs", discogs], ["lastfm", lastfm]]) {
      try {
        const result = await fetcher(artist, album);
        if (result) {
          record[name] = result;
          record.sources.push(name);
        }
      } catch (error) {
        errors.push(error);
      }
    }

    if (record.sources.length) return { status: "ok", record };
    if (errors.length) return { status: "error", record, error: errors.map((error) => error.message).join("; ") };
    return { status: "not_found", record };
  }

  return { collect, enabled: { discogs: Boolean(discogsToken), lastfm: Boolean(lastfmKey) } };
}

function pickReleaseGroup(groups, artist, album) {
  const wantAlbum = normalizeKey(album);
  const wantArtist = normalizeKey(artist);
  return groups.find((group) => {
    const credit = (group["artist-credit"] || []).map((part) => part.name || part.artist?.name || "").join(" ");
    return (group.score ?? 0) >= 85
      && normalizeKey(group.title) === wantAlbum
      && normalizeKey(credit).includes(wantArtist);
  }) || null;
}

function luceneEscape(value) {
  return String(value).replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");
}

function throttle(host) {
  const interval = HOST_INTERVAL_MS[host] ?? 500;
  const previous = hostQueues.get(host) || Promise.resolve();
  const next = previous.then(() => new Promise((resolve) => setTimeout(resolve, interval)));
  hostQueues.set(host, next.catch(() => {}));
  return previous;
}
