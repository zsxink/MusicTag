// MusicTag — `service/searcher/crypto.rs` 网易云 weapi/linuxapi 加密原语单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 已知向量 / 往返单测锁算法（design.md D4：纯算法最容易悄悄写错）：
// - weapi 双层 AES-CBC 已知向量 + 往返；
// - linuxapi AES-ECB 已知向量 + 往返；
// - RSA modpow 已知向量 + 左补零 256 位；
// - 随机 secret 形状。
// 被测函数经 `app_lib::service::searcher::crypto::`；解密 helper 为测试专用，复制进本文件。

mod common;

use app_lib::service::searcher::crypto::{
    aes_ecb_encrypt, linuxapi, random_hex_secret, rsa_encrypt, weapi, weapi_with_secret, LINUXKEY,
    NONCE,
};
use aes::cipher::{BlockDecrypt, BlockDecryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use cbc::Decryptor;

/// AES-128-CBC 解密（PKCS7 + 固定 iv `0102030405060708`），供往返测试。
fn aes_cbc_decrypt(data: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    Decryptor::<aes::Aes128>::new_from_slices(key, b"0102030405060708")
        .map_err(|e| format!("密钥长度错误: {e}"))?
        .decrypt_padded_vec_mut::<aes::cipher::block_padding::Pkcs7>(data)
        .map_err(|e| format!("AES 解密失败: {e}"))
}

/// 测试用 hex 大写解码（linuxapi eparams 还原）。
fn hex_decode_upper(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for chunk in bytes.chunks_exact(2) {
        let hi = (chunk[0] as char).to_digit(16)?;
        let lo = (chunk[1] as char).to_digit(16)?;
        out.push((hi * 16 + lo) as u8);
    }
    Some(out)
}

/// AES-ECB 解密（逐块 + 剥 PKCS7），供往返测试。
fn aes_ecb_decrypt(ciphertext: &[u8], key: &[u8]) -> Vec<u8> {
    use aes::cipher::generic_array::GenericArray;
    use aes::cipher::KeyInit;
    let cipher = aes::Aes128::new_from_slice(key).expect("AES-128 密钥须为 16 字节");
    let mut blocks = ciphertext.to_vec();
    for chunk in blocks.chunks_exact_mut(16) {
        cipher.decrypt_block(GenericArray::from_mut_slice(chunk));
    }
    let pad = *blocks.last().expect("非空密文") as usize;
    blocks.truncate(blocks.len() - pad);
    blocks
}

#[test]
fn weapi_matches_reference_vector() {
    // 已知向量（openssl 独立计算，text = serde_json 排序键形态，iv = `0102030405060708` 的
    // 16 ASCII 字节）：固定 secret + 固定文本 → params / encSecKey 逐字一致
    // （design.md D4「已知向量锁算法」）。
    let text = r#"{"limit":10,"offset":0,"s":"test","type":1}"#;
    let p = weapi_with_secret(text, "0123456789abcdef");
    assert_eq!(
        p.params,
        "LrEUQS6Y9M2j7REO1sea8TQlqJ/yus95dDz1DH+QzrMUCYkwqOAmICPZg+zZpXnh2jFoq6FmNxUoAYqidfLsHMw1grMh2mSwM85TAYr8iM0="
    );
    assert_eq!(
        p.enc_sec_key,
        "35701388baf89fed412e11269b9c76625d095ecaf17f03fa018abe19ea2d38b949debf242ee39a71ca1f6cda71b1b86a45aa909ee27f7e78e267d34e732f0de948206c3340a788d0003372183e2f753c1f78b66ac23d134ac1fc9b993156520ea826b8aa89a962d4491b4b8d7e08738e1da9b07aa39bf4a7ef0b1c210728cd52"
    );
}

#[test]
fn weapi_params_roundtrips_to_plaintext() {
    // 往返：secret 层解密 → base64 → NONCE 层解密 → 原文（锁双层 CBC 结构 + 同 iv）。
    let text = r#"{"limit":10,"offset":0,"s":"晴天","type":1}"#;
    let secret = "fedcba0123456789";
    let p = weapi_with_secret(text, secret);
    let outer = BASE64.decode(&p.params).expect("params 应为 base64");
    let inner = aes_cbc_decrypt(&outer, secret.as_bytes()).expect("第二层解密失败");
    let inner = String::from_utf8(inner).expect("内层应为 base64 文本");
    let inner = BASE64.decode(inner.as_bytes()).expect("内层应为 base64");
    let plain = aes_cbc_decrypt(&inner, NONCE).expect("第一层解密失败");
    assert_eq!(String::from_utf8(plain).unwrap(), text);
}

#[test]
fn weapi_output_shape() {
    // 结构守卫：encSecKey 恒 256 位 hex，params 为 base64（随机 secret 每次不同）。
    let p1 = weapi("hello");
    let p2 = weapi("hello");
    assert_eq!(p1.enc_sec_key.len(), 256);
    assert!(p1.enc_sec_key.chars().all(|c| c.is_ascii_hexdigit()));
    assert!(
        p1.params.len().is_multiple_of(4),
        "base64 长度应为 4 的倍数"
    );
    assert_ne!(p1.params, p2.params, "随机 secret → params 每次不同");
    assert_ne!(
        p1.enc_sec_key, p2.enc_sec_key,
        "随机 secret → encSecKey 每次不同"
    );
}

#[test]
fn random_hex_secret_shape() {
    let s1 = random_hex_secret();
    let s2 = random_hex_secret();
    assert_eq!(s1.len(), 16, "hexlify(urandom(16))[:16] 应为 16 字符");
    assert!(s1.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(s1, s2, "两次随机 secret 应不同");
}

#[test]
fn linuxapi_matches_reference_vector() {
    // 已知向量（openssl 独立计算）：AES-ECB(LINUXKEY) → hex 大写。
    let text = r#"{"id":"123","method":"POST"}"#;
    assert_eq!(
        linuxapi(text),
        "C3338179794244D6A30B7E450B584D6063C1C733C997E6CB5C127C2D014785D4"
    );
}

#[test]
fn linuxapi_eparams_decrypts_back_to_plaintext() {
    // 往返：eparams（hex 大写）→ 解码 → ECB 解密 → 含 method:POST 注入的原文。
    let text = r#"{"id":"9","method":"POST"}"#;
    let eparams = linuxapi(text);
    let enc = hex_decode_upper(&eparams).expect("eparams 应为 hex 大写");
    let plain = aes_ecb_decrypt(&enc, LINUXKEY);
    assert_eq!(String::from_utf8(plain).unwrap(), text);
}

#[test]
fn aes_ecb_roundtrips() {
    // 手写 PKCS7 边界：非块倍长 / 块倍长文本均往返。
    for data in [
        b"hello, world".as_slice(),
        b"1234567890123456",
        b"".as_slice(),
    ] {
        let enc = aes_ecb_encrypt(data, LINUXKEY);
        assert!(enc.len().is_multiple_of(16), "ECB 密文应为块倍长");
        let plain = aes_ecb_decrypt(&enc, LINUXKEY);
        assert_eq!(plain, data, "ECB 往返失败");
    }
}

#[test]
fn rsa_encrypt_matches_reference_modpow() {
    // 已知向量（Python pow 独立计算，canonical 语义）：secret 反转 → hexlify UTF-8 字节 →
    // modpow → 左补零 256 位。
    assert_eq!(
        rsa_encrypt("0123456789abcdef"),
        "35701388baf89fed412e11269b9c76625d095ecaf17f03fa018abe19ea2d38b949debf242ee39a71ca1f6cda71b1b86a45aa909ee27f7e78e267d34e732f0de948206c3340a788d0003372183e2f753c1f78b66ac23d134ac1fc9b993156520ea826b8aa89a962d4491b4b8d7e08738e1da9b07aa39bf4a7ef0b1c210728cd52"
    );
}

#[test]
fn rsa_encrypt_left_pads_to_256() {
    // 任意 secret 输出恒 256 位 hex（modpow 结果可能 < 256 位，须左补零）。
    for s in ["0", "ffffffffffffffff", "0000000000000000"] {
        let key = rsa_encrypt(s);
        assert_eq!(
            key.len(),
            256,
            "encSecKey 应左补零 256 位，实际 {} 位",
            key.len()
        );
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
