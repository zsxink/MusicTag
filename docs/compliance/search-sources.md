# 搜索源合规记录（网易云 / QQ 音乐 / 酷狗 / LRCLIB / iTunes）

> 本文档按 compliance-disclosure「逐源合规记录」要求，逐一记录五个歌词/封面搜索源的接口调用方式、
> 发送字段、返回内容用途边界、公开条款或接口文档链接与当前处理决定（Issue #166）。

## 记录口径（先读）

- 本文档**仅整理自公开资料**（官方开放平台页面、web 端公开接口行为实测、社区公开文档），**不构成法律意见**；法律结论以法律顾问审阅为准。
- **核实状态口径**：
  - 「官方文档」= 链接指向官方公开发布的文档渠道；
  - 「公开资料整理」= 依据 web 端公开接口行为与社区资料整理，**无官方书面授权或接口协议**；
  - 链接与条款内容以 2026-10 整理时点为准，后续可能变动，引用前应重新核实。
- **发送字段（五源一致）**：搜索仅发送歌曲标题、歌手、专辑名的文本查询词；取词/封面下载仅发送候选 id 或派生的资源 URL。**不发送本地音频内容，不发送本地文件路径**；请求全部使用 HTTPS（search-sources「生产请求传输加密」）。
- **返回内容用途边界（五源一致）**：候选仅在候选区展示；用户手动点选才填入表单；保存时歌词嵌入本地文件（可同时导出 `.lrc`）、封面嵌入本地文件；**不下载、不提供任何音频文件**。候选不落盘，切歌即弃。
- 已知限制：网易云 / QQ 音乐 / 酷狗所用接口为 web 端公开行为，无公开 SLA，可能随平台改版失效或下架——由既有单源降级语义兜底（单源 6s 超时降级、全源失败会话离线降级）；LRCLIB 与 Apple Search API 为官方公开文档化接口。平台下架或拒绝时的处置预案见「未决事项」。

## 网易云

| 项 | 记录 |
|---|---|
| 接口域名与调用方式 | `music.163.com`。搜索：`POST https://music.163.com/api/linux/forward`（linuxapi 加密转发，payload 内目标 `https://music.163.com/api/cloudsearch/pc`）；歌词：同通道转发 `https://music.163.com/api/song/lyric`（按候选歌曲 id 取词） |
| 发送字段 | 歌曲标题、歌手、专辑名（拼查询词）；取词仅发候选 id |
| 返回内容用途 | 候选（歌名/歌手/专辑/封面 URL）展示；歌词点选后填入表单、保存时嵌入本地文件（可导出 `.lrc`）；封面 URL 点选后下载嵌入。响应内 `picUrl` 为 `http://` 时升级为 `https://` 使用（防御保留） |
| 公开条款或接口文档链接 | 网易云音乐开放平台 https://d.music.163.com/open-platform ；官网服务条款见 https://music.163.com 页脚入口 |
| 核实状态 | 公开资料整理（linuxapi 转发接口无官方公开授权文档）；链接为官方渠道 |
| 当前处理决定 | 仅用于元数据检索；不下载音频；接口使用授权确认列入「未决事项」#3 |

## QQ 音乐

| 项 | 记录 |
|---|---|
| 接口域名与调用方式 | `c.y.qq.com`。搜索：`GET https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp`；歌词：`GET https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg`（按候选歌曲 mid 取词）；封面：按候选 `albumMid` 派生 `https://y.qq.com/music/photo_new/T002R300x300M000<albumMid>.jpg` |
| 发送字段 | 歌曲标题、歌手、专辑名（拼查询词）；取词仅发候选 mid |
| 返回内容用途 | 候选展示；歌词点选后填入/嵌入/导出 `.lrc`；派生封面 URL 点选后下载嵌入。无明文 HTTP 端点 |
| 公开条款或接口文档链接 | QQ 音乐官网 https://y.qq.com （服务条款经官网页脚入口）；所用搜索接口无公开发布的官方接口文档 |
| 核实状态 | 公开资料整理（web 公开接口行为实测，无官方接口文档） |
| 当前处理决定 | 仅用于元数据检索；不下载音频；接口使用授权确认列入「未决事项」#3 |

## 酷狗

