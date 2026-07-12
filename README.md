# Music Ability

Spotify 청취 데이터를 바탕으로 내가 어떤 음악을 얼마나 폭넓게 듣는지 분석하는 웹 앱입니다. 장르 비중, 세부 장르, 자주 듣는 아티스트와 트랙을 한눈에 보여 주고, 음악 취향이 겹치는 평론가/큐레이터 프로필도 제안합니다.

## Repository

- **Name:** `music-ability`
- **Description:** Spotify 청취 데이터를 바탕으로 음악 취향과 장르 스펙트럼을 분석하는 웹 앱
- **License:** MIT

## What It Does

- Spotify 계정으로 로그인
- 최근 및 중기 기준 Top 트랙과 아티스트 분석
- 아티스트 장르 태그 기반 장르 비중 계산
- K-pop, J-pop, Pop, Hip-hop/Rap, R&B/Soul, Rock, Indie, Electronic 등 큰 장르 분류
- 세부 장르 태그 및 취향 프로필 점수 제공
- 대표 트랙/아티스트와 취향 요약 표시
- Spotify 인증 없이도 화면을 확인할 수 있는 데모 모드

## Screens

1. 랜딩 화면에서 Spotify 로그인 또는 데모 분석을 선택합니다.
2. 대시보드에서 음악력 점수, 장르 스펙트럼, 세부 태그, 자주 듣는 음악을 확인합니다.
3. 다음 단계에서는 플레이리스트 평가와 사용자 간 취향 비교를 추가합니다.

## Run Locally

Node.js 20 이상이 필요합니다.

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
```

4. 서버를 다시 시작하고 Spotify 로그인 버튼을 누릅니다.

## Data Scope

Spotify Public Web API는 전체 청취 시간 기록을 직접 제공하지 않습니다. 현재 버전은 Top 트랙, Top 아티스트, 최근 재생 이력과 아티스트 장르 태그를 조합해 분석합니다. 정확한 장기 청취 시간은 사용자가 연결한 뒤 재생 이벤트를 자체 데이터베이스에 누적하는 방식으로 확장할 예정입니다.

## Roadmap

- 사용자별 청취 이벤트 저장 및 기간별 리포트
- 플레이리스트 공개/평가 기능
- 취향 유사도와 큐레이터/평론가 매칭
- 공유 가능한 음악력 프로필
- 장르별 탐색 깊이와 신보 발견 지표

## Tech

- Node.js built-in HTTP server
- Spotify Web API + OAuth 2.0 Authorization Code flow
- Vanilla HTML, CSS, JavaScript

## License

MIT. See [LICENSE](LICENSE).
