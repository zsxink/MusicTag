## MODIFIED Requirements

### Requirement: 酷狗签名搜索
酷狗源 SHALL 用 `https://complexsearch.kugou.com/v2/search/song` + MD5 签名（`NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt` secret 包裹参数字符串），返回候选含 `fileHash` 供后续取 KRC 歌词，并 SHALL 从响应既有 `Image` 字段派生封面 URL：`{size}` 字面占位符替换为 `480`、`http://` 升为 `https://`；host 为 `singerimg.kugou.com`（歌手头像）的条目 SHALL 视为无封面（`cover_url = None`）。签名纯 Rust 实现（`md5` 依赖），无 JS 引擎。酷狗歌词搜索与下载 SHALL 默认使用 `https://lyrics.kugou.com/search` 与 `https://lyrics.kugou.com/download`，不再以明文 HTTP 作为默认端点；既有「`http://` → `https://` 升级」逻辑保留为对响应内 URL 的防御性处理。

#### Scenario: 签名搜索
- **WHEN** 调用酷狗搜索
- **THEN** 用 MD5 签名参数请求 HTTPS 搜索端点，正常返回候选列表

#### Scenario: 签名错误降级
- **WHEN** 签名无效被拒（`error_code:20006`）
- **THEN** 该源计为失败、降级为空列表，不影响其余源

#### Scenario: 封面 URL 派生
- **WHEN** 候选条目含 `Image` = `http://imge.kugou.com/stdmusic/{size}/...jpg`
- **THEN** `cover_url` = `https://imge.kugou.com/stdmusic/480/...jpg`（占位符替换 + https 升级），可被封面候选网格展示与点选下载

#### Scenario: 歌手头像不入封面候选
- **WHEN** 候选条目 `Image` 指向 `singerimg.kugou.com`（歌手头像）
- **THEN** 该条 `cover_url = None`，不进入封面候选

#### Scenario: 无封面字段
- **WHEN** 候选条目 `Image` 缺失或为空
- **THEN** `cover_url = None`（与既有缺省行为一致），歌词候选不受影响

#### Scenario: 默认端点全为 HTTPS
- **WHEN** 检查酷狗源默认配置（搜索、歌词搜索、歌词下载）
- **THEN** 三个默认端点均为 `https://`，不存在明文 HTTP 默认端点

## ADDED Requirements

### Requirement: 生产请求传输加密
五源（网易云、QQ 音乐、酷狗、LRCLIB、iTunes）的搜索、取词、封面下载生产网络请求 SHALL 使用 HTTPS；代码中 SHALL NOT 存在以明文 `http://` 配置的搜索、歌词或封面下载端点。对远端响应中派生的资源 URL（如封面地址）SHALL 在使用前将 `http://` 升级为 `https://`。

#### Scenario: 全源端点加密
- **WHEN** 审查五源代码中的默认端点配置
- **THEN** 所有搜索、取词、封面下载默认端点均为 HTTPS，无明文 HTTP 端点

#### Scenario: 响应内 URL 升级
- **WHEN** 远端响应返回 `http://` 的资源地址（如网易云 `picUrl`、酷狗 `Image`）
- **THEN** 使用前升级为 `https://`（既有防御逻辑保持）
