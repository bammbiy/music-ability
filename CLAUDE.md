# CLAUDE.md

Music Ability: a web app that turns Spotify / Apple Music listening data into an explainable "music ability" score (genre spread, depth, discovery, new releases, how well-regarded the albums are). The score describes listening habits, not skill. Not a public service yet.

- Node.js built-ins only (no dependencies, no build), `node:sqlite`, vanilla HTML/CSS/JS. Node 24+ (Node 22 works with a SQLite warning).
- Talk to the user in Korean. User-facing UI text is Korean (해요체).
- This file is loaded on every turn: keep it short. Details live in the files below; read only the part you need.

## Doc map

| File | What | When to read |
| --- | --- | --- |
| `docs/RULES.md` | Full workflow, definition of done, security/privacy, data-source, scoring-fairness, UI rules, environment notes | Before work in that area (Grep the section) |
| `HISTORY.md` | Current state, open tasks, decisions, dated work log | Start of a task; append when done |
| `docs/DEPLOY.md` | Docker image, health check, backups, deploy steps | Deploy or server lifecycle work |
| `README.md` (+ `.en` `.ja` `.zh`) | User-facing docs in four languages | When behavior, config or APIs change (update all four) |

## Commands

`npm start` (demo: `/dashboard.html?demo=1`) · `npm run check` · `npm test` · `npm run probe -- "<artist>" "<album>"` (live APIs) · `npm run learn-weights` · `npm run backup`

## Code map

`server/app.js` HTTP, sessions, OAuth, APIs · `server/analysis.js` pure scoring (`SCORE_WEIGHTS`) · `server/learning.js` weight suggestions · `server/store.js` SQLite · `server/acclaim/` collection (`sources.js`), matching (`match.js`), Wikipedia parser, evidence model (`score.js`) · `public/` landing + dashboard · `tests/` (flow.test.js runs the real server against fake Spotify/Apple).

## Must always hold (full text in docs/RULES.md)

- Escape every API value in HTML; never store tokens, emails, names or raw listening lists; save only after consent, keyed by HMAC user ID.
- Official APIs and open data only. No scraping of RYM, Metacritic, AOTY, Pitchfork, communities, webzines.
- Popularity alone never makes a quality score; own ratings never count for oneself; thin evidence weighs less; score weights change only by a reviewed edit.
- Before pushing: `npm run check`, `npm test`, and for UI/server changes run the app (desktop and 390px).

## Git

Commit and push directly to `main` (no PRs or feature branches unless asked). Message: one-line summary, then a short bullet list of what changed. Record meaningful work in `HISTORY.md`.

## Saving usage limits

- Cheapest path first. If a few direct edits do it, do them yourself; no subagent.
- Subagents only for big jobs (many files to create or scan, or translations), at most 2 at a time. Read-only checks, translations and mechanical edits: Agent `model: "sonnet"`; simple lookups: `"haiku"`; design judgment and complex code: default model. End every subagent brief with "report in 25 lines or fewer", and name the files, lines and functions so it does not search again.
- Do not Read large files whole (`server/app.js`, `server/acclaim/sources.js`, `public/js/app.js`, `public/css/styles.css`, `README*.md`): Grep for the spot, then Read with offset/limit.
- Show only result lines of checks and logs (`tail`, `grep`); never dump whole logs or diffs.
- Batch independent commands in one call. Do not reopen files or images already seen. Crop screenshots to the part that matters.
- Record (HISTORY, README) once at the end of a task, then one commit and push. Keep reports to the user short and to the point.

## Writing style (README, HISTORY, docs, commit messages, UI text)

Write like a person, not like an AI assistant.
- No em dashes or en dashes as punctuation (—, –), no arrows (→, ⇒), no emoji or decorative symbols (✅, ❌, ✨, ★).
- No bold labels at the start of every bullet ("**Why:**"), no bold scattered through sentences. Headings and tables carry structure.
- Plain sentences, concrete facts and numbers. No hype words, filler intros or summary-of-the-summary endings.
