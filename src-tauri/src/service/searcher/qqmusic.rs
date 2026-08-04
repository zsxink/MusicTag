// MusicTag — QQ 音乐客户端（musicu.fcg 搜索 + fcg_query_lyric_new 取词，design.md D2 / D5）。
//
// 接口逐字对照 music-tag-web 的 QmusicClient / qm.py（纯 HTTP 无加密）：
// - 搜索：POST `u.y.qq.com/cgi-bin/musicu.fcg`，JSON body `comm` + `music.search.SearchCgiService.DoSearchForQQMusicDesktop`
//   → 解析 `data.<key>.data.body.song.list[]`；
// - 取词：GET `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=<mid>`，响应 `lyric` 字段 **base64** → utf-8。
// UA 覆盖为 `QQ音乐/73222 CFNetwork/1406.0.3 Darwin/22.4.0` + Referer（design.md D2）。
// 单源失败一律降级为空列表 / None。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::MusicSource;
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

pub struct QqMusic;

/// QQ 音乐 UA（design.md D2 覆盖值）与 Referer。
const QQ_UA: &str = "QQ音乐/73222 CFNetwork/1406.0.3 Darwin/22.4.0";
const QQ_REFERER: &str = "https://y.qq.com/portal/profile.html";

/// musicu.fcg 请求/响应内的模块 key（design.md：`comm` + DoSearchForQQMusicDesktop）。
const MODULE_KEY: &str = "music.search.SearchCgiService.DoSearchForQQMusicDesktop";

const SEARCH_URL: &str = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const LYRIC_URL_BASE: &str = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";

#[async_trait]
impl MusicSource for QqMusic {
    fn id(&self) -> MusicSourceId {
        MusicSourceId::QqMusic
    }

    async fn search(
        &self,
        client: &reqwest::Client,
        title: &str,
        _artist: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        // 参数对齐参照库：`comm.ct=19` + 无 `grp`（实测 ct=24/grp=1 返回空列表但 estimate_sum>0，
        // 属参数结构不对；ct=19 正常返回结果）。
        let body = serde_json::json!({
            "comm": {"ct": 19, "cv": 0},
            MODULE_KEY: {
                "method": "DoSearchForQQMusicDesktop",
                "module": "music.search.SearchCgiService",
                "param": {"num_per_page": 10, "page_num": 1, "query": title, "search_type": 0},
            },
        });
        let resp = match client
            .post(SEARCH_URL)
            .header("User-Agent", QQ_UA)
            .header("Referer", QQ_REFERER)
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("QQ 音乐搜索请求失败: {e}")),
        };
        let json: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("QQ 音乐搜索响应解析失败: {e}")),
        };
        Ok(parse_search_response(&json))
    }

    async fn fetch_lyric(&self, client: &reqwest::Client, id: &str) -> Option<String> {
        // fcg_query_lyric_new：`songmid=<mid>`（候选 id 即 mid），`lyric` 字段 base64。
        let url = format!(
            "{LYRIC_URL_BASE}?g_tk=5381&format=json&platform=yqq&needNewCode=0&inCharset=utf8&outCharset=utf-8&notice=0&loginUin=0&hostUin=0&songmid={id}"
        );
        let resp = client
            .get(&url)
            .header("User-Agent", QQ_UA)
            .header("Referer", QQ_REFERER)
            .send()
            .await
            .ok()?;
        let text = resp.text().await.ok()?;
        let json: serde_json::Value = serde_json::from_str(&text).ok()?;
        parse_lyric_response(&json)
    }
}

