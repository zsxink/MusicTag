// MusicTag — 内嵌封面原图导出集成测试（export-embedded-cover 任务 4）。
//
// 覆盖 spec S2 / S2a / S2b / S5 / S6 / S7 的 Rust 侧：
// - fixture 早检（第一个测试只「构造 + 读回」，不过则先修 fixture）；
// - S2：`export_cover_bytes` 返回字节 = 标签内第一个 front cover 的原始字节（FLAC + APE）；
// - S2a：APE 必须经 `read_ape_cover` 原生回退取图（lofty 通用 `Tag` 路径不映射 APE 图片）；
// - S2b：>2048 大图导出后尺寸不变，证明未过 `compress_cover`；
// - 端到端写盘（等价 `commands::cover::export_cover` 两参语义；rfd 存盘框无头不可测）；
// - S5：导出是只读动作，源音频字节前后完全一致；
// - S6：写盘失败 / 坏标签 → 如实返回中文错误，不假报成功；
// - S7：无内嵌封面 → Err「该歌曲没有内嵌封面」。
//
// **不含 S4（取消）**：rfd `save_file()` 在无头测试里无法点「取消」，只靠代码逻辑 +
// `pick_cover_file` 的 `None` 先例背书，由前端断言与人工验收覆盖（design.md §7）。

mod common;

use app_lib::commands::cover::export_cover;
use app_lib::service::cover::{
    compress_cover, default_cover_file_name, export_cover_bytes, write_cover_to, MAX_DIM,
};
use app_lib::service::reader::first_embedded_picture;
use common::{
    add_ape_tags_with_picture, add_tags, tiny_png_bytes, write_tagged_ape, write_tagged_flac,
};
use lofty::prelude::TaggedFileExt;
use lofty::probe::Probe;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

/// 生成指定边长的 PNG（`image` crate 运行时编码，不新增二进制 fixture 文件）。
///
/// S2b 的阈值是**双维都 >MAX_DIM** 而非「体积 >2048 字节」：`compress_cover` 的
/// 压缩判定看的是边长，一张只有几 KB 的小 PNG 本来就不会被压缩，用它当素材证明不了
/// 「导出不过压缩路径」任何东西。
fn png_of_size(w: u32, h: u32) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        w,
        h,
        image::Rgba([12, 34, 56, 255]),
    ))
    .write_to(&mut buf, image::ImageFormat::Png)
    .expect("编码测试 PNG 失败");
    buf.into_inner()
}

/// 构造带内嵌封面的 FLAC fixture（走通用 `Tag` 写盘路径 → `PICTURE` 块）。
fn flac_with_cover(dir: &Path, name: &str, picture: Vec<u8>) -> std::path::PathBuf {
    write_tagged_flac(dir, name, "Song", "Artist");
    let path = dir.join(name);
    add_tags(&path, Some("[00:00.00]歌词"), Some(picture));
    path
}

/// 构造带内嵌封面的 APE fixture（走原生 `Cover Art (Front)` binary item）。
fn ape_with_cover(dir: &Path, name: &str, picture: Vec<u8>) -> std::path::PathBuf {
    write_tagged_ape(dir, name, "Song", "Artist");
    let path = dir.join(name);
    add_ape_tags_with_picture(&path, picture);
    path
}

// ---------------------------------------------------------------------------
// fixture 早检：任何业务断言之前先证明「造出来的 fixture 真的能被导出路径取到图」，
// 且形态与设计假设一致。fixture 一旦失效（lofty 行为变化、fixture 构造退化），
// 后面的字节比对会变成空转绿——这正是本测试要挡的假绿。
// ---------------------------------------------------------------------------

#[test]
fn fixture_early_check_flac_and_ape_embedded_pictures_are_readable() {
    let tmp = TempDir::new().expect("临时目录");
    let png = tiny_png_bytes();
    let flac = flac_with_cover(tmp.path(), "song.flac", png.clone());
    let ape = ape_with_cover(tmp.path(), "song.ape", png.clone());

    // FLAC：通用 Tag 路径即可读出 picture（PICTURE 块）
    let flac_file = Probe::open(&flac)
        .and_then(|probed| probed.read())
        .unwrap_or_else(|e| panic!("FLAC fixture 应可被 lofty 读取 {flac:?}: {e}"));
    assert!(
        !flac_file
            .primary_tag()
            .expect("FLAC fixture 应有 primary tag")
            .pictures()
            .is_empty(),
        "FLAC fixture 的 primary tag 应含 picture"
    );
    let flac_pic =
        first_embedded_picture(&flac, flac_file.primary_tag()).expect("FLAC 应取到内嵌封面");
    assert_eq!(
        flac_pic.data(),
        png.as_slice(),
        "FLAC 内嵌字节应逐字节等于构造字节"
    );

    // APE：必须**只**存在于原生 `Cover Art (Front)` item——lofty 通用 `Tag` 路径不映射
    // APE 图片。若这里断言不到「通用路径取不到图」，就说明 fixture 已退化成 FLAC 那种
    // 通用路径，S2a 的回退分支将永远不被执行（测试假绿）。
    let ape_file = Probe::open(&ape)
        .and_then(|probed| probed.read())
        .unwrap_or_else(|e| panic!("APE fixture 应可被 lofty 读取 {ape:?}: {e}"));
    assert!(
        ape_file
            .primary_tag()
            .expect("APE fixture 应有 primary tag")
            .pictures()
            .is_empty(),
        "APE fixture 的通用 Tag 路径应取不到 picture（否则证明不了 read_ape_cover 回退生效）"
    );
    let ape_pic = first_embedded_picture(&ape, ape_file.primary_tag()).expect("APE 应取到内嵌封面");
    assert_eq!(
        ape_pic.data(),
        png.as_slice(),
        "APE 内嵌字节应逐字节等于构造字节"
    );
}

