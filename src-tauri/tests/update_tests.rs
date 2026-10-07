use app_lib::service::update::{
    check_for_update_with_client, open_release_page, validate_release_url, ReleaseClient,
    ReleaseResponse, RELEASES_PER_PAGE,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::Mutex;

struct MockClient {
    responses: Mutex<VecDeque<Result<ReleaseResponse, String>>>,
    pages: Mutex<Vec<(u32, u32)>>,
}

impl MockClient {
    fn new(responses: Vec<Result<ReleaseResponse, String>>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
            pages: Mutex::new(Vec::new()),
        }
    }

    fn releases(pages: Vec<Vec<Value>>) -> Self {
        let mut responses = pages
            .into_iter()
            .map(|page| response(200, json!(page).to_string()))
            .collect::<Vec<_>>();
        responses.push(response(200, "[]"));
        Self::new(responses)
    }
}

#[async_trait]
impl ReleaseClient for MockClient {
    async fn fetch_page(&self, page: u32, per_page: u32) -> Result<ReleaseResponse, String> {
        self.pages.lock().unwrap().push((page, per_page));
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected request: mock response fixture exhausted")
    }
}

fn response(status: u16, body: impl Into<String>) -> Result<ReleaseResponse, String> {
    Ok(ReleaseResponse {
        status,
        body: body.into(),
    })
}

fn release(tag: &str) -> Value {
    json!({
        "tag_name": tag,
        "html_url": format!("https://github.com/zsxink/MusicTag/releases/tag/{tag}"),
        "draft": false,
        "prerelease": false,
    })
}

#[tokio::test]
async fn highest_stable_version_is_chosen_across_pages_in_any_order() {
    let mut draft = release("v99.0.0");
    draft["draft"] = json!(true);
    let mut prerelease = release("v98.0.0");
    prerelease["prerelease"] = json!(true);
    let client = MockClient::releases(vec![
        vec![release("v1.9.0"), draft, release("v100.0.0-rc.1")],
        vec![
            release("1.10.0"),
            prerelease,
            release("nightly"),
            release("v1.2.0"),
        ],
    ]);
    let result = check_for_update_with_client(&client, "1.9.1")
        .await
        .unwrap();
    assert_eq!(result.current_version, "1.9.1");
    assert_eq!(result.latest_version, "1.10.0");
    assert!(result.update_available);
    assert_eq!(
        result.release_url,
        "https://github.com/zsxink/MusicTag/releases/tag/1.10.0"
    );
    assert_eq!(
        *client.pages.lock().unwrap(),
        vec![
            (1, RELEASES_PER_PAGE),
            (2, RELEASES_PER_PAGE),
            (3, RELEASES_PER_PAGE)
        ]
    );

    let reordered = MockClient::releases(vec![vec![
        release("v1.2.0"),
        release("1.10.0"),
        release("v1.9.0"),
    ]]);
    assert_eq!(
        check_for_update_with_client(&reordered, "1.9.1")
            .await
            .unwrap(),
        result
    );
}

#[tokio::test]
async fn equal_or_higher_current_versions_report_up_to_date() {
    for current in ["1.10.0", "2.0.0"] {
        let client = MockClient::releases(vec![vec![release("v1.10.0")]]);
        let result = check_for_update_with_client(&client, current)
            .await
            .unwrap();
        assert!(!result.update_available);
        assert_eq!(result.latest_version, "1.10.0");
    }
}

#[tokio::test]
async fn build_metadata_does_not_change_update_precedence() {
    let client = MockClient::releases(vec![vec![release("v1.2.3+release.9")]]);
    assert!(
        !check_for_update_with_client(&client, "1.2.3+local.1")
            .await
            .unwrap()
            .update_available
    );

    let client = MockClient::releases(vec![vec![release("v1.2.3")]]);
    assert!(
        check_for_update_with_client(&client, "1.2.3-rc.1")
            .await
            .unwrap()
            .update_available
    );
}

#[tokio::test]
async fn empty_or_only_invalid_and_nonstable_versions_fail_clearly() {
    for releases in [vec![], vec![release("nightly"), release("v1.0.0-beta.1")]] {
        let client = MockClient::releases(vec![releases]);
        assert!(check_for_update_with_client(&client, "1.0.0")
            .await
            .unwrap_err()
            .contains("未找到有效的正式版本"));
    }
}

