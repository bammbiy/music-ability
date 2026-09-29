# CLAUDE.md

## Git workflow

- Commit and push directly to `main`. Do not open pull requests or use feature branches unless asked.
- Every commit message briefly states what was updated:
  - First line: one-line summary of the change.
  - Body: a short bullet list of what changed.
- Before pushing, run `npm run check` and `npm test`, and, for UI or server changes, start the app and confirm it works (demo mode: `/dashboard.html?demo=1`).

## Project

Music Ability analyzes a user's music taste (genre spread, depth, discovery) from Spotify / Apple Music listening data. No dependencies and no build step: Node built-ins plus vanilla HTML/CSS/JS.

- `server/app.js`: HTTP server, routing, Spotify OAuth, Apple Music, media feed.
- `server/analysis.js`: pure analysis engine (`buildAnalysis`), metric weights (`SCORE_WEIGHTS`).
- `server/acclaim/`: album critic/listener scores. `score.js` (pure parsing, normalization, calibration), `match.js` (pure title/artist matching), `sources.js` (MusicBrainz, Wikidata, Discogs, Last.fm fetchers), `index.js` (cache + background queue).
- `tests/`: `node --test` unit tests; external APIs are mocked.
- `server/store.js`: `node:sqlite` storage for consented quality data and the public album score cache (`data/music-ability.sqlite`, git-ignored).
- `public/`: landing page (`index.html`, `js/home.js`) and dashboard (`dashboard.html`, `js/app.js`).
- Requires Node 24+. Run with `npm start` (default port 3003). Config lives in `.env` (see `.env.example`).

## Conventions

- User-facing text is Korean.
- Escape every API-derived value before inserting it into HTML (`escapeHtml`, `safeHttpUrl`, `clampPercent` in `public/js/app.js`).
- Never store OAuth tokens, emails, display names, or raw listening lists. Only save data after the user consents, and key it by the HMAC user ID (`hashProviderAccount`).
- Server errors return generic codes (`HttpError`). Do not leak upstream error details to the client.
- New external `fetch` calls need `AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS)`.
- Music data comes only from official APIs or open data. Never scrape sites whose terms forbid automated access (RateYourMusic, Metacritic, AOTY, etc.).
