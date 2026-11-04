# Music Ability

[한국어](README.md) | English | [日本語](README.ja.md) | [中文](README.zh.md)

A web app that analyzes your music taste from your Spotify and Apple Music listening history. It combines how broadly you listen across genres, how deeply you listen, how often you seek out new artists, and how critics and listeners rate the albums you play, and shows the result as an explainable "Music Ability" score.

The score describes your listening habits, not your musical skill or how good your taste is.

It is not a public service yet and is still under development. Deployment materials are ready ([Deployment guide (Korean)](docs/DEPLOY.md)).

## Features

- Spotify login (OAuth) and Apple Music login (MusicKit on the Web)
- Demo mode that works without logging in
- Genre shares and sub-genres, plus top artists and tracks
- Seven Music Ability metrics: genre diversity, listening depth, discovery, taste expansion, new release sensitivity, critical sense, hidden gem discovery
- Per-album critic scores, awards, listener ratings, and evidence confidence
- Album ratings (out of 10) from users who agreed to participate
- Feedback on whether the analysis fits and whether the score feels right

## Running

Node.js 24 or later is required. There are no dependencies to install and no build step.

```bash
npm start
```

Open `http://localhost:3003` in a browser. Even without Spotify keys, you can see the demo at `http://localhost:3003/dashboard.html?demo=1`.

| Command | What it does |
| --- | --- |
| `npm start` | Start the server |
| `npm run check` | Syntax check for server and browser code |
| `npm test` | Unit tests and the full login flow test |
| `npm run probe -- "Frank Ocean" "Blonde"` | Fetch one album from the real APIs and print the result per source (cache not used) |
| `npm run learn-weights` | Print recommended weights from score feedback (needs at least 50 answers) |
| `npm run backup` | Copy the SQLite database to `data/backups` |

## Configuration

Copy `.env.example` to create `.env` in the project root. Do not commit `.env` to Git.

```dotenv
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3003/callback
SESSION_SECRET=use_a_long_random_value
PORT=3003
APPLE_MUSICKIT_DEVELOPER_TOKEN=
ACCLAIM_CONTACT=
```

### Spotify

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Register `http://localhost:3003/callback` as a Redirect URI.
3. Put the Client ID and Secret in `.env` and restart the server.

Apps in development mode can only be used to log in by users registered in the dashboard. Check Spotify's policy for the user limit and the conditions for full approval.

### Apple Music

Issue a MusicKit developer token from your Apple Developer account and put it in `APPLE_MUSICKIT_DEVELOPER_TOKEN`. Once a user approves the login, recently played songs are fetched with the Music User Token. The user token is not stored.

MusicKit JS needs to use the developer token in the browser, so it is exposed through `/api/status`. Issue it with a short expiry and include the `origin` claim.

### YouTube Music

The YouTube Data API does not provide personal YouTube Music listening history. For now it is shown as coming soon, and unofficial scraping is not used.

### Music news feed

If you set `YOUTUBE_API_KEY`, official YouTube search results are shown. If you put RSS/Atom URLs separated by commas in `NEWS_RSS_URLS` and `SOCIAL_FEED_URLS`, articles and official social feeds are added. The endpoint is `GET /api/media?q=search term`.

## Critic and listener ratings

Ratings are collected for each album you listen to often and are reflected in the score. Only official APIs and public data are used. Sites whose terms of service forbid automated collection (RateYourMusic, Metacritic, AOTY, Pitchfork, communities, webzines) are not collected. Scores from these outlets are included only to the extent they are publicly compiled in Wikidata and Wikipedia.

| Source | Values fetched | Setup |
| --- | --- | --- |
| MusicBrainz | Album identification, release date, community rating | Default, `ACCLAIM_CONTACT` recommended |
| Wikidata | Review scores by outlet, awards and nominations, number of Wikipedia languages | Default |
| English Wikipedia | Ratings table in the album article (Music ratings) | Default (CC BY-SA) |
| ListenBrainz | Listener count | Default |
| Discogs | Community rating, number of owners | `DISCOGS_TOKEN` |
| Last.fm | Listener count, play count | `LASTFM_API_KEY` |

The network domains needed for collection are `musicbrainz.org`, `query.wikidata.org`, `en.wikipedia.org`, and `api.listenbrainz.org`. If you use Discogs and Last.fm, `api.discogs.com` and `ws.audioscrobbler.com` are also needed.

### Confidence calculation

For each album, the evidence is combined into one rating score and an evidence confidence (`combineEvidence` in `server/acclaim/score.js`).

