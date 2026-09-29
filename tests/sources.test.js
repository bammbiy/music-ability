import test from "node:test";
import assert from "node:assert/strict";
import { createSources } from "../server/acclaim/sources.js";

const MBID = "b1392450-e666-3926-a536-22c65f834433";

function mockFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, headers: options.headers || {} });
    const route = routes.find(([pattern]) => pattern.test(href));
    if (!route) return new Response("not found", { status: 404 });
    const [, body, status = 200] = route;
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const musicbrainzSearch = {
  "release-groups": [
    { id: "other", score: 100, title: "OK Computer OKNOTOK 1997 2017", "artist-credit": [{ name: "Radiohead" }] },
    { id: MBID, score: 100, title: "OK Computer", "first-release-date": "1997-05-21", "artist-credit": [{ name: "Radiohead" }] }
  ]
};
const musicbrainzDetail = { id: MBID, rating: { value: 4.65, "votes-count": 120 }, genres: [{ name: "alternative rock" }] };
const wd = (qid) => ({ value: `http://www.wikidata.org/entity/${qid}` });
const wikidata = {
  results: {
    bindings: [
      { raw: { value: "10" }, by: wd("Q721140"), byLabel: { value: "Pitchfork" } },
      { raw: { value: "5" }, by: wd("Q31181"), byLabel: { value: "AllMusic" } },
      { raw: { value: "A-" }, by: wd("Q1397563"), byLabel: { value: "Robert Christgau" } },
      { raw: { value: "94" }, by: wd("Q48989591"), byLabel: { value: "Album of the Year" } },
      { raw: { value: "8.2" }, by: wd("Q99999"), byLabel: { value: "Spin" } },
      { raw: { value: "9/10" }, by: wd("Q37312"), byLabel: { value: "IMDb" } },
      { raw: { value: "97%" }, by: wd("Q105584"), byLabel: { value: "Rotten Tomatoes" } },
      { raw: { value: "4/5" }, by: wd("Q12345"), byLabel: { value: "Q12345" } }
    ]
  }
};

test("collects identity, critic scores and ratings from open sources", { timeout: 20000 }, async () => {
  const mock = mockFetch([
    [/musicbrainz\.org\/ws\/2\/release-group\/\?/, musicbrainzSearch],
    [/musicbrainz\.org\/ws\/2\/release-group\/b1392450/, musicbrainzDetail],
    [/query\.wikidata\.org/, wikidata],
    [/api\.discogs\.com\/database\/search/, { results: [{ id: 21491, title: "Radiohead - OK Computer", community: { have: 90000, want: 30000 } }] }],
    [/api\.discogs\.com\/masters\/21491/, { main_release: 4950798 }],
    [/api\.discogs\.com\/releases\/4950798/, { community: { rating: { average: 4.6, count: 5000 } } }],
    [/ws\.audioscrobbler\.com/, { album: { listeners: "3000000", playcount: "150000000" } }]
  ]);
  try {
    const sources = createSources({ contact: "dev@example.com", discogsToken: "t", lastfmKey: "k" });
    const { status, record } = await sources.collect({ key: "radiohead::ok computer", artist: "Radiohead", album: "OK Computer" });

    assert.equal(status, "ok");
    assert.equal(record.mbid, MBID, "picks the exact title match, not the reissue");
    assert.equal(record.releaseDate, "1997-05-21");
    assert.equal(record.musicbrainz.rating, 93);
    // Film/game outlets and unknown reviewers are dropped; Spin's bare "8.2" has no known scale.
    assert.deepEqual(record.critics.map((review) => [review.source, review.score]), [["pitchfork", 100], ["allmusic", 100], ["robert christgau", 90], ["album of the year", 94]]);
    assert.equal(record.discogs.rating, 92);
    assert.equal(record.discogs.have, 90000);
    assert.equal(record.lastfm.listeners, 3000000);
    assert.deepEqual(record.sources, ["musicbrainz", "wikidata", "discogs", "lastfm"]);

    const mbCall = mock.calls.find((call) => call.url.includes("musicbrainz"));
    assert.match(mbCall.headers["User-Agent"], /MusicAbility\/0\.1 \( dev@example\.com \)/);
    const discogsCall = mock.calls.find((call) => call.url.includes("discogs"));
    assert.equal(discogsCall.headers.Authorization, "Discogs token=t");
  } finally {
    mock.restore();
  }
});

test("reports not_found when no source knows the album", { timeout: 20000 }, async () => {
  const mock = mockFetch([[/musicbrainz\.org/, { "release-groups": [] }]]);
  try {
    const { status } = await createSources().collect({ key: "x::y", artist: "Nobody", album: "Nothing" });
    assert.equal(status, "not_found");
  } finally {
    mock.restore();
  }
});

test("reports error when the network fails, so it is retried sooner", { timeout: 20000 }, async () => {
  const mock = mockFetch([[/musicbrainz\.org/, new TypeError("fetch failed")]]);
  try {
    const { status, error } = await createSources().collect({ key: "x::y", artist: "A", album: "B" });
    assert.equal(status, "error");
    assert.match(error, /musicbrainz/);
  } finally {
    mock.restore();
  }
});

test("falls back to artist aliases when the credit uses another script", { timeout: 20000 }, async () => {
  const mock = mockFetch([
    [/release-group\/\?.*arid/, { "release-groups": [{ id: "rg-kaze", score: 100, title: "LOVE ALL SERVE ALL", "first-release-date": "2022-03-23", "artist-credit": [{ name: "藤井風" }] }] }],
    [/musicbrainz\.org\/ws\/2\/release-group\/\?/, { "release-groups": [] }],
    [/musicbrainz\.org\/ws\/2\/artist\//, { artists: [{ id: "a-kaze", score: 100, name: "藤井風" }] }],
    [/musicbrainz\.org\/ws\/2\/release-group\/rg-kaze/, { rating: { value: 4.5, "votes-count": 3 } }],
    [/query\.wikidata\.org/, { results: { bindings: [] } }]
  ]);
  try {
    const { status, record } = await createSources().collect({ key: "fujii kaze::love all serve all", artist: "Fujii Kaze", album: "LOVE ALL SERVE ALL" });
    assert.equal(status, "ok");
    assert.equal(record.mbid, "rg-kaze");
    assert.equal(record.releaseDate, "2022-03-23");
  } finally {
    mock.restore();
  }
});

test("retries when MusicBrainz asks to slow down", { timeout: 20000 }, async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("musicbrainz")) {
      calls += 1;
      if (calls === 1) return new Response("slow down", { status: 503, headers: { "Retry-After": "1" } });
      return new Response(JSON.stringify({ "release-groups": [], artists: [] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  try {
    const { status } = await createSources().collect({ key: "a::b", artist: "A", album: "B" });
    assert.equal(status, "not_found");
    assert.ok(calls >= 2);
  } finally {
    globalThis.fetch = original;
  }
});
