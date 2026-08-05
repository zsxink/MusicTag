// MusicTag — 网易云 weapi / linuxapi 加密原语（music-tag-web encrypt.py 的 Rust 移植，design.md D4）。
//
// 纯算法无网络依赖（无 JS 引擎）：
// - weapi：双层 AES-CBC（NONCE 层 + 随机 secret 层，均 base64 + 同 iv）→ `params`；
//   `encSecKey` = RSA modpow（secret 反转 → hex → BigUint）hex 左补零 256 位；
// - linuxapi：AES-ECB（LINUXKEY，无 iv）→ hex 大写 → `eparams`。
// 常量与算法逐字对照参照库；已知向量 / 往返单测锁算法（design.md D4：纯算法最容易悄悄写错）。
//
// AES 块密文长度：AES-128 密钥 16 字节、块 16 字节；CBC iv 为十六进制串
// `0102030405060708` 的 ASCII 字节（与参照库一致，非解码后的 8 字节）。

use aes::cipher::block_padding::Pkcs7;
use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockEncrypt, BlockEncryptMut, KeyInit, KeyIvInit};
use aes::Aes128;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use cbc::Encryptor;

/// weapi 第一层 AES 密钥（16 字节字面量）。
pub const NONCE: &[u8; 16] = b"0CoJUm6Qyw8W8jud";
/// linuxapi AES-ECB 密钥（16 字节字面量）。
pub const LINUXKEY: &[u8; 16] = b"rFgB&h#%2?^eDg:Q";
/// RSA 公钥指数（hex 串）。
pub const PUBKEY: &str = "010001";
/// RSA 模数（1024-bit，256 hex 字符，design.md D4「同参照库」）。
pub const MODULUS: &str =
    "e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

/// AES-CBC 固定 iv（`0102030405060708` 的 ASCII 字节，两层共用）。
const IV: &[u8; 16] = b"0102030405060708";

/// weapi 加密结果（`{ params, encSecKey }`，POST form 两个字段）。
pub struct WeapiParams {
    pub params: String,
    pub enc_sec_key: String,
}

/// weapi 加密：生成随机 `secret = hexlify(urandom(16))[:16]`（16 字符 hex 串当 AES 密钥）。
pub fn weapi(text: &str) -> WeapiParams {
    weapi_with_secret(text, &random_hex_secret())
}

/// weapi 加密（注入固定 secret，供已知向量单测锁算法）。
pub fn weapi_with_secret(text: &str, secret: &str) -> WeapiParams {
    // 第一层：AES-CBC(NONCE 密钥 + PKCS7) → base64
    let inner = aes_cbc_encrypt(text.as_bytes(), NONCE);
    let inner_b64 = BASE64.encode(&inner);
    // 第二层：AES-CBC(secret 密钥 + 同 iv + PKCS7) → base64 → params
    let params = aes_cbc_encrypt(inner_b64.as_bytes(), secret.as_bytes());
    let params = BASE64.encode(&params);
    let enc_sec_key = rsa_encrypt(secret);
    WeapiParams {
        params,
        enc_sec_key,
    }
}

/// linuxapi 加密：AES-ECB（LINUXKEY，无 iv）→ hex 大写 → `eparams`。
pub fn linuxapi(text: &str) -> String {
    let enc = aes_ecb_encrypt(text.as_bytes(), LINUXKEY);
    hex_encode_upper(&enc)
}

/// 随机 secret：`hexlify(urandom(16))[:16]`（16 字符 hex 串，当 AES-128 密钥 = ASCII 字节）。
pub fn random_hex_secret() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    let hex = hex_encode(&bytes);
    hex[..16].to_string()
}

/// RSA 加密 secret：`encSecKey = hex(modpow(secret_rev_hex, PUBKEY, MODULUS))` 左补零 256 位。
///
/// 参照库语义（weapi 约定）：secret 字符串反转 → **hexlify 反转后的 UTF-8 字节** → 当 hex
/// 解析为 BigUint → `pow(n, e, m)`。注意不是「反转串直接当 hex 解析」（那是常见走样点，
/// design.md D4「已知向量锁算法」专门锁这一处）。
pub fn rsa_encrypt(secret: &str) -> String {
    use rsa::BigUint;
    let rev: String = secret.chars().rev().collect();
    let rev_hex = hex_encode(rev.as_bytes());
    let n = BigUint::parse_bytes(rev_hex.as_bytes(), 16).expect("反转 secret 的 hexlify 应为 hex");
    let e = BigUint::parse_bytes(PUBKEY.as_bytes(), 16).expect("PUBKEY 应为 hex");
    let m = BigUint::parse_bytes(MODULUS.as_bytes(), 16).expect("MODULUS 应为 hex");
    let enc = n.modpow(&e, &m);
    format!("{:0>256}", enc.to_str_radix(16))
}

/// AES-128-CBC 加密（PKCS7 + 固定 iv `0102030405060708`）。
fn aes_cbc_encrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    Encryptor::<Aes128>::new_from_slices(key, IV)
        .expect("AES-128 密钥须为 16 字节")
        .encrypt_padded_vec_mut::<Pkcs7>(data)
}

/// AES-128-ECB 加密（无 iv，手写 PKCS7 + 逐块加密）。
///
/// `pub`：供 `src-tauri/tests/searcher_crypto_tests.rs` 往返断言（rust-tests-separation
/// 单测外置；集成测试是独立 crate，仅 `pub` 可见）。
pub fn aes_ecb_encrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new_from_slice(key).expect("AES-128 密钥须为 16 字节");
    let mut buf = data.to_vec();
    let pad = 16 - buf.len() % 16;
    buf.extend(std::iter::repeat_n(pad as u8, pad));
    for chunk in buf.chunks_exact_mut(16) {
        cipher.encrypt_block(GenericArray::from_mut_slice(chunk));
    }
    buf
}

/// hex 小写编码。
pub fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// hex 大写编码（linuxapi `eparams` 形状）。
pub fn hex_encode_upper(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02X}"));
    }
    s
}