/// 解析 musicu.fcg 搜索响应 `data.<key>.data.body.song.list[]` → 候选。
///
/// 映射（design.md 任务 3.1）：`mid` → id（取歌词用 songmid）；`title`；
/// `singer[].name` → artist（逗号连接）；`album.title` → album（空 → `未分类专辑`）；
/// `album.mid` → 封面模板 `T002R300x300M000{album_mid}.jpg`。
fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
    let list = match json["data"][MODULE_KEY]["data"]["body"]["song"]["list"].as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    list.iter()
        .map(|s| SongCandidate {
            source: MusicSourceId::QqMusic,
            id: s["mid"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| s["id"].as_i64().map(|v| v.to_string()).unwrap_or_default()),
            title: s["title"].as_str().unwrap_or_default().to_string(),
            artist: s["singer"]
                .as_array()
                .map(|ss| {
                    ss.iter()
                        .filter_map(|x| x["name"].as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default(),
            album: {
                let album = s["album"]["title"].as_str().unwrap_or_default();
                if album.is_empty() {
                    "未分类专辑"
                } else {
                    album
                }
            }
            .to_string(),
            cover_url: s["album"]["mid"]
                .as_str()
                .map(|mid| format!("https://y.qq.com/music/photo_new/T002R300x300M000{mid}.jpg")),
        })
        .collect()
}

/// 解析 fcg_query_lyric_new 响应：`lyric` 字段 base64 → utf-8 文本（空/解码失败 → None）。
fn parse_lyric_response(json: &serde_json::Value) -> Option<String> {
    let b64 = json["lyric"].as_str()?;
    if b64.trim().is_empty() {
        return None;
    }
    let bytes = BASE64.decode(b64.trim()).ok()?;
    let lyric = String::from_utf8(bytes).ok()?;
    if lyric.trim().is_empty() {
        None
    } else {
        Some(lyric)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_response_full_fields() {
        let json = serde_json::json!({
            "code": 0,
            "data": {
                MODULE_KEY: {
                    "code": 0,
                    "data": {
                        "body": {
                            "song": {
                                "list": [{
                                    "id": 265113483,
                                    "mid": "004D3pK90wGyM2",
                                    "title": "晴天",
                                    "singer": [{"name": "周杰伦"}],
                                    "album": {"title": "叶惠美", "mid": "003OUlho2HcRHC"}
                                }]
                            }
                        }
                    }
                }
            }
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs.len(), 1);
        let s = &songs[0];
        assert_eq!(s.source, MusicSourceId::QqMusic);
        assert_eq!(
            s.id, "004D3pK90wGyM2",
            "候选 id 应为 mid（取歌词用 songmid）"
        );
        assert_eq!(s.title, "晴天");
        assert_eq!(s.artist, "周杰伦");
        assert_eq!(s.album, "叶惠美");
        assert_eq!(
            s.cover_url.as_deref(),
            Some("https://y.qq.com/music/photo_new/T002R300x300M000003OUlho2HcRHC.jpg")
        );
    }

    #[test]
    fn parses_search_response_multiple_singers_comma_joined() {
        let json = serde_json::json!({
            "data": { MODULE_KEY: {"data": {"body": {"song": {"list": [{
                "mid": "m1", "title": "t",
                "singer": [{"name": "A"}, {"name": "B"}],
                "album": {"title": "al", "mid": ""}
            }]}}}}}
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].artist, "A, B");
    }

    #[test]
    fn parses_search_response_empty_album_falls_back_to_uncategorized() {
        // album.title 空 → `未分类专辑`；album.mid 空 → cover_url None
        let json = serde_json::json!({
            "data": { MODULE_KEY: {"data": {"body": {"song": {"list": [{
                "mid": "m1", "title": "t", "singer": [], "album": {}
            }]}}}}}
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].album, "未分类专辑");
        assert_eq!(songs[0].cover_url, None);
        assert_eq!(songs[0].artist, "");
    }

    #[test]
    fn parses_search_response_falls_back_to_numeric_id_when_mid_missing() {
        let json = serde_json::json!({
            "data": { MODULE_KEY: {"data": {"body": {"song": {"list": [{
                "id": 265113483, "title": "t", "singer": [], "album": {}
            }]}}}}}
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].id, "265113483");
    }

    #[test]
    fn parses_search_response_missing_list_returns_empty() {
        assert!(parse_search_response(&serde_json::json!({"data": {}})).is_empty());
        assert!(parse_search_response(&serde_json::json!({"code": -1})).is_empty());
    }

    #[test]
    fn parses_lyric_response_base64_decodes_utf8() {
        let text = "[00:00.00]作词：方文山\n[00:01.00]晴天\n";
        let b64 = BASE64.encode(text);
        let json = serde_json::json!({"retcode": 0, "songmid": "004D3pK90wGyM2", "lyric": b64});
        assert_eq!(parse_lyric_response(&json).as_deref(), Some(text));
    }

    #[test]
    fn parses_lyric_response_missing_or_empty_returns_none() {
        // 空 lyric / 缺失 / 坏 base64 → None（C2 换源）
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"lyric": ""})),
            None
        );
        assert_eq!(parse_lyric_response(&serde_json::json!({})), None);
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"lyric": "@@@not-base64@@@"})),
            None
        );
    }
}
