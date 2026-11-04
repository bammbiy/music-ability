# 배포 안내

아직 공개 서비스 계획은 없습니다. 나중에 올릴 때 바로 쓸 수 있도록 필요한 것을 미리 준비해 두었고, 이 문서는 그 사용법입니다.

## 준비된 것

| 항목 | 위치 | 설명 |
| --- | --- | --- |
| Docker 이미지 | `Dockerfile`, `.dockerignore` | Node 24 위에 소스만 복사합니다. 설치나 빌드 단계가 없습니다. |
| 상태 확인 | `GET /healthz` | 데이터베이스가 응답하면 200 `{"ok":true}`, 아니면 503. 설정 정보는 내보내지 않습니다. |
| 종료 처리 | `server/app.js` | SIGTERM을 받으면 진행 중인 요청을 마치고 데이터베이스를 닫은 뒤 종료합니다. |
| 백업 | `npm run backup [-- 폴더]` | 서버가 켜져 있어도 안전하게 데이터베이스 전체를 날짜별 파일로 복사합니다. |
| 데이터 위치 | `DATABASE_PATH` | 이미지에서는 `/data/music-ability.sqlite`. `/data`에 볼륨을 붙여야 재배포해도 데이터가 남습니다. |

2026-11-04에 Docker 이미지를 실제로 빌드해 상태 확인, 볼륨 저장, 백업, 종료 신호 처리를 확인했습니다. Node 24 컨테이너에서도 테스트 전체가 통과했습니다.

## 서버는 한 대로

세션, 요청 제한, 앨범 수집 대기열이 서버 메모리에 있습니다. 그래서 인스턴스는 한 대만 띄웁니다. 자동으로 여러 대로 늘리는 설정(오토스케일)은 꺼 두세요. Spotify 개발 모드 앱은 등록한 사용자만 로그인할 수 있으니 이 규모로 충분합니다.

서버를 재시작하면 로그인 세션은 사라지고 다시 로그인해야 합니다. 동의 기록, 앨범 평가, 평가 캐시는 데이터베이스에 있어서 남습니다.

## 어디에 올릴까

| 방식 | 맞는지 | 메모 |
| --- | --- | --- |
| Railway, Render, Fly.io 같은 PaaS + 볼륨 | 맞음 | Dockerfile을 그대로 씁니다. 볼륨을 `/data`에 연결하는 것만 잊지 않으면 됩니다. |
| 작은 VPS + Docker | 맞음 | 가장 싸고 자유롭지만 HTTPS와 재시작 설정을 직접 합니다. |
| Vercel, Netlify 같은 서버리스 | 안 맞음 | 파일 저장과 백그라운드 수집이 안 됩니다. |

가격과 무료 범위는 자주 바뀌니 가입할 때 확인하세요.

## 환경변수

| 이름 | 필수 | 값 |
| --- | --- | --- |
| `NODE_ENV` | 예 | `production` (이미지에 기본 설정) |
| `SESSION_SECRET` | 예 | 32자 이상 무작위 값. 없으면 서버가 시작되지 않습니다. |
| `USER_HASH_SECRET` | 권장 | 사용자 ID용 키. 한 번 정하면 바꾸지 마세요(바꾸면 저장된 데이터와 연결이 끊깁니다). |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify를 쓰면 | Spotify 대시보드 값 |
| `SPOTIFY_REDIRECT_URI` | Spotify를 쓰면 | `https://내주소/callback` |
| `ACCLAIM_CONTACT` | 권장 | MusicBrainz 요청에 붙는 연락처(이메일이나 저장소 주소) |
| `APPLE_MUSICKIT_DEVELOPER_TOKEN` | Apple을 쓰면 | MusicKit developer token |
| `PORT` | 아니요 | 기본 3003. 플랫폼이 정해 주면 그 값을 씁니다. |

무작위 값은 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`로 만들 수 있습니다.

## PaaS에 올리는 순서

1. 서비스에 가입하고 GitHub 저장소 `bammbiy/music-ability`를 연결합니다. Dockerfile을 자동으로 찾습니다.
2. 볼륨(Volume, Disk)을 만들어 `/data`에 연결합니다.
3. 위 환경변수를 넣습니다.
4. 상태 확인 경로를 `/healthz`로 지정합니다.
5. 인스턴스 수를 1로 고정합니다.
6. 배포가 끝나면 받은 주소로 `https://내주소/healthz`를 열어 `{"ok":true}`가 나오는지 봅니다.
7. Spotify 대시보드의 Redirect URI에 `https://내주소/callback`을 추가하고, 로그인할 사용자 이메일을 등록합니다.
8. 로그인해서 분석, 참여, 앨범 평가까지 한 번 해 봅니다.

## VPS에 올리는 순서

```bash
git clone https://github.com/bammbiy/music-ability.git
cd music-ability
docker build -t music-ability .
docker volume create music-ability-data
docker run -d --name music-ability --restart unless-stopped \
  -p 127.0.0.1:3003:3003 \
  -v music-ability-data:/data \
  --env-file .env \
  music-ability
```

HTTPS는 앞단에 Caddy나 nginx를 두고 `127.0.0.1:3003`으로 넘깁니다. 프록시는 원래 `Host` 헤더를 그대로 넘겨야 합니다(같은 출처 검사에 씁니다).

업데이트는 `git pull` 후 `docker build`와 컨테이너 교체로 합니다. 데이터는 볼륨에 있어서 그대로 남습니다.

## 백업

```bash
# 컨테이너 안에서 볼륨으로 백업
docker exec music-ability node scripts/backup-db.mjs /data/backups
```

백업 파일은 같은 볼륨에 쌓이므로, 가끔 다른 곳(내 컴퓨터, 클라우드 저장소)으로 복사해 두세요. 복원은 서버를 멈추고 백업 파일을 `/data/music-ability.sqlite`로 바꿔 넣은 뒤 다시 켜면 됩니다.

## 공개 서비스 전에 더 필요한 것

- 개인정보처리방침과 동의 화면 문구 검토
- 사용자가 늘면 세션과 요청 제한을 Redis로, 데이터베이스를 PostgreSQL로 옮기기
- 정기 백업 자동화
