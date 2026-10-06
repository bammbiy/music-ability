# Music Ability

Spotify 청취 데이터를 바탕으로 내가 어떤 음악을 얼마나 폭넓게 듣는지 분석하는 웹 앱입니다. 장르 비중, 세부 장르, 자주 듣는 아티스트와 트랙을 한눈에 보여 주고, 음악 취향이 겹치는 평론가/큐레이터 프로필도 제안합니다.

## Repository

- **Name:** `music-ability`
- **Description:** 여러 음악 서비스의 청취 데이터를 바탕으로 음악 취향과 장르 스펙트럼을 분석하는 웹 앱
- **License:** MIT

## What It Does

- Spotify 계정으로 로그인
- 최근 및 중기 기준 Top 트랙과 아티스트 분석
- 아티스트 장르 태그 기반 장르 비중 계산
- K-pop, J-pop, Pop, Hip-hop/Rap, R&B/Soul, Rock, Indie, Electronic 등 큰 장르 분류
- 세부 장르 태그 및 취향 프로필 점수 제공
- 대표 트랙/아티스트와 취향 요약 표시
- Spotify 인증 없이도 화면을 확인할 수 있는 데모 모드
- 설명 가능한 음악력 지표: 다양성, 감상 깊이, 발견 성향, 취향 확장성
- 다음 데이터 저장 단계에 사용할 동의 및 계정 연결 해제 API 기반

## Screens

1. 랜딩 화면에서 Spotify 로그인 또는 데모 분석을 선택합니다.
2. 대시보드에서 음악력 점수, 장르 스펙트럼, 세부 태그, 자주 듣는 음악을 확인합니다.
3. 다음 단계에서는 플레이리스트 평가와 사용자 간 취향 비교를 추가합니다.

## Run Locally

Node.js 24 이상이 필요합니다. 로컬 개발에서는 내장 SQLite로 익명화된 품질 개선 데이터를 저장합니다.

```powershell
npm start
```

브라우저에서 `http://localhost:3003`을 엽니다.

Spotify 키가 없어도 데모 모드로 제품 화면을 바로 확인할 수 있습니다.

## Spotify Setup

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)에서 앱을 만듭니다.
2. Redirect URI에 아래 주소를 등록합니다.

```text
http://localhost:3003/callback
```

3. `.env.example`을 참고해 프로젝트 루트에 `.env` 파일을 만듭니다.

```dotenv
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3003/callback
SESSION_SECRET=use_a_long_random_value
PORT=3003
APPLE_MUSICKIT_DEVELOPER_TOKEN=your_apple_music_developer_token
YOUTUBE_API_KEY=your_youtube_data_api_key
NEWS_RSS_URLS=
SOCIAL_FEED_URLS=
```

4. 서버를 다시 시작하고 Spotify 로그인 버튼을 누릅니다.

## Apple Music Setup

Apple Music 웹 로그인은 MusicKit on the Web을 사용합니다. Apple Developer 계정에서 MusicKit용 developer token을 발급한 뒤 `.env`의 `APPLE_MUSICKIT_DEVELOPER_TOKEN`에 넣습니다. 사용자가 Apple Music 로그인을 승인하면 Music User Token으로 최근 재생 트랙을 가져와 같은 분석 엔진에 전달합니다. 사용자 토큰 자체는 저장하지 않습니다. Apple은 사용자 데이터 요청에 Music User Token을 요구합니다. [Apple Music 사용자 인증](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit)

## YouTube Music Scope

