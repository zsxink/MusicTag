// lib/cover — 封面 bytes → CoverInput（design.md D6）：
// `download_cover` 返回裸 bytes（IPC JSON `number[]`），本模块做
// 魔数嗅探 mime → data URL → `Image` 解码取自然尺寸 → 任一维 > 2048 时
// canvas 等比缩至 ≤2048 → `data:<mime>;base64,...`。
// 解码失败 / 画布异常 → reject（中文原因，供 pickCoverCandidate 静默移除）。
// 无 Vue / Tauri IPC 依赖（DOM 允许），复用既有 lib/ 目录。
import type { CoverInput } from '../api/types'

/** 封面缩放宽边上限（任一维 > 2048 即压缩，design.md D6）。 */
const MAX_DIM = 2048

/**
 * 魔数嗅探 mime：JPEG（FF D8 FF）/ PNG（89 50 4E 47）/ WebP（RIFF....WEBP）/
 * GIF（GIF8，87a/89a）。未知 → null（bytesToCoverInput reject「封面格式无法识别」）。
 */
export function sniffMime(bytes: number[]): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp'
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    (bytes[3] === 0x38 || bytes[3] === 0x39)
  ) {
    return 'image/gif'
  }
  return null
}

/** number[] → base64（分块转二进制字符串，避免超大数组 spread 栈溢出）。 */
function bytesToBase64(bytes: number[]): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK))
  }
  return btoa(binary)
}

/** 构造 Image 并加载 data URL；解码失败 → reject（中文原因）。 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('封面图片解码失败'))
    img.src = src
  })
}

/** 大图经 canvas 等比压缩至 ≤2048（WebView 原生能力，save_song 统一嵌入压缩图）。 */
function compressViaCanvas(img: HTMLImageElement, mime: string): CoverInput {
  const { naturalWidth, naturalHeight } = img
  const scale = Math.min(MAX_DIM / naturalWidth, MAX_DIM / naturalHeight, 1)
  const w = Math.max(1, Math.round(naturalWidth * scale))
  const h = Math.max(1, Math.round(naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    throw new Error('封面图片压缩失败')
  }
  ctx.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL(mime)
  if (!dataUrl.startsWith('data:')) {
    throw new Error('封面图片压缩失败')
  }
  return { data_url: dataUrl, mime }
}

/**
 * 下载封面裸 bytes → CoverInput：
 * 魔数嗅探 mime → data URL → `Image` 解码取自然尺寸 → 任一维 > 2048 时
 * canvas 等比缩至 ≤2048。解码失败 / 画布异常 → reject（中文原因）。
 */
export async function bytesToCoverInput(bytes: number[]): Promise<CoverInput> {
  const mime = sniffMime(bytes)
  if (mime === null) {
    throw new Error('封面格式无法识别')
  }
  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`
  const img = await loadImage(dataUrl)
  if (img.naturalWidth <= MAX_DIM && img.naturalHeight <= MAX_DIM) {
    return { data_url: dataUrl, mime } // 小图直出（不碰 canvas）
  }
  return compressViaCanvas(img, mime)
}
