import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deleteUserData, saveAnalysisSnapshot, saveConsent, saveFeedback } from "./store.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const publicDir = join(rootDir, "public");

loadEnv();

const PORT = Number(process.env.PORT || 3003);
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const APPLE_MUSICKIT_DEVELOPER_TOKEN = process.env.APPLE_MUSICKIT_DEVELOPER_TOKEN || "";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
const NEWS_RSS_URLS = parseList(process.env.NEWS_RSS_URLS);
const SOCIAL_FEED_URLS = parseList(process.env.SOCIAL_FEED_URLS);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = resolveSessionSecret();
const USER_HASH_SECRET = process.env.USER_HASH_SECRET || SESSION_SECRET;
const COOKIE_SECURE = IS_PRODUCTION || SPOTIFY_REDIRECT_URI.startsWith("https://");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_SESSION_TTL_MS = 15 * 60 * 1000;
const EXTERNAL_FETCH_TIMEOUT_MS = 8000;
const MEDIA_CACHE_TTL_MS = 5 * 60 * 1000;

const sessions = new Map();
const rateLimits = new Map();
const mediaCache = new Map();
const spotifyScopes = [
  "user-read-private",
  "user-read-email",
  "user-top-read",
  "user-read-recently-played",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read"
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' https://js-cdn.music.apple.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "connect-src 'self' https://*.apple.com",
    "frame-src https://*.apple.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups"
};

const server = http.createServer(async (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
  if (COOKIE_SECURE) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "POST" && !isSameOrigin(req)) {
      return sendJson(res, { error: "forbidden_origin" }, 403);
    }

    const limit = rateLimitFor(url.pathname, req.method);
    if (limit && !allowRequest(req, limit)) {
      res.setHeader("Retry-After", String(Math.ceil(limit.windowMs / 1000)));
      return sendJson(res, { error: "rate_limited" }, 429);
    }

    if (url.pathname === "/api/status") {
      return sendJson(res, {
        spotifyConfigured: Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
        appleConfigured: Boolean(APPLE_MUSICKIT_DEVELOPER_TOKEN),
        appleDeveloperToken: APPLE_MUSICKIT_DEVELOPER_TOKEN || null,
        demoAvailable: true,
        dataCollection: {
          enabled: true,
          consentRequired: true
        }
      });
    }

    if (url.pathname === "/login") {
      return handleLogin(req, res);
    }

    if (url.pathname === "/callback") {
      return handleCallback(req, res, url);
    }

    if (url.pathname === "/api/me") {
      return handleMe(req, res);
    }

    if (url.pathname === "/api/analysis") {
      return handleAnalysis(req, res, url);
    }

    if (url.pathname === "/api/apple/analysis" && req.method === "POST") {
      return handleAppleAnalysis(req, res);
    }

    if (url.pathname === "/api/media" && req.method === "GET") {
      return handleMedia(req, res, url);
    }

    if (url.pathname === "/api/consent" && req.method === "POST") {
      return handleConsent(req, res);
    }

    if (url.pathname === "/api/account/disconnect" && req.method === "POST") {
      return handleDisconnect(req, res);
    }

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      return handleFeedback(req, res);
    }

    return serveStatic(res, url.pathname);
  } catch (error) {
    if (error instanceof HttpError) {
      return sendJson(res, { error: error.code }, error.status);
    }
    console.error(error);
    return sendJson(res, { error: "server_error" }, 500);
  }
});

setInterval(sweepExpiredState, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Music Ability running at http://localhost:${PORT}`);
});

async function handleLogin(req, res) {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    redirect(res, "/?demo=1&missingSpotify=1");
    return;
  }

  const sessionId = getOrCreateSession(req, res);
  const state = randomBytes(16).toString("hex");
  sessions.get(sessionId).state = state;

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set("scope", spotifyScopes.join(" "));
  authUrl.searchParams.set("redirect_uri", SPOTIFY_REDIRECT_URI);
  authUrl.searchParams.set("state", state);

  redirect(res, authUrl.toString());
}

async function handleCallback(req, res, url) {
  const session = getSession(req);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const expectedState = session?.state;
  if (session) delete session.state;
  if (!session || !code || !state || !expectedState || !safeEqual(state, expectedState)) {
    redirect(res, "/?auth=failed");
    return;
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI
  });

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    headers: {
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!tokenResponse.ok) {
    redirect(res, "/?auth=token_failed");
    return;
  }

  const token = await tokenResponse.json();
  const profileResponse = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS)
  });
  const profile = profileResponse.ok ? await profileResponse.json() : null;
  const providerAccount = profile?.account_id || profile?.id;

  // Issue a fresh session id after login so a pre-login cookie cannot be reused (session fixation).
  sessions.delete(session.id);
  createSession(res, {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    userId: providerAccount ? hashProviderAccount("spotify", providerAccount) : null,
    provider: "spotify",
    analysisConsent: false
  });

  redirect(res, "/dashboard.html");
}