Google OAuth와 YouTube Data API는 유튜브 계정, 채널, 영상, 플레이리스트 같은 리소스에 접근할 수 있지만 공식 YouTube Music 개인 청취 기록 API는 제공하지 않습니다. 따라서 현재 버튼은 준비 중으로 안내하고, 이후 공식 범위 안에서 플레이리스트 가져오기와 사용자 파일 내보내기를 지원합니다. 비공식 YouTube Music 스크래핑은 사용하지 않습니다. [YouTube OAuth](https://developers.google.com/youtube/v3/guides/authentication), [YouTube Data API](https://developers.google.com/youtube/v3/docs)

## Media Feed Setup

대시보드에는 출처 링크가 붙은 음악 정보 피드가 있습니다. `YOUTUBE_API_KEY`를 설정하면 공식 YouTube 검색 결과를 사용하고, `NEWS_RSS_URLS` 또는 `SOCIAL_FEED_URLS`에 공식 RSS/Atom 피드 주소를 쉼표로 입력하면 기사와 공식 소셜 피드를 추가할 수 있습니다. 피드 데이터는 사용자 데이터와 섞어 저장하지 않습니다.

서버 엔드포인트는 `GET /api/media?q=artist%20name`입니다. YouTube 검색은 공식 `search.list` 엔드포인트와 Google 할당량 정책을 따릅니다. [YouTube Search: list](https://developers.google.com/youtube/v3/docs/search/list)

## Critic & Listener Acclaim

자주 듣는 앨범마다 평단과 청취자 평가를 모아 음악력 지표에 반영합니다. **공식 API나 공개 데이터만 사용하고, 이용약관에서 자동 수집을 금지하는 사이트(RateYourMusic, Metacritic, AOTY 등)는 스크래핑하지 않습니다.** Metacritic, AllMusic, Pitchfork 같은 매체의 점수는 Wikidata에 공개된 리뷰 점수(P444)로만 가져옵니다.

| 출처 | 가져오는 값 | 설정 |
| --- | --- | --- |
| MusicBrainz | 앨범 식별(MBID), 발매일, 커뮤니티 평점과 투표 수 | 기본 사용, `ACCLAIM_CONTACT` 권장 |
| Wikidata | 매체별 평론 점수, 수상(P166)·후보(P1411), 위키백과 등재 언어 수 | 기본 사용 |
| 영어 위키백과 | 앨범 문서의 평가표(Music ratings): 매체별 점수, Metacritic | 기본 사용 (CC BY-SA, 화면에 원문 링크) |
| ListenBrainz | 앨범 청취자 수 (대중성) | 기본 사용 |
| Discogs | 커뮤니티 평점, 소장/위시리스트 수 | `DISCOGS_TOKEN` |
| Last.fm | 청취자 수, 재생 수 (대중성) | `LASTFM_API_KEY` |

필요한 네트워크 허용 도메인: `musicbrainz.org`, `query.wikidata.org`, `en.wikipedia.org`, `api.listenbrainz.org` (선택: `api.discogs.com`, `ws.audioscrobbler.com`)

### 신빙성 모델

앨범마다 근거를 모아 하나의 평가 점수와 **근거 신뢰도**를 계산합니다(`combineEvidence`, `server/acclaim/score.js`).

| 근거 | 역할 | 가중치 |
| --- | --- | --- |
| 평론 점수 | 품질의 직접 근거 | 매체 1곳 1.0, 1곳 늘 때마다 +0.4 (최대 3) |
| 청취자 평점 | 품질의 직접 근거 | 투표 수에 비례 (20표에 0.75, 최대 1.5) |
| 수상 / 후보 | 품질의 직접 근거 | 수상 0.75씩(최대 1.5), 후보 0.3씩(최대 0.8) |
| 위키백과 등재 언어 수 | 주목도, 보조 | 0.25 |
| 대중성 (ListenBrainz, Last.fm) | 주목도, 보조 | 0.15 |

- 주목도·대중성만 있는 앨범에는 평가 점수를 매기지 않습니다. 인기가 곧 품질은 아니기 때문입니다.
- 판매 인증(골드, 플래티넘)은 수상으로 세지 않습니다.
- 근거 신뢰도 = 가중치 합 / (가중치 합 + 1.5). 평단 지표는 청취 비중만큼 신뢰도를 반영해 계산하고, 전체 신뢰도가 60% 미만이면 평단 지표가 점수에 반영되는 비중도 그만큼 줄어듭니다.
- 대시보드에 전체 신뢰도(높음/보통/낮음)와 근거 수(평론 N건, 수상 N건, 투표 N표), 앨범별 근거를 표시합니다.

### 쓰지 않는 출처

커뮤니티 반응(Reddit, 디시인사이드, 더쿠 등), 음악 평가 사이트(RateYourMusic, Metacritic, AOTY, Pitchfork), 웹진 칼럼(IZM 등)은 직접 수집하지 않습니다. 공식 API가 없거나 이용약관이 자동 수집을 금지합니다(Reddit API는 상업적 이용과 학습에 별도 계약이 필요). 이런 매체의 점수는 Wikidata와 위키백과에 공개적으로 정리된 범위에서만 반영됩니다.

- Wikidata의 매체 점수는 음악 매체 허용 목록(Metacritic, AllMusic, Pitchfork, Album of the Year 등)만 사용합니다. 사운드트랙 항목에 붙은 영화·게임 점수(IMDb, Rotten Tomatoes, IGN 등)는 버립니다. 만점 표기 없이 숫자만 있는 점수는 매체별 만점 기준으로 환산합니다.
- 공개 데이터의 평론 점수는 영미권 유명 앨범 위주라 K-pop, J-pop, 인디 앨범은 비어 있는 경우가 많습니다. 평론 점수가 없는 앨범은 MusicBrainz 청취자 평점(투표 수가 적으면 평균 쪽으로 보정)으로 대신합니다.
- 앨범 매칭: 먼저 제목과 아티스트로 정확히 검색하고, 실패하면 아티스트를 별칭까지 포함해 찾은 뒤(예: Fujii Kaze → 藤井風) 그 아티스트의 발매 목록 안에서만 제목을 비교합니다. "1st Album"과 "1집", 제목 속 아티스트 이름, 악센트(Fantôme), 한자 부제(LOVE YOURSELF 轉 'Tear'), 에디션 표기("(Remastered)"), 대시 뒤 설명("Armageddon - The 1st Album")을 같은 앨범으로 봅니다. 후보가 둘 이상 비슷하면 틀리게 붙이지 않도록 매칭하지 않습니다.
- 새 지표: **평단 감각**(자주 듣는 앨범의 평균 평론 점수, 없으면 청취자 평점), **숨은 명반 발굴**(평론 점수 78 이상이면서 대중성 45 미만인 앨범 비중), **신보 감도**(최근 6개월 안에 나온 음악 비중).
- 수집은 서버 백그라운드 대기열에서 API별 요청 간격(MusicBrainz 초당 1회 등)을 지키며 진행합니다. 결과는 `album_scores` 테이블에 캐시되어 찾은 앨범은 30일, 없는 앨범은 7일, 연결 실패는 1시간 동안 다시 요청하지 않습니다.
- 평론 점수가 있는 앨범이 청취 비중의 30% 미만이거나 3장 미만이면 평단 지표는 점수에서 빠지고, 나머지 지표의 가중치가 다시 계산됩니다.
- **보정(학습)**: 캐시된 앨범이 쌓이면 매체마다 점수를 주는 경향(평균과 분포)을 학습해 같은 기준으로 맞춥니다. 동의한 사용자의 결과가 30명 이상 쌓이면 "상위 몇 %"도 함께 보여 줍니다.
- 상태 확인: `GET /api/acclaim/status`
- 실데이터 점검: `npm run probe -- "Frank Ocean" "Blonde"` 로 한 앨범의 출처별 수집 결과와 최종 평가·신뢰도를 확인합니다(캐시를 쓰지 않음). Node 22에서 HTTP 프록시 뒤에 있다면 `NODE_USE_ENV_PROXY=1`을 붙입니다.
- 데모 모드의 평론 점수는 화면 구성을 보여 주기 위한 예시 값이며 실제 매체 점수가 아닙니다.

## Data Scope

Spotify Public Web API는 전체 청취 시간 기록을 직접 제공하지 않습니다. 현재 버전은 Top 트랙, Top 아티스트, 최근 재생 이력과 아티스트 장르 태그를 조합해 분석합니다. 정확한 장기 청취 시간은 사용자가 연결한 뒤 재생 이벤트를 자체 데이터베이스에 누적하는 방식으로 확장할 예정입니다.

분석 점수는 음악 실력이나 우열을 의미하지 않습니다. 장르 다양성, 앨범/세부 장르 감상 깊이, 새로운 아티스트를 탐색하는 성향, 특정 아티스트 편중도를 조합한 개인 취향 지표입니다.

## Product Direction

장기적으로 여러 음악 서비스를 같은 분석 엔진에 연결하는 provider-neutral 구조를 목표로 합니다. 다음 공식 연동은 Apple Music이며, YouTube Music은 공식 청취 기록 API가 없는 범위에서 사용자 파일 내보내기나 플레이리스트 데이터부터 지원합니다. 서버의 분석 데이터에는 provider가 표시되므로 서비스별 연결기를 추가해도 같은 분석 모델을 사용할 수 있습니다.

공개 서비스 전환 전에는 관리형 데이터베이스, 영속적인 OAuth 토큰 저장, 주기적 수집 작업, 개인정보처리방침, 동의 화면, 완전한 계정/데이터 삭제 흐름이 필요합니다. 현재 세션 저장소는 로컬 개발용으로 의도적으로 메모리에만 저장됩니다.

## Roadmap

- 사용자별 청취 이벤트 저장 및 기간별 리포트
- 플레이리스트 공개/평가 기능
- 취향 유사도와 큐레이터/평론가 매칭
- 공유 가능한 음악력 프로필
- 장르별 탐색 깊이와 신보 발견 지표

## Tech

- Node.js built-in HTTP server
- Node.js built-in SQLite (`node:sqlite`)
- Spotify Web API + OAuth 2.0 Authorization Code flow
- Apple MusicKit on the Web + Apple Music API
- Vanilla HTML, CSS, JavaScript
- MusicBrainz, Wikidata, Discogs, Last.fm (평단/청취자 평가)
- 테스트: `npm test` (Node 내장 test runner). `tests/flow.test.js`는 실제 서버를 가짜 Spotify에 연결해 로그인부터 연결 해제까지 전체 흐름을 검증합니다(`SPOTIFY_ACCOUNTS_URL`, `SPOTIFY_API_URL`은 이 테스트용 설정).

## Quality Data

분석 결과를 저장하거나 품질 개선용 평가를 보내려면 대시보드에서 사용자가 직접 참여 동의를 해야 합니다. 저장되는 정보는 provider 해시, 분석 지표 스냅샷, 장르 집계 결과, 사용자가 선택한 1~5점 평가이며 이메일, 표시 이름, OAuth 토큰, 원본 청취 목록은 저장하지 않습니다.

- `POST /api/consent`: 품질 개선 데이터 수집 동의
- `POST /api/feedback`: 분석 결과 평가 저장
- `POST /api/ratings`: 앨범 평가 저장 `{ key, rating }` (1~10, `null`이면 삭제)

### 사용자 앨범 평가

참여에 동의한 사용자는 대시보드에서 최근 분석에 포함된 앨범을 10점 만점으로 평가할 수 있습니다. 모인 평가는 "Music Ability 사용자 평가"라는 근거로 다른 사용자의 평단 지표에 반영됩니다.

- 자기 점수 부풀리기를 막기 위해, 내 평가는 내 분석에서 제외되고 다른 사람의 분석에만 쓰입니다.
- 방금 분석한 내 청취 기록에 있는 앨범만 평가할 수 있고, 한 사람당 앨범마다 한 표입니다(다시 평가하면 덮어씀).
- 가중치는 다른 청취자 평점과 같이 투표 수에 비례하므로(20명에 0.75, 최대 1.5), 소수의 평가는 결과를 크게 움직이지 못합니다.
- 공개 데이터가 없는 앨범(예: 한국 인디)도 사용자 평가만으로 근거를 가질 수 있습니다.
- 저장 항목: 해시된 사용자 ID, 앨범 키, 아티스트/앨범 이름, 점수. 연결 해제 시 함께 삭제됩니다.
- 참여 동의는 DB에 저장되므로 다시 로그인해도 유지됩니다(연결 해제 전까지). Apple Music은 로그인마다 사용자 토큰이 바뀌어 같은 사람으로 인식되지 않을 수 있습니다.
- `POST /api/account/disconnect`: 연결 해제 및 저장 데이터 삭제

현재 SQLite 파일은 `data/music-ability.sqlite`에 생성되며 Git에는 포함되지 않습니다. 공개 서비스에서는 이 저장소를 관리형 PostgreSQL로 교체하고, 개인정보처리방침과 관리자용 데이터 보존 정책을 추가해야 합니다.

## Security

- 세션 쿠키는 HMAC 서명, `HttpOnly`, `SameSite=Lax`이며 HTTPS 환경(`NODE_ENV=production` 또는 https Redirect URI)에서는 `Secure`가 붙습니다. 로그인 후 세션 ID를 새로 발급합니다.
- `SESSION_SECRET`은 32자 이상 무작위 값이어야 합니다. 개발 중 비어 있으면 프로세스마다 임시 키를 쓰고, `NODE_ENV=production`에서는 서버가 시작되지 않습니다.
- 저장되는 사용자 ID는 `USER_HASH_SECRET`(없으면 `SESSION_SECRET`) 키로 만든 HMAC 값입니다. 이 키를 바꾸면 기존 저장 데이터와 연결이 끊깁니다.
- 모든 응답에 CSP, `X-Frame-Options`, `nosniff` 등 보안 헤더를 붙이고, POST 요청은 같은 출처에서만 허용합니다.
- `/api/media`, 로그인, POST API에는 IP별 요청 제한이 있고, 미디어 검색 결과는 5분간 캐시해 YouTube 할당량을 보호합니다.
- Spotify access token은 만료 전에 refresh token으로 자동 갱신됩니다.
- Apple MusicKit developer token은 MusicKit JS가 브라우저에서 사용해야 하므로 `/api/status`로 공개됩니다. 짧은 만료 기간과 `origin` 클레임을 넣어 발급하세요.

## License

MIT. See [LICENSE](LICENSE).