#[tokio::test]
async fn http_json_and_network_errors_are_user_readable() {
    for status in [403, 429, 500] {
        let client = MockClient::new(vec![response(status, "not JSON")]);
        let error = check_for_update_with_client(&client, "1.0.0")
            .await
            .unwrap_err();
        assert!(error.contains(&format!("HTTP {status}")));
        assert!(error.contains("检查更新失败"));
    }
    for body in ["not JSON", "{}", "[{\"tag_name\":\"v2.0.0\"}]"] {
        let client = MockClient::new(vec![response(200, body)]);
        assert!(check_for_update_with_client(&client, "1.0.0")
            .await
            .unwrap_err()
            .contains("数据无法解析"));
    }
    for cause in ["connection refused", "request timed out"] {
        let client = MockClient::new(vec![Err(cause.to_string())]);
        let error = check_for_update_with_client(&client, "1.0.0")
            .await
            .unwrap_err();
        assert!(error.contains("网络请求失败"));
        assert!(error.contains(cause));
    }
}

#[tokio::test]
async fn later_page_failure_does_not_return_a_partial_latest_version() {
    let client = MockClient::new(vec![
        response(200, json!([release("v2.0.0")]).to_string()),
        response(503, "{}"),
    ]);
    assert!(check_for_update_with_client(&client, "1.0.0")
        .await
        .unwrap_err()
        .contains("HTTP 503"));
}

#[tokio::test]
async fn invalid_current_version_fails_before_network() {
    let client = MockClient::new(vec![]);
    assert!(check_for_update_with_client(&client, "invalid")
        .await
        .unwrap_err()
        .contains("当前应用版本无效"));
    assert!(client.pages.lock().unwrap().is_empty());
}

#[tokio::test]
async fn selected_release_url_must_be_safe_and_match_its_tag() {
    for url in [
        "https://evil.example/releases/tag/v2.0.0",
        "https://github.com/zsxink/MusicTag/releases/tag/v3.0.0",
    ] {
        let mut entry = release("v2.0.0");
        entry["html_url"] = json!(url);
        let client = MockClient::releases(vec![vec![entry]]);
        assert!(check_for_update_with_client(&client, "1.0.0")
            .await
            .is_err());
    }
}

#[test]
fn only_fixed_repository_https_stable_release_urls_can_reach_the_opener() {
    for url in [
        "http://github.com/zsxink/MusicTag/releases/tag/v1.0.0",
        "javascript:alert(1)",
        "file:///tmp/v1.0.0",
        "https://github.com.evil.example/zsxink/MusicTag/releases/tag/v1.0.0",
        "https://user:password@github.com/zsxink/MusicTag/releases/tag/v1.0.0",
        "https://github.com:444/zsxink/MusicTag/releases/tag/v1.0.0",
        "https://github.com:443/zsxink/MusicTag/releases/tag/v1.0.0",
        "https://github.com/other/MusicTag/releases/tag/v1.0.0",
        "https://github.com/zsxink/MusicTag/issues/1",
        "https://github.com/zsxink/MusicTag/releases/tag/",
        "https://github.com/zsxink/MusicTag/releases/tag/../v1.0.0",
        "https://github.com/zsxink/MusicTag/releases/tag/v1.0.0/extra",
        "https://github.com/zsxink/MusicTag/releases/tag/v1.0.0%2Fextra",
        "https://github.com/zsxink/MusicTag/releases/tag/v1.0.0?redirect=evil",
        "https://github.com/zsxink/MusicTag/releases/tag/v1.0.0#fragment",
        "https://github.com/zsxink/MusicTag/releases/tag/v1.0.0-beta.1",
        " https://github.com/zsxink/MusicTag/releases/tag/v1.0.0",
    ] {
        assert!(
            validate_release_url(url).is_err(),
            "accepted unsafe URL: {url}"
        );
        assert!(open_release_page(url, |_| panic!("unsafe URL reached opener")).is_err());
    }
    for tag in ["v1.2.3", "1.2.3", "v1.2.3+build.1"] {
        let url = format!("https://github.com/zsxink/MusicTag/releases/tag/{tag}");
        let mut opened = false;
        open_release_page(&url, |actual| {
            assert_eq!(actual, url);
            opened = true;
            Ok(())
        })
        .unwrap();
        assert!(opened);
    }
}

#[test]
fn opener_failure_is_returned_for_ui_feedback() {
    let error = open_release_page(
        "https://github.com/zsxink/MusicTag/releases/tag/v1.0.0",
        |_| Err("no browser".to_string()),
    )
    .unwrap_err();
    assert!(error.contains("无法打开 Release 详情"));
    assert!(error.contains("no browser"));
}

#[tokio::test]
async fn ipc_response_uses_the_documented_snake_case_fields() {
    let client = MockClient::releases(vec![vec![release("v2.0.0")]]);
    let result = check_for_update_with_client(&client, "1.0.0")
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({
            "current_version": "1.0.0",
            "latest_version": "2.0.0",
            "update_available": true,
            "release_url": "https://github.com/zsxink/MusicTag/releases/tag/v2.0.0",
        })
    );
}
