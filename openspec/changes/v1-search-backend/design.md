## Context

V1 搜索能力（FR-8）的 Rust 后端：三家源并发搜索、打分去重、惰性拉取。对标 music-tag-web 的 `MusicResource` 工厂 + `smart_tag` 架构。

## Goals / Non-Goals

**Goals:**
- 统一 Trait `MusicSource`：`search(title, artist) -> Vec<SongCandidate>` + `fetch_lyric(song_id) -> Option<String>`。
- 三源并发（`tokio::join_all`）+ 6s 单源超时 + `source_stats`。
- 打分去重 + 惰性拉取 + 网易云 weapi/linuxapi 手写加密。

**Non-Goals:**
- 不做前端候选 UI（`v1-search-ui`）。
- 不做离线降级的状态判定（前端逻辑，`v1-search-ui`）。
- 不做简繁转换（PRD §7：归一化不含简繁）。

## Decisions

> **实现参照**：xhongc/music-tag-web（`applications/task/services/music_resource.py` 的 `NetEaseMusicClient`/`MiGuMusicClient`/`QmusicClient`、`applications/utils/encrypt.py` 的 `weEncrypt`/`linuxEncrypt`、`applications/task/services/qm.py` 的 `QQMusicApi`、`applications/task/utils.py` 的 `match_score`/`match_artist`）。本变更把它从 Python 移植到 Rust，接口 URL、参数、加密算法保持一致；打包（`ThreadPoolExecutor`）改为 Rust `tokio::join_all`，简繁转换（`zhconv`）按 V1 约定不做。

- **模块结构**：`src-tauri/src/search/mod.rs`（Trait + 聚合入口 + 打分）+ `netease.rs` + `qqmusic.rs` + `migu.rs`。
- **统一 Trait**：
  ```rust
  trait MusicSource {
      async fn search(&self, title: &str, artist: &str) -> Vec<SongCandidate>;
      async fn fetch_lyric(&self, song_id: &str) -> Option<String>;
  }
  ```
  `SongCandidate { source: MusicSourceId, id, title, artist, album, cover_url }`。
- **reqwest**：共享 `Client`（伪装 UA，`userAgents` 随机取一个），带 6s 超时；`download_cover` 单独 5s 超时 + 响应大小限流。

### 网易云（netease.rs）—— weapi 搜索 + linuxapi 取词

- **搜索** `fetch_id3_by_title(title)`：POST `https://music.163.com/weapi/cloudsearch/get/web`，body 为 weapi 加密的 `{ s: title, type: 1, limit: 10, offset: 0 }`。
- **取歌词** `fetch_lyric(song_id)`：POST `https://music.163.com/api/song/lyric?lv=-1&kv=-1&tv=-1`，body 为 **linuxapi** 加密的 `{ id: song_id }`（url 为 `api/linux/forward`，额外注入 `method: POST`）；取响应 `data.lrc.lyric`。
- **weapi 加密**（`weEncrypt` 移植，CBC + RSA 双层）：
  - 常量：`NONCE = b"0CoJUm6Qyw8W8jud"`，`PUBKEY = "010001"`，`MODULUS = "00e0b509f6...e289dc6935b3ece0462db0a22b8e7"`（256 hex，同参照库）。
  - `secret = 随机16字节`（`hexlify(urandom(16))[:16]`）。
  - 第一层 AES-CBC：`aes(json(text), NONCE, iv=b"0102030405060708", base64)`；第二层 AES-CBC：`aes(第一层结果, secret, 同 iv, base64)` → `params`。
  - `encSecKey`：RSA——`rsa(secret, PUBKEY, MODULUS)`：secret 反转 → `pow(int(hexlify(secret),16), int(PUBKEY,16), int(MODULUS,16))` → hex 左补零到 256 位。
  - 返回 `{ params, encSecKey }`，表单编码提交。**注意**：CBC 用 PKCS7 padding，AES 用 ECB 变体（无 iv 时 hex 大写）。
- **linuxapi 加密**（`linuxEncrypt`）：`aes(text, LINUXKEY=b"rFgB&h#%2?^eDg:Q", ECB)` → hex 大写 → `{ eparams }`。
- **响应解析**：搜索取 `result.songs[]`，每首映射 `id`、`name`、`ar[].name`（逗号连接为 artist）、`al.name`（album）、`al.picUrl`（cover_url）；`publishTime` → 年份。

### QQ 音乐（qqmusic.rs）—— musicu.fcg 协议