async function handleMe(req, res) {
  const session = getSession(req);
  if (!session?.accessToken) {
    return sendJson(res, { authenticated: false });
  }

  const profile = await spotifyGet(session, "https://api.spotify.com/v1/me");
  return sendJson(res, {
    authenticated: true,
    profile: {
      id: profile.id,
      displayName: profile.display_name,
      image: profile.images?.[0]?.url || null,
      country: profile.country
    }
  });
}

async function handleAnalysis(req, res, url) {
  const demo = url.searchParams.get("demo") === "1";
  const session = getSession(req);

  if (demo || !session?.accessToken) {
    return sendJson(res, buildAnalysis(demoDataset));
  }

  const [topArtists, topTracks, recentTracks] = await Promise.all([
    spotifyGet(session, "https://api.spotify.com/v1/me/top/artists?limit=30&time_range=medium_term"),
    spotifyGet(session, "https://api.spotify.com/v1/me/top/tracks?limit=30&time_range=medium_term"),
    spotifyGet(session, "https://api.spotify.com/v1/me/player/recently-played?limit=30")
  ]);

  const artistById = new Map();
  for (const artist of topArtists.items || []) {
    artistById.set(artist.id, normalizeArtist(artist));
  }

  for (const track of topTracks.items || []) {
    for (const artist of track.artists || []) {
      if (!artistById.has(artist.id)) {
        artistById.set(artist.id, normalizeArtist(artist));
      }
    }
  }

  const missingArtists = [...artistById.values()].filter((artist) => artist.genres.length === 0);
  await hydrateArtistGenres(session, artistById, missingArtists);

  const dataset = {
    source: "spotify",
    provider: "spotify",
    generatedAt: new Date().toISOString(),
    artists: [...artistById.values()],
    tracks: (topTracks.items || []).map((track) => normalizeTrack(track, artistById)),
    recentTracks: (recentTracks.items || []).map((item) => normalizeTrack(item.track, artistById))
  };

  const analysis = buildAnalysis(dataset);
  if (session.analysisConsent && session.userId) {
    saveAnalysisSnapshot({ userId: session.userId, provider: dataset.provider, analysis });
  }
  return sendJson(res, analysis);
}

async function handleAppleAnalysis(req, res) {
  if (!APPLE_MUSICKIT_DEVELOPER_TOKEN) {
    return sendJson(res, { error: "apple_not_configured" }, 503);
  }

  const payload = await readJson(req);
  const musicUserToken = String(payload.musicUserToken || "").trim();
  if (!musicUserToken || musicUserToken.length > 4096) {
    return sendJson(res, { error: "music_user_token_required" }, 400);
  }

  const response = await fetch("https://api.music.apple.com/v1/me/recent/played/tracks?limit=30", {
    signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${APPLE_MUSICKIT_DEVELOPER_TOKEN}`,
      "Music-User-Token": musicUserToken
    }
  });

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 401 : 502;
    return sendJson(res, { error: "apple_api_failed" }, status);
  }

  const appleData = await response.json();
  const dataset = normalizeAppleDataset(appleData);
  const analysis = buildAnalysis(dataset);
  const session = getOrCreateSession(req, res);
  const sessionData = sessions.get(session);
  const appleUserId = hashProviderAccount("apple", musicUserToken);
  if (sessionData.userId !== appleUserId) {
    // Consent is tied to one provider account; never carry it over to a different one.
    sessionData.userId = appleUserId;
    sessionData.analysisConsent = false;
  }
  sessionData.provider = "apple";

  if (sessionData.analysisConsent && sessionData.userId) {
    saveAnalysisSnapshot({ userId: sessionData.userId, provider: dataset.provider, analysis });
  }

  return sendJson(res, analysis);
}

async function handleMedia(req, res, url) {
  const query = (url.searchParams.get("q") || "new music").trim().slice(0, 120) || "new music";
  const cacheKey = query.toLowerCase();
  const cached = mediaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return sendJson(res, cached.payload);
  }

  const [youtube, news, social] = await Promise.all([
    fetchYouTubeMedia(query),
    fetchFeedMedia(NEWS_RSS_URLS, "article"),
    fetchFeedMedia(SOCIAL_FEED_URLS, "social")
  ]);

  const payload = {
    query,
    items: [...youtube, ...news, ...social].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)),
    configured: {
      youtube: Boolean(YOUTUBE_API_KEY),
      news: NEWS_RSS_URLS.length > 0,
      social: SOCIAL_FEED_URLS.length > 0
    }
  };
  if (mediaCache.size >= 500) mediaCache.delete(mediaCache.keys().next().value);
  mediaCache.set(cacheKey, { payload, expiresAt: Date.now() + MEDIA_CACHE_TTL_MS });
  return sendJson(res, payload);
}

async function fetchYouTubeMedia(query) {
  if (!YOUTUBE_API_KEY) return [];
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("type", "video");
  endpoint.searchParams.set("order", "date");
  endpoint.searchParams.set("maxResults", "6");
  endpoint.searchParams.set("relevanceLanguage", "ko");
  endpoint.searchParams.set("key", YOUTUBE_API_KEY);

  let payload;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS) });
    if (!response.ok) return [];
    payload = await response.json();
  } catch {
    return [];
  }
  return (payload.items || []).filter((item) => item.id?.videoId).map((item) => ({
    type: "video",
    source: "YouTube",
    title: item.snippet?.title || "YouTube video",
    description: stripMarkup(item.snippet?.description || ""),
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id.videoId)}`,
    image: safeHttpUrl(item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url),
    publishedAt: item.snippet?.publishedAt || null,
    author: item.snippet?.channelTitle || ""
  }));
}

