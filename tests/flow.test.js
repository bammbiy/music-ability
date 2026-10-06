// End-to-end test of the real server against a local fake Spotify:
// login -> analysis -> consent -> album ratings -> logout/login -> disconnect.
// Acclaim collection is turned off so no external network is used.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// ---- Fake Spotify -------------------------------------------------------

const fake = { refreshes: 0, tokenRequests: 0 };

const artists = [
  { id: "ar1", name: "Radiohead", genres: ["alternative rock", "art rock"], popularity: 80, images: [] },
  { id: "ar2", name: "IU", genres: ["k-pop", "korean ballad"], popularity: 78, images: [] },
  { id: "ar3", name: "Hyukoh", genres: ["korean indie"], popularity: 55, images: [] }
];
const track = (id, name, artist, album, date, popularity) => ({
  id, name, popularity, duration_ms: 200000,
  artists: [{ id: artist.id, name: artist.name }],
  album: { name: album, release_date: date, images: [] }
});
const tracks = [
  track("t1", "Paranoid Android", artists[0], "OK Computer", "1997-05-21", 75),
  track("t2", "Palette", artists[1], "Palette", "2017-04-21", 70),
  track("t3", "Wi Ing Wi Ing", artists[2], "22", "2014-09-18", 50),
  track("t4", "Karma Police", artists[0], "OK Computer", "1997-05-21", 74)
];

function startFakeSpotify() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    const send = (body, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let body = "";
    for await (const chunk of req) body += chunk;

    if (url.pathname === "/api/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token") {
        fake.refreshes += 1;
        return send({ access_token: `${form.get("refresh_token")}-refreshed`, expires_in: 3600 });
      }
      fake.tokenRequests += 1;
      // The code names the user; "short" codes get tokens that are about to expire.
      const code = form.get("code");
      return send({ access_token: `token-${code}`, refresh_token: `refresh-${code}`, expires_in: code.startsWith("short") ? 30 : 3600 });
    }

    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer token-") && !auth.startsWith("Bearer refresh-")) return send({ error: "unauthorized" }, 401);
    const user = auth.replace(/^Bearer (token|refresh)-/, "").replace(/-refreshed$/, "").replace(/^short-/, "");

    if (url.pathname === "/v1/me") return send({ id: user, display_name: user, email: `${user}@example.com` });
    if (url.pathname === "/v1/me/top/artists") return send({ items: artists });
    if (url.pathname === "/v1/me/top/tracks") return send({ items: tracks });
    if (url.pathname === "/v1/me/player/recently-played") return send({ items: [] });
    if (url.pathname === "/v1/artists") return send({ artists });
    return send({ error: "not_found" }, 404);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---- App under test -----------------------------------------------------

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const dir = mkdtempSync(join(tmpdir(), "music-ability-flow-"));
let spotify;
let app;
let base;

