import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const publicDir = join(rootDir, "public");

loadEnv();

const PORT = Number(process.env.PORT || 3003);
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-session-secret";

const sessions = new Map();
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
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/status") {
      return sendJson(res, {
        spotifyConfigured: Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
        demoAvailable: true
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

    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendJson(res, { error: "server_error", message: error.message }, 500);
  }
});

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
  sessions.set(sessionId, { ...sessions.get(sessionId), state });

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

  if (!session || !code || !state || state !== session.state) {
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
  sessions.set(session.id, {
    ...session,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000
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
      email: profile.email,
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
    generatedAt: new Date().toISOString(),
    artists: [...artistById.values()],
    tracks: (topTracks.items || []).map((track) => normalizeTrack(track, artistById)),
    recentTracks: (recentTracks.items || []).map((item) => normalizeTrack(item.track, artistById))
  };

  return sendJson(res, buildAnalysis(dataset));
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
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Spotify API failed: ${response.status} ${detail}`);
  }

  return response.json();
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
  const diversity = Math.min(100, Math.round(genres.length * 7 + buckets.length * 9));
  const detailDepth = Math.min(100, Math.round(genres.filter((genre) => genre.name.includes(" ") || genre.name.includes("-")).length * 12));
  const discovery = Math.max(0, Math.min(100, 100 - mainstream + Math.round(diversity * 0.35)));
  const score = Math.round(diversity * 0.35 + detailDepth * 0.25 + discovery * 0.2 + (100 - Math.abs(60 - mainstream)) * 0.2);

  return {
    source: dataset.source,
    generatedAt: dataset.generatedAt,
    score,
    metrics: {
      diversity,
      detailDepth,
      discovery,
      mainstream
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
    summary: buildSummary(score, buckets, genres, mainstream),
    criticMatches: buildCriticMatches(genres, buckets)
  };
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

function buildSummary(score, buckets, genres, mainstream) {
  const mainBucket = buckets[0]?.name || "mixed music";
  const detail = genres[0]?.name || "genre exploration";
  const stance = mainstream >= 70 ? "대중적인 감각이 강하지만" : "탐색 성향이 꽤 살아 있고";
  return `지금 취향은 ${mainBucket} 중심이고, 세부적으로는 ${detail} 쪽 신호가 강해요. ${stance} 장르 폭과 세부 태그를 같이 보면 음악력 점수는 ${score}점입니다.`;
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

  const sessionId = randomBytes(24).toString("hex");
  const signature = signSession(sessionId);
  sessions.set(sessionId, { id: sessionId });
  res.setHeader("Set-Cookie", `ma_session=${sessionId}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
  return sessionId;
}

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)ma_session=([^;]+)/);
  if (!match) return null;
  const [sessionId, signature] = decodeURIComponent(match[1]).split(".");
  if (!sessionId || !signature || signSession(sessionId) !== signature) return null;
  return sessions.get(sessionId) || null;
}

function signSession(sessionId) {
  return createHash("sha256").update(`${sessionId}.${SESSION_SECRET}`).digest("hex").slice(0, 24);
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(publicDir, `.${safePath}`);
  if (!filePath.startsWith(publicDir)) {
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