| Evidence | Role | Weight |
| --- | --- | --- |
| Critic scores | Quality evidence | 1.0 for one outlet, plus 0.4 for each additional outlet (max 3) |
| Listener ratings | Quality evidence | Proportional to vote count (0.75 at 20 votes, max 1.5) |
| Awards, nominations | Quality evidence | 0.75 per award (max 1.5), 0.3 per nomination (max 0.8) |
| Number of Wikipedia languages | Prominence aid | 0.25 |
| Popularity | Prominence aid | 0.15 |

- Albums that only have popularity or prominence get no rating score.
- Sales certifications (gold, platinum) are not counted as awards.
- Confidence is weight sum / (weight sum + 1.5). If the overall confidence is below 60%, the share of the critic metric in the score is reduced by the same proportion.
- If albums with critic scores make up less than 30% of listening or number fewer than 3, the critic metric is dropped and the score is calculated from the other metrics.
- As cached albums accumulate, the app learns how generously each outlet tends to score and adjusts the baseline. Once more than 30 users participate, it also shows what top percent you are in.

### Album matching

Streaming services and MusicBrainz often write the same album differently. If an exact search fails, the app looks up the artist including aliases (Fujii Kaze and 藤井風) and compares titles only within that artist's release list. It treats "1st Album" and "1집", accents (Fantôme), Chinese character subtitles (LOVE YOURSELF 轉 'Tear'), edition labels, "Pt. 1" and "Part 1", and titles in other languages ("화양연화 pt.1" and "The Most Beautiful Moment in Life, Pt.1") as the same album. If there are two or more similar candidates, it does not match, to avoid linking the wrong one.

Collection runs in a background queue on the server and keeps a request interval for each API. Results are cached for 30 days for albums found, 7 days for albums not found, and 1 hour for connection failures. Check the status with `GET /api/acclaim/status`.

Critic scores in demo mode are sample values for the screen, not real outlet scores.

## User data

Saving analysis results, feedback, and album ratings happens only when the user agrees to participate on the dashboard. Email, name, OAuth tokens, and the raw listening list are not stored.

- `POST /api/consent`: agree to participate
- `POST /api/feedback`: `{ targetType, targetId, rating }`. `analysis` is how well it matches your taste (1 to 5), `score` is how the score feels (1 too low, 3 about right, 5 too high), and it is stored together with the analysis result that was rated.
- `POST /api/ratings`: album rating `{ key, rating }` (1 to 10, `null` deletes it)
- `POST /api/account/disconnect`: disconnect and delete stored data

### Album ratings

- Your ratings do not affect your own score. They are used only in other people's analyses.
- You can rate only albums in the listening history you just analyzed, one vote per album.
- Ratings are reflected in proportion to the number of votes, so a few ratings cannot change the result much.
- Albums with few public ratings (for example, Korean indie) appear near the top of the list with a "공개 평가 적음" (few public ratings) label.
- Your consent to participate is kept even if you log in again. Apple Music has no fixed account ID, so each browser is identified by a signed random ID cookie (`ma_apple`). If you clear the cookie or use another browser, you start as a new user.

### Score weight learning

The app converts "점수는 어떻게 느껴지나요?" ("How does the score feel to you?") answers into the score the user would have wanted (8 points per step) and adjusts the weight of each metric. `npm run learn-weights` only prints recommended values. To apply them to the actual score, a person has to review them and edit `SCORE_WEIGHTS` in `server/analysis.js`. Recommended values move only within ±30% of the defaults.

The database is created at `data/music-ability.sqlite` (or `DATABASE_PATH`) and is not included in Git.

## Security

- Session cookies are HMAC signed, `HttpOnly`, and `SameSite=Lax`, and get `Secure` on HTTPS. A new session ID is issued on login.
- `SESSION_SECRET` must be a random value of at least 32 characters, and the server will not start without it when `NODE_ENV=production`.
- The stored user ID is an HMAC value made with `USER_HASH_SECRET` (or `SESSION_SECRET` if it is not set). Changing this key breaks the link to existing data.
- Security headers such as CSP, `X-Frame-Options`, and `nosniff` are added to every response, and POST requests are accepted only from the same origin.
- Login, POST APIs, and `/api/media` have per-IP rate limits.
- The Spotify access token is refreshed automatically before it expires.

## Deployment

A `Dockerfile`, a health check endpoint (`GET /healthz`), shutdown signal handling, and a database backup script are ready. One server and a disk (volume) that keeps its data are enough. The detailed steps are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Tech

- Node.js built-in HTTP server and SQLite (`node:sqlite`), no external dependencies
- Spotify Web API, Apple MusicKit on the Web
- MusicBrainz, Wikidata, Wikipedia, ListenBrainz, Discogs, Last.fm
- HTML, CSS, JavaScript (no build), with the Pretendard font included directly
- Tests use the built-in Node test runner. `tests/flow.test.js` connects the real server to fake Spotify and Apple Music and checks everything from login to disconnect.

## License

MIT. See [LICENSE](LICENSE).
