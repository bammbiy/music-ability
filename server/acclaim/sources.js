// Fetchers for open or official music data APIs. Only documented APIs are used:
// no scraping of sites whose terms forbid automated access.
//
// - MusicBrainz: album identity (release group MBID), release date, community rating.
// - Wikidata: critic review scores (P444), awards (P166), nominations (P1411),
//   number of Wikipedia language editions, keyed by the release group ID (P436).
// - English Wikipedia: the article's professional ratings box (CC BY-SA).
// - ListenBrainz: how many listeners played the album (open data, no key).
// - Discogs (optional, DISCOGS_TOKEN): community rating, have/want counts.
// - Last.fm (optional, LASTFM_API_KEY): listener and play counts.

import { criticSourceFor, normalizeKey, parseReviewScore } from "./score.js";
import { bestTitleMatch, pickArtist, searchTitle } from "./match.js";
import { parseWikipediaRatings } from "./wikipedia.js";

const FETCH_TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;
const ARTIST_CACHE_TTL_MS = 60 * 60 * 1000;
const ARTIST_CACHE_MAX = 500;
const MAX_BROWSE_PAGES = 3;
const hostQueues = new Map();

// Minimum spacing between requests per host, from each API's published limits.
const HOST_INTERVAL_MS = {
  "musicbrainz.org": 1100,
  "query.wikidata.org": 500,
  "en.wikipedia.org": 200,
  "api.listenbrainz.org": 500,
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
  // Artist ID and release-group list per artist, reused across that artist's albums.
  const artistCache = new Map();

  async function getJson(url, { headers = {}, source, method = "GET", body } = {}, attempt = 0) {
    const host = new URL(url).hostname;
    await throttle(host);
    let response;
    try {
      response = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": userAgent, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
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
      return getJson(url, { headers, source, method, body }, attempt + 1);
    }
    if (!response.ok) throw new SourceError(source, `http ${response.status}`);
    return response.json();
  }

  async function musicbrainz(artist, album) {
    const query = `releasegroup:"${luceneEscape(searchTitle(album))}" AND artist:"${luceneEscape(artist)}"`;
    const search = await getJson(
      `https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=${encodeURIComponent(query)}`,
      { source: "musicbrainz" }
    );
    let match = pickReleaseGroup(search?.["release-groups"] || [], artist, album);
    if (!match) match = await findInArtistCatalog(artist, album);
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

  // Fallback when the exact search misses. Streaming services often use a
  // romanized or English artist name while MusicBrainz credits the original
  // script (Fujii Kaze -> 藤井風), and titles differ in form ("1st Album" vs
  // "1집"). Resolve the artist through its aliases, then fuzzy-match the title
  // against that artist's own releases only, which keeps false matches rare.
  async function findInArtistCatalog(artist, album) {
    const catalog = await artistCatalog(artist);
    if (!catalog) return null;
    return bestTitleMatch(catalog.groups, album, [artist, ...catalog.names]);
  }

  async function artistCatalog(artist) {
    const cacheKey = normalizeKey(artist);
    const cached = artistCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const search = await getJson(
      `https://musicbrainz.org/ws/2/artist/?fmt=json&limit=5&query=${encodeURIComponent(`artist:"${luceneEscape(artist)}" OR alias:"${luceneEscape(artist)}"`)}`,
      { source: "musicbrainz" }
    );
    const found = pickArtist(search?.artists || [], artist);
    let value = null;
    if (found) {
      const groups = [];
      for (let page = 0; page < MAX_BROWSE_PAGES; page += 1) {
        const data = await getJson(
          `https://musicbrainz.org/ws/2/release-group?fmt=json&limit=100&offset=${page * 100}&type=album|ep|single&artist=${found.id}`,
          { source: "musicbrainz" }
        );
        const batch = data?.["release-groups"] || [];
        groups.push(...batch);
        if (groups.length >= (data?.["release-group-count"] ?? 0) || batch.length < 100) break;
      }
      const names = [found.name, found["sort-name"], ...(found.aliases || []).map((alias) => alias.name)].filter(Boolean);
      value = { id: found.id, names, groups };
    }

    if (artistCache.size >= ARTIST_CACHE_MAX) artistCache.delete(artistCache.keys().next().value);
    artistCache.set(cacheKey, { value, expiresAt: Date.now() + ARTIST_CACHE_TTL_MS });
    return value;
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

  // Recognition beyond reviews: awards and nominations (Grammy, Mercury Prize,
  // Korean Music Awards, Music Awards Japan...), how many Wikipedia language
  // editions cover the album, and the English article title for its ratings box.
  async function wikidataProfile(mbid) {
    const sparql = `
      SELECT ?item ?links ?award ?awardLabel ?nom ?nomLabel ?enwiki WHERE {
        ?item wdt:P436 "${mbid.replace(/[^0-9a-f-]/gi, "")}" ; wikibase:sitelinks ?links .
        OPTIONAL { ?item wdt:P166 ?award . }
        OPTIONAL { ?item wdt:P1411 ?nom . }
        OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ko,ja". }
      }`;
    const data = await getJson(
      `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
      { source: "wikidata", headers: { Accept: "application/sparql-results+json" } }
    );
    const rows = data?.results?.bindings || [];
    if (!rows.length) return null;

    // A release group can map to several items (an album and its reissue);
    // keep the one covered by the most Wikipedia editions.
    const byItem = new Map();
    for (const row of rows) {
      if (!row.item?.value) continue;
      const id = row.item.value;
      const entry = byItem.get(id) || { links: Number(row.links?.value) || 0, awards: new Map(), nominations: new Map(), enwiki: "" };
      if (row.award?.value && row.awardLabel?.value) entry.awards.set(row.award.value, row.awardLabel.value);
      if (row.nom?.value && row.nomLabel?.value) entry.nominations.set(row.nom.value, row.nomLabel.value);
      if (row.enwiki?.value) entry.enwiki = decodeURIComponent(row.enwiki.value.split("/wiki/")[1] || "").replace(/_/g, " ");
      byItem.set(id, entry);
    }
    const best = [...byItem.values()].sort((a, b) => b.links - a.links)[0];
    if (!best) return null;
    const labels = (map) => [...map.values()].filter((label) => !/^Q\d+$/.test(label));
    const awards = labels(best.awards);
    return {
      sitelinks: best.links,
      // Sales certifications (gold, platinum) measure popularity, not acclaim.
      awards: awards.filter((label) => !isCertification(label)),
      certifications: awards.filter(isCertification),
      nominations: labels(best.nominations),
      enwiki: best.enwiki
    };
  }

  async function wikipediaCritics(title) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("prop", "revisions");
    url.searchParams.set("rvprop", "content");
    url.searchParams.set("rvslots", "main");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("titles", title);
    const data = await getJson(url.toString(), { source: "wikipedia" });
    const content = data?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || "";
    return parseWikipediaRatings(content);
  }

  async function listenbrainz(mbid) {
    const data = await getJson("https://api.listenbrainz.org/1/popularity/release-group", {
      source: "listenbrainz",
      method: "POST",
      body: JSON.stringify({ release_group_mbids: [mbid] })
    });
    const entry = Array.isArray(data) ? data.find((item) => item.release_group_mbid === mbid) : null;
    if (!entry || !Number.isFinite(entry.total_user_count)) return null;
    return { listens: entry.total_listen_count || 0, users: entry.total_user_count || 0 };
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
    const failedOptional = [];

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

      const attempt = async (name, task) => {
        try {
          return await task();
        } catch (error) {
          errors.push(error);
          failedOptional.push(name);
          return null;
        }
      };

      record.critics = (await attempt("wikidata", () => wikidataCritics(mb.mbid))) || [];
      if (record.critics.length) record.sources.push("wikidata");

      const profile = await attempt("wikidata", () => wikidataProfile(mb.mbid));
      if (profile) {
        record.recognition = {
          sitelinks: profile.sitelinks,
          awards: profile.awards,
          nominations: profile.nominations,
          certifications: profile.certifications
        };
        if (profile.enwiki) {
          record.wikipedia = { title: profile.enwiki };
          const reviews = await attempt("wikipedia", () => wikipediaCritics(profile.enwiki));
          if (reviews?.length) {
            record.critics = mergeCritics(record.critics, reviews);
            record.sources.push("wikipedia");
          }
        }
      }

      const listens = await attempt("listenbrainz", () => listenbrainz(mb.mbid));
      if (listens) {
        record.listenbrainz = listens;
        record.sources.push("listenbrainz");
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

    // "partial" means an optional source failed (for example a blocked host),
    // so the album is retried sooner instead of being cached for a month.
    if (record.sources.length) {
      return { status: "ok", partial: failedOptional.length > 0, record, error: failedOptional.length ? errors.map((error) => error.message).join("; ") : undefined };
    }
    if (errors.length) return { status: "error", record, error: errors.map((error) => error.message).join("; ") };
    return { status: "not_found", record };
  }

  return { collect, enabled: { discogs: Boolean(discogsToken), lastfm: Boolean(lastfmKey) } };
}

function isCertification(label) {
  return /\b(gold|platinum|diamond|certification|certified)\b/i.test(label);
}

// Wikidata and Wikipedia often list the same outlet; keep one score per outlet.
function mergeCritics(primary, secondary) {
  const seen = new Set(primary.map((review) => review.source));
  return [...primary, ...secondary.filter((review) => !seen.has(review.source))];
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