async function fetchFeedMedia(urls, type) {
  const results = await Promise.all(urls.map(async (feedUrl) => {
    try {
      const response = await fetch(feedUrl, {
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml" },
        signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS)
      });
      if (!response.ok) return [];
      const xml = (await response.text()).slice(0, 2 * 1024 * 1024);
      return parseFeed(xml, feedUrl, type);
    } catch {
      return [];
    }
  }));
  return results.flat().slice(0, 20);
}

function parseFeed(xml, sourceUrl, type) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  const source = new URL(sourceUrl).hostname.replace(/^www\./, "");
  return blocks.slice(0, 10).map((block) => {
    const title = stripMarkup(decodeXml(extractTag(block, "title")));
    const description = stripMarkup(decodeXml(extractTag(block, "description") || extractTag(block, "summary")));
    const link = safeHttpUrl(decodeXml(extractTag(block, "link") || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || ""));
    const publishedAt = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated") || null;
    return { type, source, title, description, url: link, image: null, publishedAt, author: source };
  }).filter((item) => item.title && item.url);
}

function extractTag(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1]?.trim() || "";
}

function stripMarkup(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeAppleDataset(payload) {
  const tracks = (payload.data || [])
    .filter((resource) => resource.type === "songs")
    .map((resource) => {
      const attributes = resource.attributes || {};
      const artist = {
        id: attributes.artistName || "unknown",
        name: attributes.artistName || "Unknown artist",
        genres: attributes.genreNames || [],
        popularity: null,
        image: null
      };
      return {
        id: resource.id,
        name: attributes.name || "Unknown track",
        album: attributes.albumName || "",
        image: attributes.artwork?.url?.replace("{w}", "300").replace("{h}", "300") || null,
        popularity: null,
        releaseDate: attributes.releaseDate || "",
        durationMs: attributes.durationInMillis || 0,
        artists: [artist]
      };
    });

  const artists = new Map();
  for (const track of tracks) {
    for (const artist of track.artists) artists.set(artist.name, artist);
  }

  return {
    source: "apple",
    provider: "apple",
    generatedAt: new Date().toISOString(),
    artists: [...artists.values()],
    tracks,
    recentTracks: tracks
  };
}

function handleConsent(req, res) {
  const session = getSession(req);
  if (!session?.userId) return sendJson(res, { error: "not_authenticated" }, 401);

  session.analysisConsent = true;
  session.consentAt = new Date().toISOString();
  saveConsent({ userId: session.userId, provider: session.provider || "unknown", consentedAt: session.consentAt });
  return sendJson(res, { consented: true, consentAt: session.consentAt });
}

function handleDisconnect(req, res) {
  const session = getSession(req);
  if (session) {
    if (session.userId) deleteUserData(session.userId);
    sessions.delete(session.id);
  }
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  return sendJson(res, { disconnected: true, deleted: true });
}

async function handleFeedback(req, res) {
  const session = getSession(req);
  if (!session?.userId || !session.analysisConsent) {
    return sendJson(res, { error: "consent_required" }, 403);
  }

  const payload = await readJson(req);
  const targetType = String(payload.targetType || "").trim();
  const targetId = String(payload.targetId || "").trim();
  const rating = Number(payload.rating);
  const validTypes = new Set(["analysis", "genre", "track"]);

  if (!validTypes.has(targetType) || !targetId || targetId.length > 120 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return sendJson(res, { error: "invalid_feedback" }, 400);
  }

  saveFeedback({ userId: session.userId, targetType, targetId, rating });
  return sendJson(res, { saved: true });
}

async function hydrateArtistGenres(session, artistById, missingArtists) {
  const ids = missingArtists.map((artist) => artist.id).filter(Boolean);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (chunk.length === 0) continue;
    const data = await spotifyGet(session, `https://api.spotify.com/v1/artists?ids=${chunk.join(",")}`);
    for (const artist of data.artists || []) {
      artistById.set(artist.id, normalizeArtist(artist));
    }
  }
}

