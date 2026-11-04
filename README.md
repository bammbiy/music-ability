# Music Ability

한국어 | [English](README.en.md) | [日本語](README.ja.md) | [中文](README.zh.md)

Spotify와 Apple Music 청취 기록으로 음악 취향을 분석하는 웹 앱입니다. 장르를 얼마나 넓게 듣는지, 얼마나 깊이 듣는지, 새 아티스트를 얼마나 찾아 듣는지, 듣는 앨범이 평단과 청취자에게 어떤 평가를 받았는지를 모아 설명 가능한 "음악력" 점수로 보여 줍니다.

점수는 음악 실력이나 우열이 아니라 듣는 습관을 나타냅니다.

아직 공개 서비스는 아니고 개발 중입니다. 배포 준비물은 갖춰 두었습니다([배포 안내](docs/DEPLOY.md)).

## 주요 기능

- Spotify 로그인(OAuth), Apple Music 로그인(MusicKit on the Web)
- 로그인 없이 볼 수 있는 데모 모드
- 장르 비중과 세부 장르, 자주 듣는 아티스트와 트랙
- 음악력 지표 7개: 장르 다양성, 감상 깊이, 발견 성향, 취향 확장성, 신보 감도, 평단 감각, 숨은 명반 발굴
- 앨범별 평론 점수, 수상 기록, 청취자 평점과 근거 신뢰도
- 참여에 동의한 사용자의 앨범 평가(10점 만점)
- 분석이 잘 맞는지, 점수가 적당한지 묻는 피드백

## 실행

Node.js 24 이상이 필요합니다. 의존성 설치나 빌드 과정은 없습니다.

```bash
npm start
```

브라우저에서 `http://localhost:3003`을 엽니다. Spotify 키가 없어도 `http://localhost:3003/dashboard.html?demo=1`에서 데모 화면을 볼 수 있습니다.

| 명령 | 하는 일 |
| --- | --- |
| `npm start` | 서버 실행 |
| `npm run check` | 서버와 브라우저 코드 문법 검사 |
| `npm test` | 단위 테스트와 전체 로그인 흐름 테스트 |
| `npm run probe -- "Frank Ocean" "Blonde"` | 앨범 하나를 실제 API로 수집해 출처별 결과 출력(캐시 미사용) |
| `npm run learn-weights` | 점수 피드백으로 추천 가중치 출력(답변 50개 이상 필요) |
| `npm run backup` | SQLite 데이터베이스를 `data/backups`에 복사 |

## 설정

`.env.example`을 복사해 프로젝트 루트에 `.env`를 만듭니다. `.env`는 Git에 올리지 않습니다.

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

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)에서 앱을 만듭니다.
2. Redirect URI에 `http://localhost:3003/callback`을 등록합니다.
3. Client ID와 Secret을 `.env`에 넣고 서버를 다시 시작합니다.

개발 모드 앱은 대시보드에 등록한 사용자만 로그인할 수 있습니다. 허용 인원과 정식 승인 조건은 Spotify 정책을 확인하세요.

### Apple Music

Apple Developer 계정에서 MusicKit developer token을 발급해 `APPLE_MUSICKIT_DEVELOPER_TOKEN`에 넣습니다. 사용자가 로그인을 승인하면 Music User Token으로 최근 재생 곡을 가져옵니다. 사용자 토큰은 저장하지 않습니다.

developer token은 MusicKit JS가 브라우저에서 써야 해서 `/api/status`로 공개됩니다. 만료 기간을 짧게 하고 `origin` 클레임을 넣어 발급하세요.

### YouTube Music

YouTube Data API는 YouTube Music 개인 청취 기록을 제공하지 않습니다. 그래서 지금은 준비 중으로 안내하고, 비공식 스크래핑은 쓰지 않습니다.

### 음악 소식 피드

`YOUTUBE_API_KEY`를 넣으면 공식 YouTube 검색 결과를 보여 줍니다. `NEWS_RSS_URLS`, `SOCIAL_FEED_URLS`에 RSS/Atom 주소를 쉼표로 넣으면 기사와 공식 소셜 피드가 추가됩니다. 엔드포인트는 `GET /api/media?q=검색어`입니다.

## 평단과 청취자 평가