// ---------------------------------------------------------------------------
// S2 / S2a：导出字节与标签内图片一致
// ---------------------------------------------------------------------------

#[test]
fn export_cover_bytes_flac_returns_embedded_original_bytes() {
    // S2（FLAC）：导出字节 = 构造时内嵌的字节，逐字节相等，且带出内嵌声明的 MIME
    let tmp = TempDir::new().expect("临时目录");
    let png = tiny_png_bytes();
    let flac = flac_with_cover(tmp.path(), "song.flac", png.clone());

    let (bytes, mime) = export_cover_bytes(&flac).expect("FLAC 导出应成功");
    assert_eq!(bytes, png, "导出字节应与内嵌原图逐字节相等");
    assert_eq!(
        mime.as_deref(),
        Some("image/png"),
        "FLAC 内嵌声明 image/png"
    );
}

#[test]
fn export_cover_bytes_ape_returns_embedded_original_bytes_via_fallback() {
    // S2a（APE 专项，最易假绿）：lofty 通用 `Tag` 路径拿不到 APE 图片，只有
    // `first_embedded_picture` 的 `read_ape_cover` 回退能取到；本用例因此断言「有图
    // 且字节正确」，并在 fixture 侧再验一次「通用路径确实取不到图」。
    let tmp = TempDir::new().expect("临时目录");
    let png = tiny_png_bytes();
    let ape = ape_with_cover(tmp.path(), "song.ape", png.clone());

    let tagged = Probe::open(&ape)
        .and_then(|probed| probed.read())
        .expect("APE fixture 应可读");
    assert!(
        tagged
            .primary_tag()
            .expect("APE 应有 primary tag")
            .pictures()
            .is_empty(),
        "前置：通用 Tag 路径取不到图，本例必须靠 APE 回退"
    );

    let (bytes, _) = export_cover_bytes(&ape).expect("APE 导出应成功（走原生封面回退）");
    assert_eq!(
        bytes, png,
        "APE 导出字节应与内嵌原图逐字节相等（未取到图会被误报为「没有内嵌封面」）"
    );
}

#[test]
fn export_cover_bytes_large_image_is_original_not_compressed() {
    // S2b：内嵌 3000×2000（双维 >2048）大图，导出后尺寸不变，证明未过 compress_cover。
    let tmp = TempDir::new().expect("临时目录");
    let big = png_of_size(3000, 2000);
    let flac = flac_with_cover(tmp.path(), "big.flac", big.clone());

    // 素材有效性守卫：这张图若被送进 compress_cover 一定会被缩，故本例的字节比对
    // 是有判别力的（否则导出路径偷跑压缩仍会全绿）。
    let (compressed, _) = compress_cover(&big, "image/png").expect("大图应可压缩");
    assert_ne!(compressed, big, "压缩结果不应等于原图，否则本例无判别力");

    let (bytes, _) = export_cover_bytes(&flac).expect("大图导出应成功");
    assert_eq!(bytes, big, "导出应为标签内原始字节，非 ≤2048 压缩预览图");
    let img = image::load_from_memory(&bytes).expect("导出字节应可解码");
    assert_eq!(
        (img.width(), img.height()),
        (3000, 2000),
        "导出尺寸应保持原样（双维 >{MAX_DIM} 仍未被压缩）"
    );
}

// ---------------------------------------------------------------------------
// 端到端写盘：`pick_cover_save_path`（rfd 存盘框）不可无头测试，其**下游**可测——
// `commands::cover::export_cover(song_path, dest_path)` 两参语义：取字节 + 写盘。
// ---------------------------------------------------------------------------