test.before(async () => {
  spotify = await startFakeSpotify();
  const spotifyUrl = `http://127.0.0.1:${spotify.address().port}`;
  const port = await freePort();
  base = `http://localhost:${port}`;
  app = spawn(process.execPath, ["server/app.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      SPOTIFY_CLIENT_ID: "client",
      SPOTIFY_CLIENT_SECRET: "secret",
      SPOTIFY_REDIRECT_URI: `${base}/callback`,
      SPOTIFY_ACCOUNTS_URL: spotifyUrl,
      SPOTIFY_API_URL: spotifyUrl,
      SESSION_SECRET: "x".repeat(40),
      DATABASE_PATH: join(dir, "flow.sqlite"),
      ACCLAIM_ENABLED: "0",
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  app.stdout.on("data", (chunk) => { output += chunk; });
  app.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/status`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`app did not start:\n${output}`);
});

test.after(async () => {
  app?.kill();
  await new Promise((resolve) => spotify?.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

// A tiny browser: one cookie, Origin on POSTs, no automatic redirects.
function browser() {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
    async request(path, { method = "GET", json } = {}) {
      const response = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method === "POST" ? { Origin: base } : {}),
          ...(json !== undefined ? { "Content-Type": "application/json" } : {})
        },
        body: json !== undefined ? JSON.stringify(json) : undefined
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const type = response.headers.get("content-type") || "";
      const data = type.includes("json") ? await response.json() : await response.text();
      return { status: response.status, location: response.headers.get("location"), data };
    },
    async login(code) {
      const start = await this.request("/login");
      assert.equal(start.status, 302);
      const state = new URL(start.location).searchParams.get("state");
      assert.ok(state, "login redirects to Spotify with a state value");
      const preLoginCookie = cookie;
      const callback = await this.request(`/callback?code=${code}&state=${state}`);
      assert.equal(callback.location, "/dashboard.html");
      assert.notEqual(cookie, preLoginCookie, "session id is rotated after login");
      return preLoginCookie;
    }
  };
}

test("full flow: login, analysis, consent, ratings, re-login, disconnect", async () => {
  const alice = browser();
  const preLoginCookie = await alice.login("alice");

  // The pre-login cookie no longer grants access (session fixation).
  const stale = browser();
  stale.cookie = preLoginCookie;
  assert.equal((await stale.request("/api/me")).data.authenticated, false);

  const me = await alice.request("/api/me");
  assert.equal(me.data.authenticated, true);
  assert.equal(me.data.profile.email, undefined, "email is not exposed");

  let analysis = (await alice.request("/api/analysis")).data;
  assert.equal(analysis.source, "spotify");
  assert.ok(analysis.score > 0);
  assert.equal(analysis.acclaim.status, "unavailable");
  assert.deepEqual(analysis.listenedAlbums.map((album) => album.album), ["OK Computer", "Palette", "22"]);
  assert.equal(analysis.ratingsEnabled, false);

  const okKey = analysis.listenedAlbums[0].key;
  assert.equal((await alice.request("/api/ratings", { method: "POST", json: { key: okKey, rating: 9 } })).status, 403);

  assert.equal((await alice.request("/api/consent", { method: "POST" })).status, 200);
  analysis = (await alice.request("/api/analysis?cached=1")).data;
  assert.equal(analysis.ratingsEnabled, true);

  assert.equal((await alice.request("/api/ratings", { method: "POST", json: { key: okKey, rating: 9 } })).status, 200);
  assert.equal((await alice.request("/api/ratings", { method: "POST", json: { key: okKey, rating: 11 } })).status, 400);
  assert.equal((await alice.request("/api/ratings", { method: "POST", json: { key: "someone::else", rating: 5 } })).status, 400);

  analysis = (await alice.request("/api/analysis?cached=1")).data;
  const ok = analysis.listenedAlbums.find((album) => album.key === okKey);
  assert.equal(ok.myRating, 9);
  assert.equal(ok.communityVotes, 0, "alice's own rating does not count for alice");

  // Bob rates the same album; each sees only the other's vote.
  const bob = browser();
  await bob.login("bob");
  await bob.request("/api/analysis");
  await bob.request("/api/consent", { method: "POST" });
  assert.equal((await bob.request("/api/ratings", { method: "POST", json: { key: okKey, rating: 7 } })).status, 200);
  const bobView = (await bob.request("/api/analysis?cached=1")).data.listenedAlbums.find((album) => album.key === okKey);
  assert.deepEqual([bobView.communityVotes, bobView.communityAverage], [1, 9]);
  const aliceView = (await alice.request("/api/analysis?cached=1")).data.listenedAlbums.find((album) => album.key === okKey);
  assert.deepEqual([aliceView.communityVotes, aliceView.communityAverage], [1, 7]);

  // Logging in again keeps the earlier consent and the earlier rating.
  const aliceAgain = browser();
  await aliceAgain.login("alice");
  analysis = (await aliceAgain.request("/api/analysis")).data;
  assert.equal(analysis.ratingsEnabled, true);
  assert.equal(analysis.listenedAlbums.find((album) => album.key === okKey).myRating, 9);

  // Disconnecting deletes alice's data, including her rating.
  const disconnect = await aliceAgain.request("/api/account/disconnect", { method: "POST" });
  assert.equal(disconnect.data.deleted, true);
  const afterDisconnect = (await bob.request("/api/analysis?cached=1")).data.listenedAlbums.find((album) => album.key === okKey);
  assert.equal(afterDisconnect.communityVotes, 0);

  const aliceReturns = browser();
  await aliceReturns.login("alice");
  assert.equal((await aliceReturns.request("/api/analysis")).data.ratingsEnabled, false, "consent is gone after disconnect");
});

test("expiring Spotify tokens are refreshed", async () => {
  const carol = browser();
  await carol.login("short-carol");
  const before = fake.refreshes;
  const analysis = await carol.request("/api/analysis");
  assert.equal(analysis.status, 200);
  assert.ok(fake.refreshes > before);
});

test("requests from other sites and bad callbacks are rejected", async () => {
  const response = await fetch(`${base}/api/consent`, { method: "POST", headers: { Origin: "https://evil.example" } });
  assert.equal(response.status, 403);

  const mallory = browser();
  await mallory.request("/login");
  const forged = await mallory.request("/callback?code=mallory&state=forged");
  assert.equal(forged.location, "/?auth=failed");
});
