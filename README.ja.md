# Music Ability

[한국어](README.md) | [English](README.en.md) | 日本語 | [中文](README.zh.md)

SpotifyとApple Musicの再生履歴から音楽の好みを分析するWebアプリです。ジャンルをどれだけ幅広く聴くか、どれだけ深く聴くか、新しいアーティストをどれだけ探して聴くか、聴いているアルバムが批評家とリスナーからどう評価されているかをまとめ、説明できる「音楽力」スコアとして表示します。

スコアは音楽の実力や優劣ではなく、聴き方の習慣を表します。

まだ公開サービスではなく、開発中です。デプロイの準備は整えてあります（[デプロイ案内（韓国語）](docs/DEPLOY.md)）。

## 主な機能

- Spotifyログイン（OAuth）、Apple Musicログイン（MusicKit on the Web）
- ログインなしで見られるデモモード
- ジャンルの割合と詳細ジャンル、よく聴くアーティストとトラック
- 音楽力の指標7つ：ジャンル多様性、鑑賞の深さ、発見傾向、好みの拡張性、新譜感度、批評感覚、隠れた名盤の発掘
- アルバムごとの批評スコア、受賞記録、リスナー評価と根拠の信頼度
- 参加に同意したユーザーによるアルバム評価（10点満点）
- 分析が合っているか、スコアが妥当かを尋ねるフィードバック

## 実行

Node.js 24以上が必要です。依存関係のインストールやビルドの手順はありません。

```bash
npm start
```

ブラウザで `http://localhost:3003` を開きます。Spotifyのキーがなくても `http://localhost:3003/dashboard.html?demo=1` でデモ画面を見られます。

| コマンド | 内容 |
| --- | --- |
| `npm start` | サーバーを起動 |
| `npm run check` | サーバーとブラウザコードの構文チェック |
| `npm test` | 単体テストとログインフロー全体のテスト |
| `npm run probe -- "Frank Ocean" "Blonde"` | アルバム1枚を実際のAPIで収集し、出典ごとの結果を出力（キャッシュは使用しない） |
| `npm run learn-weights` | スコアへのフィードバックから推奨の重みを出力（回答が50件以上必要） |
| `npm run backup` | SQLiteデータベースを `data/backups` にコピー |

## 設定

`.env.example` をコピーして、プロジェクトのルートに `.env` を作ります。`.env` はGitに上げません。

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

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)でアプリを作成します。
2. Redirect URIに `http://localhost:3003/callback` を登録します。
3. Client IDとSecretを `.env` に入れて、サーバーを再起動します。

開発モードのアプリでは、ダッシュボードに登録したユーザーだけがログインできます。許可される人数と正式承認の条件はSpotifyのポリシーを確認してください。

### Apple Music

Apple DeveloperアカウントでMusicKit developer tokenを発行し、`APPLE_MUSICKIT_DEVELOPER_TOKEN` に入れます。ユーザーがログインを承認すると、Music User Tokenで最近再生した曲を取得します。ユーザートークンは保存しません。

developer tokenはMusicKit JSがブラウザで使う必要があるため、`/api/status` で公開されます。有効期限を短くし、`origin` クレームを入れて発行してください。

### YouTube Music

YouTube Data APIは、YouTube Musicの個人の再生履歴を提供していません。そのため現在は準備中として案内し、非公式のスクレイピングは使いません。

### 音楽ニュースフィード

`YOUTUBE_API_KEY` を入れると、公式のYouTube検索結果を表示します。`NEWS_RSS_URLS` と `SOCIAL_FEED_URLS` にRSS/AtomのURLをカンマ区切りで入れると、記事と公式ソーシャルフィードが追加されます。エンドポイントは `GET /api/media?q=検索語` です。

## 批評とリスナーの評価

よく聴くアルバムごとに評価を集め、スコアに反映します。公式APIと公開データだけを使い、利用規約で自動収集を禁止しているサイト（RateYourMusic、Metacritic、AOTY、Pitchfork、コミュニティ、ウェブマガジン）は収集しません。こうしたメディアのスコアは、WikidataとWikipediaに公開でまとめられている範囲でのみ取り込まれます。

| 出典 | 取得する値 | 設定 |
| --- | --- | --- |
| MusicBrainz | アルバムの識別、発売日、コミュニティ評価 | 標準、`ACCLAIM_CONTACT` を推奨 |
| Wikidata | メディア別の批評スコア、受賞とノミネート、Wikipediaに掲載されている言語数 | 標準 |
| 英語版Wikipedia | アルバム記事の評価表（Music ratings） | 標準（CC BY-SA） |
| ListenBrainz | リスナー数 | 標準 |
| Discogs | コミュニティ評価、所有数 | `DISCOGS_TOKEN` |
| Last.fm | リスナー数、再生数 | `LASTFM_API_KEY` |

収集に必要なネットワークドメインは `musicbrainz.org`、`query.wikidata.org`、`en.wikipedia.org`、`api.listenbrainz.org` です。DiscogsとLast.fmを使う場合は、`api.discogs.com`、`ws.audioscrobbler.com` も必要です。

### 信頼度の計算

アルバムごとに根拠を合わせて、評価スコア1つと根拠の信頼度を計算します（`server/acclaim/score.js` の `combineEvidence`）。

| 根拠 | 役割 | 重み |
| --- | --- | --- |
| 批評スコア | 品質の根拠 | メディア1社で1.0、1社増えるごとに0.4を追加（最大3） |
| リスナー評価 | 品質の根拠 | 投票数に比例（20票で0.75、最大1.5） |
| 受賞、ノミネート | 品質の根拠 | 受賞は1件0.75（最大1.5）、ノミネートは1件0.3（最大0.8） |
| Wikipedia掲載言語数 | 注目度の補助 | 0.25 |
| 人気 | 注目度の補助 | 0.15 |

