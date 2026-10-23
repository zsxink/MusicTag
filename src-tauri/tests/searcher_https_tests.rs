// MusicTag — 五源端点传输加密结构守卫（search-sources ADDED「生产请求传输加密」，Issue #166）。
//
// 与既有 searcher_kugou_tests.rs 分文件：HTTPS 是跨五源的结构守卫，不属酷狗单域；
// production `src/` 零 `#[cfg(test)]`，本文件按 rust-tests-separation 惯例外置 tests/。
// 两用例：
// - `kugou_default_endpoints_are_https`：`Kugou::default()` 三默认端点（搜索、歌词搜索、歌词下载）
//   均以 `https://` 开头（spec 场景「默认端点全为 HTTPS」）；
// - `searcher_sources_have_no_plaintext_http_endpoints`：扫描 `src/service/searcher/*.rs` 全部源码，
//   含 `"http://` 字面量的行只允许出现在响应内 URL 的防御性升级调用里（`strip_prefix(`/`replace(`），
//   且命中文件白名单仅 kugou.rs（封面 `Image` 升级）与 netease.rs（`picUrl` 升级）——
//   任何新增明文 HTTP 端点、或删掉升级防御，都会在此红灯（spec 场景「全源端点加密」「响应内 URL 升级」）。

use std::fs;
use std::path::PathBuf;

use app_lib::service::searcher::kugou::Kugou;

#[test]
fn kugou_default_endpoints_are_https() {
    let kugou = Kugou::default();
    for (name, url) in [
        ("search_url", &kugou.search_url),
        ("lyric_search_url", &kugou.lyric_search_url),
        ("lyric_download_url", &kugou.lyric_download_url),
    ] {
        assert!(
            url.starts_with("https://"),
            "酷狗默认端点 {name} 不是 HTTPS: {url}"
        );
    }
}

/// 一处 `"http://` 字面量命中：文件名 + 行号 + 行内容（trim 后）。
struct HttpLiteralHit {
    file: String,
    line: usize,
    text: String,
}

/// 扫描 `src/service/searcher/` 下全部 `.rs` 源码，收集含 `"http://` 字面量的行（固定文件序）。
fn scan_plaintext_http_literals() -> Vec<HttpLiteralHit> {
    let searcher_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/service/searcher");
    let mut rust_files: Vec<PathBuf> = fs::read_dir(&searcher_dir)
        .expect("读取 src/service/searcher 目录失败")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .collect();
    rust_files.sort(); // 固定遍历顺序，断言信息可复现
    let mut hits = Vec::new();
    for path in rust_files {
        let content = fs::read_to_string(&path).expect("读取 searcher 源码失败");
        let file = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        for (idx, line) in content.lines().enumerate() {
            if line.contains("\"http://") {
                hits.push(HttpLiteralHit {
                    file: file.clone(),
                    line: idx + 1,
                    text: line.trim().to_string(),
                });
            }
        }
    }
    hits
}

#[test]
fn searcher_sources_have_no_plaintext_http_endpoints() {
    let hits = scan_plaintext_http_literals();

    // 白名单语义按「内容匹配」锚定（不按裸行号，避免行号漂移误报）：
    // - 每一处命中行都必须是防御性升级调用（strip_prefix( / replace(）；
    // - 命中文件只允许 kugou.rs 与 netease.rs——删掉任一防御或新增明文端点都会红灯。
    let non_defensive: Vec<String> = hits
        .iter()
        .filter(|hit| !(hit.text.contains("strip_prefix(") || hit.text.contains("replace(")))
        .map(|hit| format!("{}:{}: {}", hit.file, hit.line, hit.text))
        .collect();
    assert!(
        non_defensive.is_empty(),
        "searcher 源码出现非防御性明文 http:// 端点，须改用 HTTPS：\n{}",
        non_defensive.join("\n")
    );

    let hit_files: Vec<&str> = hits
        .iter()
        .map(|hit| hit.file.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    assert_eq!(
        hit_files,
        vec!["kugou.rs", "netease.rs"],
        "含 \"http:// 字面量的 searcher 源文件超出防御性升级白名单（kugou.rs 封面 Image 升级、\
         netease.rs picUrl 升级）"
    );
}
