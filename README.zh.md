# Music Ability

[한국어](README.md) | [English](README.en.md) | [日本語](README.ja.md) | 中文

这是一个根据 Spotify 和 Apple Music 的收听记录分析音乐品味的 Web 应用。它汇总你收听的流派有多广、听得有多深、多常主动去听新艺人，以及你听的专辑得到了乐评人和听众怎样的评价，并以可解释的“音乐力”分数呈现出来。

分数反映的是收听习惯，不代表音乐水平，也没有高低之分。

目前还不是公开服务，仍在开发中。部署所需的材料已经准备好（[部署说明（韩语）](docs/DEPLOY.md)）。

## 主要功能

- Spotify 登录（OAuth）、Apple Music 登录（MusicKit on the Web）
- 无需登录即可查看的演示模式
- 流派占比和细分流派、常听的艺人和曲目
- 7 项音乐力指标：流派多样性、欣赏深度、发现倾向、品味扩展性、新专辑敏感度、乐评感觉、冷门佳作挖掘
- 每张专辑的乐评分数、获奖记录、听众评分和依据可信度
- 同意参与的用户给出的专辑评分（满分 10 分）
- 询问分析是否准确、分数是否合适的反馈

## 运行

需要 Node.js 24 或更高版本。没有依赖安装和构建步骤。

```bash
npm start
```

在浏览器中打开 `http://localhost:3003`。没有 Spotify 密钥时，也可以在 `http://localhost:3003/dashboard.html?demo=1` 查看演示页面。

| 命令 | 作用 |
| --- | --- |
| `npm start` | 启动服务器 |
| `npm run check` | 检查服务器和浏览器代码的语法 |
| `npm test` | 单元测试和完整登录流程测试 |
| `npm run probe -- "Frank Ocean" "Blonde"` | 用真实 API 采集一张专辑，按来源输出结果（不使用缓存） |
| `npm run learn-weights` | 根据分数反馈输出推荐权重（需要至少 50 条回答） |
| `npm run backup` | 将 SQLite 数据库复制到 `data/backups` |

## 配置

复制 `.env.example`，在项目根目录创建 `.env`。不要把 `.env` 提交到 Git。

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

1. 在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 创建应用。
2. 将 `http://localhost:3003/callback` 注册为 Redirect URI。
3. 把 Client ID 和 Secret 填入 `.env`，然后重启服务器。

开发模式的应用只有在控制台中登记过的用户才能登录。允许的人数和正式审批条件请查看 Spotify 的政策。

### Apple Music

在 Apple Developer 账号中签发 MusicKit developer token，填入 `APPLE_MUSICKIT_DEVELOPER_TOKEN`。用户批准登录后，会通过 Music User Token 获取最近播放的歌曲。不会保存用户令牌。

MusicKit JS 需要在浏览器中使用 developer token，所以它会通过 `/api/status` 公开。签发时请设置较短的有效期，并加入 `origin` 声明。

### YouTube Music

YouTube Data API 不提供 YouTube Music 的个人收听记录。因此目前只提示为准备中，不使用非官方的抓取方式。

### 音乐资讯 Feed

填入 `YOUTUBE_API_KEY` 后，会显示官方的 YouTube 搜索结果。在 `NEWS_RSS_URLS` 和 `SOCIAL_FEED_URLS` 中用逗号填入 RSS/Atom 地址，就会加入文章和官方社交媒体 Feed。接口为 `GET /api/media?q=搜索词`。

## 乐评与听众评价

为经常收听的每张专辑收集评价，并计入分数。只使用官方 API 和公开数据，不采集用户协议禁止自动采集的网站（RateYourMusic、Metacritic、AOTY、Pitchfork、社区、网络杂志）。这些媒体的分数只会按 Wikidata 和维基百科上公开整理的范围纳入。

| 来源 | 获取的值 | 设置 |
| --- | --- | --- |
| MusicBrainz | 专辑识别、发行日期、社区评分 | 默认，建议设置 `ACCLAIM_CONTACT` |
| Wikidata | 各媒体的乐评分数、获奖和提名、维基百科收录的语言数 | 默认 |
| 英文维基百科 | 专辑条目中的评分表（Music ratings） | 默认（CC BY-SA） |
| ListenBrainz | 听众数 | 默认 |
| Discogs | 社区评分、收藏数 | `DISCOGS_TOKEN` |
| Last.fm | 听众数、播放数 | `LASTFM_API_KEY` |

采集所需的网络域名是 `musicbrainz.org`、`query.wikidata.org`、`en.wikipedia.org`、`api.listenbrainz.org`。如果使用 Discogs 和 Last.fm，还需要 `api.discogs.com`、`ws.audioscrobbler.com`。

### 可信度计算

为每张专辑合并各项依据，计算出一个评价分数和依据可信度（`server/acclaim/score.js` 中的 `combineEvidence`）。

| 依据 | 作用 | 权重 |
| --- | --- | --- |
| 乐评分数 | 质量依据 | 1 家媒体为 1.0，每多 1 家加 0.4（最多 3） |
| 听众评分 | 质量依据 | 与投票数成正比（20 票为 0.75，最多 1.5） |
| 获奖、提名 | 质量依据 | 每个奖项 0.75（最多 1.5），每个提名 0.3（最多 0.8） |
| 维基百科收录语言数 | 关注度辅助 | 0.25 |
| 受欢迎程度 | 关注度辅助 | 0.15 |