자주 듣는 앨범마다 평가를 모아 점수에 반영합니다. 공식 API와 공개 데이터만 쓰고, 이용약관으로 자동 수집을 막는 사이트(RateYourMusic, Metacritic, AOTY, Pitchfork, 커뮤니티, 웹진)는 수집하지 않습니다. 이런 매체의 점수는 Wikidata와 위키백과에 공개적으로 정리된 만큼만 들어옵니다.

| 출처 | 가져오는 값 | 설정 |
| --- | --- | --- |
| MusicBrainz | 앨범 식별, 발매일, 커뮤니티 평점 | 기본, `ACCLAIM_CONTACT` 권장 |
| Wikidata | 매체별 평론 점수, 수상과 후보, 위키백과 등재 언어 수 | 기본 |
| 영어 위키백과 | 앨범 문서의 평가표(Music ratings) | 기본 (CC BY-SA) |
| ListenBrainz | 청취자 수 | 기본 |
| Discogs | 커뮤니티 평점, 소장 수 | `DISCOGS_TOKEN` |
| Last.fm | 청취자 수, 재생 수 | `LASTFM_API_KEY` |

수집에 필요한 네트워크 도메인은 `musicbrainz.org`, `query.wikidata.org`, `en.wikipedia.org`, `api.listenbrainz.org`입니다. Discogs와 Last.fm을 쓰면 `api.discogs.com`, `ws.audioscrobbler.com`도 필요합니다.

### 신뢰도 계산

앨범마다 근거를 합쳐 평가 점수 하나와 근거 신뢰도를 계산합니다(`server/acclaim/score.js`의 `combineEvidence`).

| 근거 | 역할 | 가중치 |
| --- | --- | --- |
| 평론 점수 | 품질 근거 | 매체 1곳 1.0, 1곳 늘 때마다 0.4 추가(최대 3) |
| 청취자 평점 | 품질 근거 | 투표 수에 비례(20표에 0.75, 최대 1.5) |
| 수상, 후보 | 품질 근거 | 수상 0.75씩(최대 1.5), 후보 0.3씩(최대 0.8) |
| 위키백과 등재 언어 수 | 주목도 보조 | 0.25 |
| 대중성 | 주목도 보조 | 0.15 |

- 인기나 주목도만 있는 앨범에는 평가 점수를 매기지 않습니다.
- 판매 인증(골드, 플래티넘)은 수상으로 세지 않습니다.
- 신뢰도는 가중치 합 / (가중치 합 + 1.5)입니다. 전체 신뢰도가 60%보다 낮으면 평단 지표가 점수에서 차지하는 비중도 그만큼 줄어듭니다.
- 평론 점수가 있는 앨범이 청취 비중의 30% 미만이거나 3장 미만이면 평단 지표는 빠지고 나머지 지표로 계산합니다.
- 캐시된 앨범이 쌓이면 매체마다 점수 주는 경향을 학습해 기준을 맞춥니다. 참여 사용자가 30명을 넘으면 상위 몇 %인지도 보여 줍니다.

### 앨범 매칭

스트리밍 서비스와 MusicBrainz는 같은 앨범을 다르게 적는 일이 많습니다. 정확한 검색이 실패하면 아티스트를 별칭까지 찾고(Fujii Kaze와 藤井風), 그 아티스트의 발매 목록 안에서만 제목을 비교합니다. "1st Album"과 "1집", 악센트(Fantôme), 한자 부제(LOVE YOURSELF 轉 'Tear'), 에디션 표기, "Pt. 1"과 "Part 1", 다른 언어 제목("화양연화 pt.1"과 "The Most Beautiful Moment in Life, Pt.1")을 같은 앨범으로 봅니다. 비슷한 후보가 둘 이상이면 잘못 붙이지 않도록 매칭하지 않습니다.

수집은 서버의 백그라운드 대기열에서 API별 요청 간격을 지키며 진행합니다. 결과는 찾은 앨범 30일, 못 찾은 앨범 7일, 연결 실패 1시간 동안 캐시합니다. 상태는 `GET /api/acclaim/status`로 확인합니다.

데모 모드의 평론 점수는 화면 예시용 값이고 실제 매체 점수가 아닙니다.

## 사용자 데이터