async function spotifyGet(session, endpoint) {
  await ensureFreshSpotifyToken(session);
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS)
  });

  if (response.status === 401) {
    throw new HttpError(401, "spotify_reauth_required");
  }
  if (!response.ok) {
    console.error(`Spotify API failed: ${response.status} ${endpoint}`);
    throw new HttpError(502, "spotify_api_failed");
  }

  return response.json();
}

async function ensureFreshSpotifyToken(session) {
  if (!session.expiresAt || session.expiresAt - 60 * 1000 > Date.now()) return;
  if (!session.refreshToken) throw new HttpError(401, "spotify_reauth_required");

  session.refreshing ||= (async () => {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
      headers: {
        Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken })
    });
    if (!response.ok) {
      delete session.accessToken;
      delete session.refreshToken;
      throw new HttpError(401, "spotify_reauth_required");
    }
    const token = await response.json();
    session.accessToken = token.access_token;
    session.expiresAt = Date.now() + token.expires_in * 1000;
    if (token.refresh_token) session.refreshToken = token.refresh_token;
  })().finally(() => {
    delete session.refreshing;
  });

  return session.refreshing;
}

function normalizeArtist(artist) {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres || [],
    popularity: artist.popularity ?? null,
    image: artist.images?.[0]?.url || null
  };
}

function normalizeTrack(track, artistById) {
  const artists = (track.artists || []).map((artist) => artistById.get(artist.id) || normalizeArtist(artist));
  return {
    id: track.id,
    name: track.name,
    album: track.album?.name || "",
    image: track.album?.images?.[0]?.url || null,
    popularity: track.popularity ?? null,
    releaseDate: track.album?.release_date || "",
    durationMs: track.duration_ms || 0,
    artists
  };
}

function buildAnalysis(dataset) {
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
  const score = Math.round(diversity * 0.3 + detailDepth * 0.25 + discovery * 0.25 + concentration * 0.2);

  return {
    source: dataset.source,
    generatedAt: dataset.generatedAt,
    score,
    metrics: {
      diversity,
      detailDepth,
      discovery,
      concentration,
      mainstream,
      label: scoreLabel(score)
    },
    buckets: withPercent(buckets).slice(0, 8),
    genres: withPercent(genres).slice(0, 12),
    topArtists,
    topTracks: tracks.slice(0, 8).map((track) => ({
      name: track.name,
      artist: track.artists?.map((artist) => artist.name).join(", ") || "",
      image: track.image,
      popularity: track.popularity
    })),
    summary: buildSummary(score, buckets, genres, mainstream, concentration),
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

function mapGenreBucket(genre) {
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

function buildSummary(score, buckets, genres, mainstream, concentration) {
  const mainBucket = buckets[0]?.name || "mixed music";
  const detail = genres[0]?.name || "genre exploration";
  const stance = concentration >= 70 ? "여러 아티스트를 폭넓게 찾아 듣는 편이에요." : "좋아하는 아티스트를 깊게 파고드는 편이에요.";
  return `${mainBucket} 채널이 가장 크고, 세부적으로는 ${detail} 취향이 두드러져요. ${stance} 점수 ${score}점은 음악 실력이 아니라 장르 다양성, 감상 깊이, 새 음악을 찾는 성향을 합친 값이에요.`;
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

function getOrCreateSession(req, res) {
  const existing = getSession(req);
  if (existing) return existing.id;
  return createSession(res).id;
}

function createSession(res, data = {}) {
  const sessionId = randomBytes(24).toString("hex");
  const now = Date.now();
  const session = { ...data, id: sessionId, createdAt: now, lastSeenAt: now };
  sessions.set(sessionId, session);
  res.setHeader("Set-Cookie", sessionCookie(`${sessionId}.${signSession(sessionId)}`, SESSION_TTL_MS / 1000));
  return session;
}

function sessionCookie(value, maxAgeSeconds) {
  return `ma_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${COOKIE_SECURE ? "; Secure" : ""}`;
}

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)ma_session=([^;]+)/);
  if (!match) return null;
  const [sessionId, signature] = match[1].split(".");
  if (!sessionId || !signature || !safeEqual(signSession(sessionId), signature)) return null;
  const session = sessions.get(sessionId);
  if (!session || isSessionExpired(session, Date.now())) return null;
  session.lastSeenAt = Date.now();
  return session;
}

function isSessionExpired(session, now) {
  const idleLimit = session.accessToken || session.userId ? SESSION_TTL_MS : PENDING_SESSION_TTL_MS;
  return now - session.lastSeenAt > idleLimit;
}

function sweepExpiredState() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (isSessionExpired(session, now)) sessions.delete(id);
  }
  for (const [key, entry] of rateLimits) {
    if (entry.resetAt <= now) rateLimits.delete(key);
  }
  for (const [key, entry] of mediaCache) {
    if (entry.expiresAt <= now) mediaCache.delete(key);
  }
}