- 只有受欢迎程度或关注度的专辑不给评价分数。
- 销量认证（金唱片、白金唱片）不算作获奖。
- 可信度为 权重之和 / (权重之和 + 1.5)。整体可信度低于 60% 时，乐评指标在分数中所占的比重也会相应降低。
- 如果有乐评分数的专辑占收听比重不足 30%，或者少于 3 张，就去掉乐评指标，用其余指标计算。
- 缓存的专辑积累起来后，会学习各媒体打分的倾向并调整基准。参与用户超过 30 人后，还会显示处于前百分之几。

### 专辑匹配

流媒体服务和 MusicBrainz 经常用不同的写法记录同一张专辑。如果精确搜索失败，就连别名一起查找艺人（Fujii Kaze 和 藤井風），并且只在该艺人的发行列表中比较标题。“1st Album”和“1집”、重音符号（Fantôme）、汉字副标题（LOVE YOURSELF 轉 'Tear'）、版本标注、“Pt. 1”和“Part 1”、其他语言的标题（“화양연화 pt.1”和“The Most Beautiful Moment in Life, Pt.1”）都会被视为同一张专辑。如果有两个或更多相似的候选，为避免匹配错误就不做匹配。

采集在服务器的后台队列中进行，并遵守每个 API 的请求间隔。结果的缓存时间为：找到的专辑 30 天，没找到的专辑 7 天，连接失败 1 小时。可通过 `GET /api/acclaim/status` 查看状态。

演示模式中的乐评分数是用于页面展示的示例值，不是真实的媒体分数。

## 用户数据

分析结果、反馈和专辑评分，只有在用户于控制台同意参与后才会保存。不会保存邮箱、姓名、OAuth 令牌和原始收听列表。

- `POST /api/consent`：同意参与
- `POST /api/feedback`：`{ targetType, targetId, rating }`。`analysis` 表示与品味的吻合程度（1 到 5），`score` 表示对分数的感受（1 太低，3 合适，5 太高），会和被评价的分析结果一起保存。
- `POST /api/ratings`：专辑评分 `{ key, rating }`（1 到 10，`null` 表示删除）
- `POST /api/account/disconnect`：解除连接并删除已保存的数据

### 专辑评分

- 你的评分不会计入你自己的分数，只用于其他人的分析。
- 只能给刚刚分析的自己收听记录中的专辑评分，每张专辑一票。
- 评分按投票数成比例计入，所以几个人的评分不会让结果发生很大变化。
- 公开评价较少的专辑（例如韩国独立音乐）会带着“공개 평가 적음”（公开评价少）的标记显示在列表靠前的位置。
- 参与同意在重新登录后仍然有效。Apple Music 没有固定的账号 ID，所以按浏览器用带签名的随机 ID Cookie（`ma_apple`）来区分。清除 Cookie 或换用其他浏览器，就会作为新用户开始。

### 分数权重学习

把“점수는 어떻게 느껴지나요?”（你觉得分数怎么样？）的回答换算成用户想要的分数（每一档 8 分），据此调整各指标的权重。`npm run learn-weights` 只输出推荐值，要体现到实际分数中，需要由人审核后修改 `server/analysis.js` 中的 `SCORE_WEIGHTS`。推荐值只会在默认值的 ±30% 范围内变动。

数据库创建在 `data/music-ability.sqlite`（或 `DATABASE_PATH`），不会包含在 Git 中。

## 安全

- 会话 Cookie 使用 HMAC 签名，带有 `HttpOnly` 和 `SameSite=Lax`，在 HTTPS 环境下还会加上 `Secure`。登录时会重新签发会话 ID。
- `SESSION_SECRET` 必须是 32 个字符以上的随机值，在 `NODE_ENV=production` 下如果没有设置，服务器不会启动。
- 保存的用户 ID 是用 `USER_HASH_SECRET`（没有则用 `SESSION_SECRET`）生成的 HMAC 值。更换这个密钥后，就无法再与已有数据关联。
- 所有响应都带有 CSP、`X-Frame-Options`、`nosniff` 等安全头，POST 请求只接受同源请求。
- 登录、POST API 和 `/api/media` 都有按 IP 的请求限制。
- Spotify 的 access token 会在过期前自动刷新。

## 部署

已经准备好 `Dockerfile`、健康检查地址（`GET /healthz`）、终止信号处理和数据库备份脚本。一台服务器加一块能保留数据的磁盘（卷）就足够了。详细步骤见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 技术

- Node.js 内置 HTTP 服务器和 SQLite（`node:sqlite`），没有外部依赖
- Spotify Web API、Apple MusicKit on the Web
- MusicBrainz、Wikidata、Wikipedia、ListenBrainz、Discogs、Last.fm
- HTML、CSS、JavaScript（无需构建），字体直接内置 Pretendard
- 测试使用 Node 内置的 test runner。`tests/flow.test.js` 会把真实服务器连接到模拟的 Spotify 和 Apple Music，检查从登录到解除连接的全过程。

## 许可证

MIT。请参阅 [LICENSE](LICENSE)。