분석 결과 저장, 피드백, 앨범 평가는 사용자가 대시보드에서 참여에 동의한 경우에만 저장합니다. 이메일, 이름, OAuth 토큰, 원본 청취 목록은 저장하지 않습니다.

- `POST /api/consent`: 참여 동의
- `POST /api/feedback`: `{ targetType, targetId, rating }`. `analysis`는 취향과 맞는 정도(1~5), `score`는 점수 체감(1 너무 낮음, 3 적당, 5 너무 높음)이고, 평가한 분석 결과와 함께 저장됩니다.
- `POST /api/ratings`: 앨범 평가 `{ key, rating }`(1~10, `null`이면 삭제)
- `POST /api/account/disconnect`: 연결 해제와 저장 데이터 삭제

### 앨범 평가

- 내 평가는 내 점수에 반영되지 않고 다른 사람의 분석에만 쓰입니다.
- 방금 분석한 내 청취 기록에 있는 앨범만, 앨범마다 한 표씩 평가할 수 있습니다.
- 평가는 투표 수에 비례해 반영되므로 몇 명의 평가로 결과가 크게 바뀌지 않습니다.
- 공개 평가가 적은 앨범(예: 한국 인디)은 목록 위쪽에 "공개 평가 적음" 표시와 함께 나옵니다.
- 참여 동의는 다시 로그인해도 유지됩니다. Apple Music은 고정 계정 ID가 없어서 브라우저마다 서명된 무작위 ID 쿠키(`ma_apple`)로 구분합니다. 쿠키를 지우거나 다른 브라우저를 쓰면 새 사용자로 시작합니다.

### 점수 가중치 학습

"점수는 어떻게 느껴지나요?" 답변을 사용자가 원했을 점수로 바꿔(한 단계에 8점) 지표별 가중치를 맞춥니다. `npm run learn-weights`는 추천값만 출력하고, 실제 점수에는 사람이 검토한 뒤 `server/analysis.js`의 `SCORE_WEIGHTS`를 고쳐야 반영됩니다. 추천값은 기본값의 ±30% 안에서만 움직입니다.

데이터베이스는 `data/music-ability.sqlite`(또는 `DATABASE_PATH`)에 만들어지고 Git에는 포함되지 않습니다.

## 보안

- 세션 쿠키는 HMAC 서명, `HttpOnly`, `SameSite=Lax`이고 HTTPS 환경에서는 `Secure`가 붙습니다. 로그인하면 세션 ID를 새로 발급합니다.
- `SESSION_SECRET`은 32자 이상 무작위 값이어야 하고, `NODE_ENV=production`에서 없으면 서버가 시작되지 않습니다.
- 저장되는 사용자 ID는 `USER_HASH_SECRET`(없으면 `SESSION_SECRET`)으로 만든 HMAC 값입니다. 이 키를 바꾸면 기존 데이터와 연결이 끊깁니다.
- 모든 응답에 CSP, `X-Frame-Options`, `nosniff` 같은 보안 헤더를 붙이고, POST 요청은 같은 출처에서만 받습니다.
- 로그인, POST API, `/api/media`에는 IP별 요청 제한이 있습니다.
- Spotify access token은 만료 전에 자동으로 갱신됩니다.

## 배포

`Dockerfile`, 상태 확인 주소(`GET /healthz`), 종료 신호 처리, 데이터베이스 백업 스크립트가 준비되어 있습니다. 서버 한 대와 데이터가 유지되는 디스크(볼륨)면 충분합니다. 자세한 절차는 [docs/DEPLOY.md](docs/DEPLOY.md)에 있습니다.

## 기술

- Node.js 내장 HTTP 서버와 SQLite(`node:sqlite`), 외부 의존성 없음
- Spotify Web API, Apple MusicKit on the Web
- MusicBrainz, Wikidata, Wikipedia, ListenBrainz, Discogs, Last.fm
- HTML, CSS, JavaScript(빌드 없음), 폰트는 Pretendard를 직접 포함
- 테스트는 Node 내장 test runner. `tests/flow.test.js`는 실제 서버를 가짜 Spotify와 Apple Music에 연결해 로그인부터 연결 해제까지 확인합니다.

## 라이선스

MIT. [LICENSE](LICENSE)를 보세요.