| 项 | 记录 |
|---|---|
| 接口域名与调用方式 | `complexsearch.kugou.com` + `lyrics.kugou.com`。搜索：`GET https://complexsearch.kugou.com/v2/search/song`（query 字母序拼接、secret 前后包裹做 MD5 签名）；歌词两步：`GET https://lyrics.kugou.com/search` 拿 `id`+`accesskey` → `GET https://lyrics.kugou.com/download` 取 base64 LRC。**三端点默认均为 HTTPS（2026-10-24 实测均可连通）** |
| 发送字段 | 歌曲标题、歌手、专辑名（拼查询词）；取词仅发候选 FileHash |
| 返回内容用途 | 候选展示；歌词点选后填入/嵌入/导出 `.lrc`；响应 `Image` 字段派生封面 URL（`{size}`→480、`http://`→`https://` 升级防御保留；`singerimg.kugou.com` 歌手头像域条目视为无封面），点选后下载嵌入 |
| 公开条款或接口文档链接 | 酷狗音乐开放平台 https://open.kugou.com ；官网条款见 https://www.kugou.com 页脚入口 |
| 核实状态 | 公开资料整理（签名搜索接口无官方公开授权文档；端点 HTTPS 为实测事实） |
| 当前处理决定 | 仅用于元数据检索；不下载音频；接口使用授权确认列入「未决事项」#3 |

## LRCLIB

| 项 | 记录 |
|---|---|
| 接口域名与调用方式 | `lrclib.net`。歌词搜索：`GET https://lrclib.net/api/search`；歌词获取：`GET https://lrclib.net/api/get`。零鉴权、零签名 |
| 发送字段 | `track_name` / `artist_name` / `album_name` 分参数文本（即歌名、歌手、专辑名） |
| 返回内容用途 | 歌词候选展示；点选后填入表单、保存时嵌入本地文件、可导出 `.lrc`。该源不返回封面 |
| 公开条款或接口文档链接 | LRCLIB 官网 https://lrclib.net （API 文档 https://lrclib.net/docs ；开源项目，联络途径经其 GitHub 仓库 issue） |
| 核实状态 | 官方文档（接口由项目公开文档化） |
| 当前处理决定 | 仅用于歌词元数据检索；不下载音频 |

## iTunes

| 项 | 记录 |
|---|---|
| 接口域名与调用方式 | `itunes.apple.com`。搜索：`GET https://itunes.apple.com/search`（零鉴权；`country=HK` 与 `country=US` 双店面并发，合并后由打分定序）；封面：候选 `artworkUrl100` 将 `100x100bb` 模板替换为 `600x600bb` |
| 发送字段 | 歌曲标题、歌手、专辑名（`term` 查询词）与店面参数 |
| 返回内容用途 | 候选展示（HK 店面取中文原曲、US 店面取西方规范艺名）；派生封面 URL（`mzstatic.com` 图片域）点选后下载嵌入；该源不返回歌词 |
| 公开条款或接口文档链接 | Apple iTunes Search API 官方文档 https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/ ；Apple Media Services 条款 https://developer.apple.com/terms/ |
| 核实状态 | 官方文档（Search API 由 Apple 公开发布；封面下载指向 mzstatic 图片域） |
| 当前处理决定 | 仅用于元数据检索；不下载音频 |

## 第三方依赖与素材归属清单

第三方依赖与内嵌素材的归属清单由 `scripts/generate-third-party-notices.mjs` 生成于仓库根
`THIRD-PARTY-NOTICES.md`（覆盖 Cargo 依赖闭包、npm 运行时依赖闭包、npm 构建工具链与内嵌素材），
经 `src-tauri/tauri.conf.json` 的 `bundle.resources` 随应用安装包分发；清单在 .app 包内的实际落点
（`../` 相对路径可能带 `_up_/` 前缀）以打包验证（5.4）实测记录为准。

## 未决事项（待完成，未决 ≠ 已完成）

以下事项**不在本 change 工程范围之内**、尚未完成，单独记录以便跟踪；任何一项完成前，
本记录与发行物均**不得**被引用为「已获授权」或「已完成法律审查」。

| # | 事项 | 负责方 |
|---|---|---|
| 1 | 确认软件发行地区与分发渠道（影响各平台条款的适用范围与合规口径） | 用户 |
| 2 | 法律顾问审阅 `LICENSE` / `README` / EULA 弹窗文案与本文档（自定义个人学习许可为工程自洽整理，未经法律审查） | 用户 + 法律顾问 |
| 3 | 平台接口使用授权确认：网易云 linuxapi 转发接口与酷狗 MD5 签名搜索接口均无官方公开授权文档，需逐平台确认使用授权或确定替代方案 | 用户 + 法律顾问 |
| 4 | 无明确授权来源的处置预案：若某平台明确拒绝此类调用，制定下架该源或更换官方授权接口的预案（含发版节奏与用户提示） | 用户 |