function signSession(sessionId) {
  return createHmac("sha256", SESSION_SECRET).update(sessionId).digest("hex").slice(0, 32);
}

function hashProviderAccount(provider, accountId) {
  return `${provider}:${createHmac("sha256", USER_HASH_SECRET).update(`${provider}:${accountId}`).digest("hex").slice(0, 32)}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] !== "cross-site";
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function rateLimitFor(pathname, method) {
  if (pathname === "/api/media") return { key: "media", max: 30, windowMs: 60 * 1000 };
  if (pathname === "/login" || pathname === "/callback") return { key: "auth", max: 20, windowMs: 60 * 1000 };
  if (pathname.startsWith("/api/") && method === "POST") return { key: "post", max: 30, windowMs: 60 * 1000 };
  if (pathname === "/api/analysis") return { key: "analysis", max: 20, windowMs: 60 * 1000 };
  return null;
}

function allowRequest(req, { key, max, windowMs }) {
  const bucketKey = `${key}:${req.socket.remoteAddress || "unknown"}`;
  const now = Date.now();
  const entry = rateLimits.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    rateLimits.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

function resolveSessionSecret() {
  const configured = process.env.SESSION_SECRET || "";
  const placeholder = !configured || configured.startsWith("change_this") || configured === "use_a_long_random_value" || configured === "dev-session-secret";
  if (!placeholder && configured.length >= 32) return configured;
  if (IS_PRODUCTION) {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters in production.");
  }
  console.warn("SESSION_SECRET is missing or weak; using a random per-process secret (sessions reset on restart).");
  return randomBytes(32).toString("hex");
}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new HttpError(413, "request_too_large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function parseList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(publicDir, `.${safePath}`);
  if (!filePath.startsWith(publicDir + sep)) {
    return sendText(res, "Not found", 404);
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendText(res, "Not found", 404);
  }
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, text, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function loadEnv() {
  try {
    const envPath = join(rootDir, ".env");
    if (!existsSync(envPath)) return;
    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      process.env[key] ||= value;
    }
  } catch {
    // Running without .env is supported through demo mode.
  }
}

const demoDataset = {
  source: "demo",
  provider: "demo",
  generatedAt: new Date().toISOString(),
  artists: [
    { id: "newjeans", name: "NewJeans", genres: ["k-pop", "k-pop girl group"], popularity: 86 },
    { id: "fujii", name: "Fujii Kaze", genres: ["j-pop", "japanese r&b"], popularity: 74 },
    { id: "pinkpantheress", name: "PinkPantheress", genres: ["bedroom pop", "drum and bass", "uk pop"], popularity: 78 },
    { id: "wave", name: "wave to earth", genres: ["korean indie", "korean city pop"], popularity: 69 },
    { id: "kendrick", name: "Kendrick Lamar", genres: ["hip hop", "rap"], popularity: 91 }
  ],
  tracks: [
    { name: "Ditto", popularity: 83, image: null, artists: [{ name: "NewJeans", genres: ["k-pop", "k-pop girl group"] }] },
    { name: "Matsuri", popularity: 72, image: null, artists: [{ name: "Fujii Kaze", genres: ["j-pop", "japanese r&b"] }] },
    { name: "Pain", popularity: 75, image: null, artists: [{ name: "PinkPantheress", genres: ["bedroom pop", "drum and bass", "uk pop"] }] },
    { name: "bad", popularity: 68, image: null, artists: [{ name: "wave to earth", genres: ["korean indie", "korean city pop"] }] },
    { name: "N95", popularity: 82, image: null, artists: [{ name: "Kendrick Lamar", genres: ["hip hop", "rap"] }] }
  ],
  recentTracks: []
};