- 人気や注目度しかないアルバムには評価スコアをつけません。
- 販売認定（ゴールド、プラチナ）は受賞として数えません。
- 信頼度は 重みの合計 / (重みの合計 + 1.5) です。全体の信頼度が60%を下回ると、批評指標がスコアに占める割合もその分だけ減ります。
- 批評スコアのあるアルバムが再生割合の30%未満、または3枚未満の場合は、批評指標を外して残りの指標で計算します。
- キャッシュされたアルバムが増えると、メディアごとの点のつけ方の傾向を学習して基準を合わせます。参加ユーザーが30人を超えると、上位何%かも表示します。

### アルバムのマッチング

ストリーミングサービスとMusicBrainzでは、同じアルバムが違う表記になることがよくあります。正確な検索に失敗した場合は、別名まで含めてアーティストを探し（Fujii Kazeと藤井風）、そのアーティストの発売リストの中だけでタイトルを比較します。「1st Album」と「1집」、アクセント（Fantôme）、漢字の副題（LOVE YOURSELF 轉 'Tear'）、エディション表記、「Pt. 1」と「Part 1」、別の言語のタイトル（「화양연화 pt.1」と「The Most Beautiful Moment in Life, Pt.1」）は、同じアルバムとして扱います。似た候補が2つ以上ある場合は、誤って結びつけないようにマッチングしません。

収集はサーバーのバックグラウンドキューで、APIごとのリクエスト間隔を守りながら進めます。結果は、見つかったアルバムは30日、見つからなかったアルバムは7日、接続失敗は1時間キャッシュします。状態は `GET /api/acclaim/status` で確認します。

デモモードの批評スコアは画面表示用のサンプル値で、実際のメディアのスコアではありません。

## ユーザーデータ

分析結果の保存、フィードバック、アルバム評価は、ユーザーがダッシュボードで参加に同意した場合にのみ保存します。メールアドレス、名前、OAuthトークン、元の再生リストは保存しません。

- `POST /api/consent`：参加への同意
- `POST /api/feedback`：`{ targetType, targetId, rating }`。`analysis` は好みとの合致度（1～5）、`score` はスコアの体感（1 低すぎる、3 ちょうどよい、5 高すぎる）で、評価した分析結果と一緒に保存されます。
- `POST /api/ratings`：アルバム評価 `{ key, rating }`（1～10、`null` なら削除）
- `POST /api/account/disconnect`：連携の解除と保存データの削除

### アルバム評価

- 自分の評価は自分のスコアには反映されず、他の人の分析にだけ使われます。
- 直前に分析した自分の再生履歴にあるアルバムだけを、アルバムごとに1票ずつ評価できます。
- 評価は投票数に比例して反映されるため、数人の評価で結果が大きく変わることはありません。
- 公開評価が少ないアルバム（例：韓国のインディー）は、リストの上のほうに「공개 평가 적음」（公開評価が少ない）の表示つきで出ます。
- 参加の同意は、再ログインしても維持されます。Apple Musicには固定のアカウントIDがないため、ブラウザごとに署名つきのランダムIDクッキー（`ma_apple`）で区別します。クッキーを消したり別のブラウザを使ったりすると、新しいユーザーとして始まります。

### スコアの重みの学習

「점수는 어떻게 느껴지나요?」（スコアはどう感じますか？）への回答を、ユーザーが望んでいたスコアに換算し（1段階につき8点）、指標ごとの重みを調整します。`npm run learn-weights` は推奨値を出力するだけで、実際のスコアには、人が確認したうえで `server/analysis.js` の `SCORE_WEIGHTS` を修正して初めて反映されます。推奨値は、デフォルト値の±30%の範囲内でのみ動きます。

データベースは `data/music-ability.sqlite`（または `DATABASE_PATH`）に作られ、Gitには含まれません。

## セキュリティ

- セッションクッキーはHMAC署名、`HttpOnly`、`SameSite=Lax` で、HTTPS環境では `Secure` が付きます。ログインするとセッションIDを新しく発行します。
- `SESSION_SECRET` は32文字以上のランダムな値である必要があり、`NODE_ENV=production` で未設定の場合、サーバーは起動しません。
- 保存されるユーザーIDは、`USER_HASH_SECRET`（なければ `SESSION_SECRET`）で作ったHMAC値です。このキーを変えると、既存のデータとの紐づきが切れます。
- すべてのレスポンスにCSP、`X-Frame-Options`、`nosniff` などのセキュリティヘッダーを付け、POSTリクエストは同じオリジンからのみ受け付けます。
- ログイン、POST API、`/api/media` にはIPごとのリクエスト制限があります。
- Spotifyのaccess tokenは、期限が切れる前に自動で更新されます。

## デプロイ

`Dockerfile`、ヘルスチェック用のアドレス（`GET /healthz`）、終了シグナルの処理、データベースのバックアップスクリプトを用意してあります。サーバー1台と、データが保持されるディスク（ボリューム）があれば十分です。詳しい手順は[docs/DEPLOY.md](docs/DEPLOY.md)にあります。

## 技術

- Node.js組み込みのHTTPサーバーとSQLite（`node:sqlite`）、外部依存なし
- Spotify Web API、Apple MusicKit on the Web
- MusicBrainz、Wikidata、Wikipedia、ListenBrainz、Discogs、Last.fm
- HTML、CSS、JavaScript（ビルドなし）、フォントはPretendardを直接同梱
- テストはNode組み込みのtest runnerを使います。`tests/flow.test.js` は、実際のサーバーを偽のSpotifyとApple Musicにつないで、ログインから連携解除までを確認します。

## ライセンス

MIT。[LICENSE](LICENSE)を参照してください。
