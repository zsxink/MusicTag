// MusicTag — GitHub 正式版更新检查，不下载或安装更新。
// HTTP 与系统 opener 均可注入，测试不依赖真实网络或打开浏览器。

use async_trait::async_trait;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::time::Duration;

const RELEASES_API: &str = "https://api.github.com/repos/zsxink/MusicTag/releases";
const RELEASE_URL_PREFIX: &str = "https://github.com/zsxink/MusicTag/releases/tag/";
pub const RELEASES_PER_PAGE: u32 = 100;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
}

/// 保留原始 HTTP 状态和正文，让注入响应覆盖生产代码的错误映射。
pub struct ReleaseResponse {
    pub status: u16,
    pub body: String,
}

#[async_trait]
pub trait ReleaseClient: Send + Sync {
    async fn fetch_page(&self, page: u32, per_page: u32) -> Result<ReleaseResponse, String>;
}

struct GithubReleaseClient(reqwest::Client);

#[async_trait]
impl ReleaseClient for GithubReleaseClient {
    async fn fetch_page(&self, page: u32, per_page: u32) -> Result<ReleaseResponse, String> {
        let response = self
            .0
            .get(format!("{RELEASES_API}?per_page={per_page}&page={page}"))
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|error| error.to_string())?;
        Ok(ReleaseResponse { status, body })
    }
}

/// 当前版本由 Cargo package 提供；整个请求有上限，不阻塞 Tauri UI。
pub async fn check_for_update() -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("MusicTag/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("检查更新失败：无法创建网络客户端（{error}）"))?;
    tokio::time::timeout(
        CHECK_TIMEOUT,
        check_for_update_with_client(&GithubReleaseClient(client), env!("CARGO_PKG_VERSION")),
    )
    .await
    .map_err(|_| "检查更新失败：请求超时，请稍后重试".to_string())?
}

/// 接受可选 v 前缀；预发布 tag 即使 API 标记为正式版也不作为稳定版本。
fn stable_version(tag: &str) -> Option<Version> {
    let version = Version::parse(tag.strip_prefix('v').unwrap_or(tag)).ok()?;
    version.pre.is_empty().then_some(version)
}

pub async fn check_for_update_with_client(
    client: &dyn ReleaseClient,
    current_version: &str,
) -> Result<UpdateCheckResult, String> {
    let current = Version::parse(current_version)
        .map_err(|_| "检查更新失败：当前应用版本无效".to_string())?;
    let mut latest: Option<(Version, Release)> = None;
    let mut page = 1;
    loop {
        let response = client
            .fetch_page(page, RELEASES_PER_PAGE)
            .await
            .map_err(|error| format!("检查更新失败：网络请求失败（{error}）"))?;
        if !(200..300).contains(&response.status) {
            return Err(format!(
                "检查更新失败：GitHub 返回 HTTP {}，请稍后重试",
                response.status
            ));
        }
        let releases: Vec<Release> = serde_json::from_str(&response.body)
            .map_err(|_| "检查更新失败：GitHub 返回的数据无法解析".to_string())?;
        if releases.is_empty() {
            break;
        }
        for release in releases {
            if release.draft || release.prerelease {
                continue;
            }
            let Some(version) = stable_version(&release.tag_name) else {
                continue;
            };
            let replace = latest.as_ref().is_none_or(|(best_version, best_release)| {
                version
                    .cmp_precedence(best_version)
                    .then_with(|| release.tag_name.cmp(&best_release.tag_name))
                    == Ordering::Greater
            });
            if replace {
                latest = Some((version, release));
            }
        }
        page = page
            .checked_add(1)
            .ok_or_else(|| "检查更新失败：GitHub 分页数据无效".to_string())?;
    }
    let (version, release) =
        latest.ok_or_else(|| "检查更新失败：未找到有效的正式版本".to_string())?;
    let release_url = validate_release_url(&release.html_url)
        .map_err(|_| "检查更新失败：Release 页面地址无效".to_string())?;
    if release_url != format!("{RELEASE_URL_PREFIX}{}", release.tag_name) {
        return Err("检查更新失败：Release 页面与版本不匹配".to_string());
    }
    Ok(UpdateCheckResult {
        current_version: current_version.to_string(),
        latest_version: version.to_string(),
        update_available: version.cmp_precedence(&current) == Ordering::Greater,
        release_url,
    })
}

/// 仅接受固定仓库的稳定版本 Release 地址；不授予前端通用 opener 权限。
pub fn validate_release_url(url: &str) -> Result<String, String> {
    let invalid = || "无法打开详情：仅允许 MusicTag 正式版的 GitHub HTTPS Release 地址".to_string();
    let parsed = reqwest::Url::parse(url).map_err(|_| invalid())?;
    let tag = url.strip_prefix(RELEASE_URL_PREFIX).ok_or_else(invalid)?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.as_str() != url
        || stable_version(tag).is_none()
    {
        return Err(invalid());
    }
    Ok(url.to_string())
}

/// 先验证再调用系统适配器；失败信息与检查失败互相独立。
pub fn open_release_page(
    url: &str,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    let safe_url = validate_release_url(url)?;
    open(&safe_url).map_err(|error| format!("无法打开 Release 详情（{error}）"))
}