- **搜索** `getQQMusicSearch(key)`：POST `https://u.y.qq.com/cgi-bin/musicu.fcg`，JSON body（`getHttp2Json`）：
  ```json
  {
    "comm": { "wid":"", "tmeAppID":"qqmusic", "authst":"", "uid":"", "gray":"0",
              "OpenUDID":"2d484d3157d4ed482e406e6c5fdcf8c3d3275deb", "ct":"6", "patch":"2",
              "psrf_qqopenid":"", "sid":"", "psrf_access_token_expiresAt":"", "cv":"80600",
              "gzip":"0", "qq":"", "nettype":"2", "psrf_qqunionid":"", "psrf_qqaccess_token":"",
              "tmeLoginType":"2" },
    "music.search.SearchCgiService.DoSearchForQQMusicDesktop": {
      "module": "music.search.SearchCgiService", "method": "DoSearchForQQMusicDesktop",
      "param": { "num_per_page": 15, "page_num": 1, "remoteplace":"txt.mac.search",
                 "search_type": 0, "query": key, "grp": 1,
                 "searchid": "<uuid>", "nqc_flag": 0 }
    }
  }
  ```
  - 请求头：`Referer: https://y.qq.com/portal/profile.html`、`Content-Type: application/json;charset=utf-8`、`User-Agent: QQ音乐/73222 CFNetwork/1406.0.3 Darwin/22.4.0`（URL 编码）。
- **取歌词** `getQQMusicMediaLyric(mid)`：GET `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?g_tk=5381&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=h5&needNewCode=1&ct=121&cv=0&songmid=<mid>`；响应 `lyric` 字段为 **base64**，解码 `utf-8` 得歌词文本。
- **响应解析**：搜索取 `music.search.SearchCgiService.DoSearchForQQMusicDesktop.data.body.song.list[]`；每首映射 `id`（数字）、`mid`（作为候选 `id` 传给 fetch_lyric）、`title`（name）、`singer[].name` 逗号连接（artist）、`album.title`（album，空 → `未分类专辑`）、封面 `album_img = QQMUSIC_SONG_COVER.format(album.mid)` = `http://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg`。
- 纯 HTTP 无加密。

### 咪咕（migu.rs）—— scr_search_tag

- **搜索** `fetch_id3_by_title(title)`：GET `https://m.music.migu.cn/migu/remoting/scr_search_tag?rows=10&type=2&keyword={title}&pgc=1`。
  - 请求头：`User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:80.0) Gecko/20100101 Firefox/80.0`、`Referer: https://m.music.migu.cn/`。
- **取歌词** `fetch_lyric(copyrightId)`：GET `https://music.migu.cn/v3/api/music/audioPlayer/getLyric?copyrightId={song_id}`，响应 `lyric` 字段为歌词文本。
- **响应解析**：搜索取 `musics[]`；每首映射 `id = copyrightId`（传给 fetch_lyric）、`name = songName`、`artist = singerName`、`album = albumName`、`cover_url = cover`、`year = ""`。
- 纯 HTTP 无加密。

### 打分去重（mod.rs）

- **打分**（对标 `match_score`/`match_artist`，权重按 V1-PRD §7 收敛）：
  - `match_score(a, b)`：双方 `to_lowercase` + 去空格；全等 → 2；互相包含 → 1；否则 0。（V1 不做简繁 `zhconv`。）
  - `match_artist(a, b)`：b 含逗号 → 对 `b.split(',')[0]`、`[1]` 各算一次 `match_score` 求和；否则单次 `match_score`。
  - 总分 = `title_score + artist_score + album_score`；`artist` 非空且 artist_score==0 → 该项 -2；`artist` 为空且 artist_score≥1 且 title_score≥1 → title_score 提升为 2。
- **聚合**：三源结果合并 → 每首打分 → 过滤 title_score==0 → 按 score 降序 → 去重（归一化 `(title, artist)`，全角半角折叠）保留最高分 → 前 N（如 10）条。
- **`search_song(title, artist) -> SearchResult`**：`tokio::join_all` 三源 → 打分去重 → 前 N；`source_stats: Vec<(MusicSourceId, usize)>`（各家返回条数，供离线降级判定）。
- **`fetch_lyric(source, id)`**：单源取歌词，None 表失败/无词（支撑 C2 前端换源）。
- **`download_cover(url) -> Vec<u8>`**：下载封面 bytes，限流 + 超时；失败返回 Err（前端静默忽略该张候选，FR-8 验收 #12）。

## Risks / Trade-offs

- 网易云接口与加密会随平台变动失效：封装在 `netease.rs`，失效时单源降级不影响其余两家。
- 各家接口返回结构各异：serde 解析各自 model，统一映射为 `SongCandidate`。
- 加密算法手写需严格测试（已知向量/往返），保证与官方 weapi 兼容。