#[test]
fn export_cover_command_writes_bytes_identical_to_embedded_picture() {
    // 端到端：FLAC 与 APE 各走一遍 command 壳，导出文件与内嵌原图逐字节相等
    let tmp = TempDir::new().expect("临时目录");
    let png = tiny_png_bytes();
    let cases = [
        (
            "song.flac",
            flac_with_cover(tmp.path(), "song.flac", png.clone()),
        ),
        (
            "song.ape",
            ape_with_cover(tmp.path(), "song.ape", png.clone()),
        ),
    ];
    for (_dest_name, song) in cases {
        // 默认文件名 = 音频文件名去扩展名 + 按图片推断的扩展名（等价存盘框的预填名）
        let (bytes, mime) = export_cover_bytes(&song).expect("应能取到内嵌封面");
        let default_name = default_cover_file_name(&song, mime.as_deref(), &bytes);
        assert_eq!(
            default_name, "song.png",
            "{song:?} 的默认文件名应为 song.png"
        );

        let dest = tmp.path().join(&default_name);
        export_cover(
            song.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap_or_else(|e| panic!("导出 {song:?} 应成功: {e}"));

        let written = fs::read(&dest).expect("导出文件应已写出");
        assert_eq!(written, png, "{song:?} 导出文件应与内嵌原图逐字节相等");
    }
}

// ---------------------------------------------------------------------------
// S5：导出为只读动作
// ---------------------------------------------------------------------------

#[test]
fn export_cover_bytes_does_not_modify_song_file() {
    // 导出前后源音频字节完全相同：导出不得改写标签、图片数据或任何音频字节
    // （mtime 语义按 design.md §7 只作人工项，不在此断言）。
    let tmp = TempDir::new().expect("临时目录");
    let png = tiny_png_bytes();
    let dest_dir = TempDir::new().expect("临时目录");

    let cases = [
        flac_with_cover(tmp.path(), "song.flac", png.clone()),
        ape_with_cover(tmp.path(), "song.ape", png.clone()),
    ];
    for song in cases {
        let before = fs::read(&song).expect("导出前应能读源文件");
        let (bytes, _) = export_cover_bytes(&song).expect("应能取到内嵌封面");
        let dest = dest_dir.path().join("out.png");
        write_cover_to(&dest, &bytes).expect("写盘应成功");
        let after = fs::read(&song).expect("导出后应能读源文件");

        assert_eq!(before, after, "{song:?} 导出前后源文件字节必须完全相同");
        assert_eq!(fs::read(&dest).expect("导出文件应存在"), png);
    }
}

// ---------------------------------------------------------------------------
// S6：导出失败如实报错（写盘失败 / 坏标签）
// ---------------------------------------------------------------------------

#[test]
fn write_cover_to_missing_parent_dir_returns_err_with_chinese_reason() {
    // 父目录不存在 → Err 且文案含「导出封面失败」，不假报成功、不产生半个文件
    let tmp = TempDir::new().expect("临时目录");
    let dest = tmp.path().join("no-such-dir").join("cover.png");
    let err =
        write_cover_to(&dest, tiny_png_bytes().as_slice()).expect_err("父目录不存在应返回 Err");
    assert!(
        err.contains("导出封面失败"),
        "错误文案应含「导出封面失败」，实际: {err}"
    );
    assert!(!dest.exists(), "写失败后不应留下任何文件");
}

#[test]
fn export_cover_command_write_failure_reports_chinese_reason() {
    // command 壳的错误透传：写盘失败原样返回中文原因，不被吞成成功
    let tmp = TempDir::new().expect("临时目录");
    let song = flac_with_cover(tmp.path(), "song.flac", tiny_png_bytes());
    let dest = tmp.path().join("missing-dir").join("cover.png");

    let err = export_cover(
        song.to_string_lossy().into_owned(),
        dest.to_string_lossy().into_owned(),
    )
    .expect_err("父目录不存在应返回 Err");
    assert!(err.contains("导出封面失败"), "实际: {err}");
}

#[test]
fn export_cover_bytes_corrupt_tag_returns_read_error() {
    // 坏标签（读标签失败）→ 如实 Err「读取标签失败」，不落到「没有内嵌封面」或假成功
    let tmp = TempDir::new().expect("临时目录");
    let broken = tmp.path().join("broken.flac");
    fs::write(&broken, b"garbage bytes").expect("写入坏 fixture");

    let err = export_cover_bytes(&broken).expect_err("坏标签应返回 Err");
    assert!(
        err.contains("读取标签失败"),
        "坏标签应报「读取标签失败」，实际: {err}"
    );
}

// ---------------------------------------------------------------------------
// S7：无内嵌封面（后端侧兜底）
// ---------------------------------------------------------------------------

#[test]
fn export_cover_bytes_without_embedded_cover_returns_err() {
    // 前端已按 `current.cover === null` 置灰菜单项，但磁盘真值以 Rust 为准：
    // 有标签但无封面（FLAC 与 APE 两种形态）都必须返回「该歌曲没有内嵌封面」
    let tmp = TempDir::new().expect("临时目录");
    let flac = tmp.path().join("plain.flac");
    write_tagged_flac(tmp.path(), "plain.flac", "Song", "Artist");
    add_tags(&flac, Some("歌词"), None);

    let ape = tmp.path().join("plain.ape");
    write_tagged_ape(tmp.path(), "plain.ape", "Song", "Artist");

    for song in [flac, ape] {
        let err = export_cover_bytes(&song).expect_err("无内嵌封面应返回 Err");
        assert_eq!(err, "该歌曲没有内嵌封面", "{song:?} 错误文案不符");
    }
}
