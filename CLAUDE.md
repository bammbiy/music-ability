# CLAUDE.md

Guidance for Claude (and humans) working in this repository. Read this first, then `HISTORY.md` for what has been done and why.

## Project overview

Music Ability analyzes a listener's music taste from Spotify / Apple Music listening data and turns it into an explainable "music ability" score: genre spread, listening depth, discovery, new-release sense, and how well-regarded the albums they play are (critics, awards, community ratings). The score describes listening habits, not musical skill.

- Stack: Node.js built-ins only (no dependencies, no build step), `node:sqlite`, vanilla HTML/CSS/JS.
- Requires Node 24+ (Node 22 works with an experimental SQLite warning).
- User-facing language: Korean (해요체).

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Run the server on `PORT` (default 3003). Demo: `/dashboard.html?demo=1` |
| `npm run check` | Syntax check of server and browser entry files |
| `npm test` | All unit tests plus the end-to-end login flow test (`node --test`) |
| `npm run probe -- "<artist>" "<album>"` | Collect one album from the live APIs and print every source's result, bypassing the cache |

Config lives in `.env` (see `.env.example`). Never commit `.env` or `data/`.

## Architecture

```
server/
  app.js            HTTP server, routing, security headers, sessions, Spotify OAuth, Apple Music, media feed, rating/consent APIs
  analysis.js       Pure analysis engine: buildAnalysis(), SCORE_WEIGHTS, acclaim metrics, listened albums
  store.js          node:sqlite: users (consent), snapshots, feedback, album_scores cache, album_ratings
  demo.js           Demo dataset
  acclaim/
    index.js        Acclaim service: cache lookup, background collection queue, per-outlet calibration, community ratings
    sources.js      Fetchers: MusicBrainz, Wikidata, English Wikipedia, ListenBrainz, Discogs, Last.fm
    match.js        Pure title/artist matching (ordinals, aliases, scripts, edition notes)
    wikipedia.js    Pure parser for the Wikipedia "Music ratings" box
    score.js        Pure score parsing, normalization, calibration, evidence model (combineEvidence)
    sample-albums.json  Clearly labeled sample data for demo mode
public/             index.html + js/home.js (landing), dashboard.html + js/app.js (dashboard), css/, fonts/ (self-hosted Pretendard)
tests/              node --test; external APIs are mocked; flow.test.js runs the real server against a fake Spotify
scripts/            probe-acclaim.mjs
```

Data flow: provider listening data → normalized dataset → `acclaim.lookup()` (cache + community ratings, misses queued for background collection) → `buildAnalysis()` → dashboard. The dashboard polls `/api/analysis?cached=1` while albums are being collected.

## How work is done (workflow)

Follow these steps for every task. Small, verified, documented increments beat big drops.

1. **Understand.** Read the relevant code and `HISTORY.md`. Restate the goal and constraints. If the request is ambiguous or touches a principle below (legality of a data source, privacy, scoring fairness), ask before building.
2. **Plan.** For anything beyond a small fix, outline the approach and the files involved. Prefer extending existing modules over new layers. Keep pure logic (parsing, matching, scoring) separate from I/O so it can be unit-tested.
3. **Implement in small steps.** One concern per change. Match the surrounding style and comment density. Do not add dependencies without asking.
4. **Verify.**
   - Run `npm run check` and `npm test`. Add or update tests for every behavior change; reproduce a bug in a test before fixing it.
   - For UI or server changes, start the app and check it in a browser (desktop and ~390px mobile width, no horizontal scroll, no console errors).
   - For data-source changes, run `npm run probe` against real albums (Korean, Japanese and Western) when the network allows it. Mocks alone have hidden real-data problems before.
5. **Commit and push** (see Git workflow).
6. **Record.** Add an entry to `HISTORY.md` for any meaningful change: what, why, result, and what remains. Update `README.md` when behavior, config or APIs change.
7. **Report.** Tell the user what changed, how it was verified, and what was not verified, plainly.

### Definition of done

- Check and tests pass; new behavior has tests.
- Verified in the running app (UI/server) or against live data (sources), or the gap is stated.
- README / CLAUDE.md / HISTORY.md updated where relevant.
- Committed with a descriptive message and pushed to `main`.

## Git workflow

- Commit and push directly to `main`. Do not open pull requests or use feature branches unless asked.
- Every commit message briefly states what was updated:
  - First line: one-line summary of the change.
  - Body: a short bullet list of what changed.
- Before pushing, run `npm run check` and `npm test`, and, for UI or server changes, start the app and confirm it works (demo mode: `/dashboard.html?demo=1`).

## Conventions and principles

Security and privacy
- Escape every API-derived value before inserting it into HTML (`escapeHtml`, `safeHttpUrl`, `clampPercent` in `public/js/app.js`).
- Never store OAuth tokens, emails, display names, or raw listening lists. Only save data after the user consents, and key it by the HMAC user ID (`hashProviderAccount`).
- Server errors return generic codes (`HttpError`). Do not leak upstream error details to the client.
- New external `fetch` calls need `AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS)`.
- POST endpoints rely on the same-origin check and rate limits in `app.js`; keep new endpoints behind them.

Data sources
- Music data comes only from official APIs or open data. Never scrape sites whose terms forbid automated access (RateYourMusic, Metacritic, AOTY, Pitchfork, community sites, webzines). Their scores enter only through what Wikidata / Wikipedia publish.
- Send a User-Agent with contact info (`ACCLAIM_CONTACT`) and respect per-host request spacing (`HOST_INTERVAL_MS` in `sources.js`).

Scoring fairness
- Popularity or attention alone must never produce a quality score; it only nudges an estimate backed by critics, awards or ratings (`combineEvidence`).
- A user's own album ratings must never count toward their own analysis (`excludeUserId` in the acclaim lookup); ratings only come from consented users and only for albums in their current listening data.
- Thin evidence must weigh less (confidence-scaled weights); never inflate a score to hide missing data. Show credibility to the user instead.
- Demo/sample data must be labeled as sample in the UI and never attributed to real outlets.

UI
- User-facing text is Korean (해요체), plain and specific; errors say what happened and what to do next.
- Keep the mixing-console design system (tokens on `:root` in `styles.css`); no new external scripts or fonts (CSP allows only self and Apple MusicKit).

## Environment notes

- Network hosts needed for acclaim collection: `musicbrainz.org`, `query.wikidata.org`, `en.wikipedia.org`, `api.listenbrainz.org` (optional: `api.discogs.com`, `ws.audioscrobbler.com`).
- In the Claude Code cloud sandbox, Node's built-in `fetch` only uses the egress proxy with `NODE_USE_ENV_PROXY=1` (Node 22.21+). curl works without it.
- Integration tests point Spotify at a fake server through `SPOTIFY_ACCOUNTS_URL` / `SPOTIFY_API_URL`; `DATABASE_PATH` selects the SQLite file.
