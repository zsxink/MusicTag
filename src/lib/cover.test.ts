// lib/cover — 封面 bytes → CoverInput（魔数嗅探 + data URL + ≤2048 压缩）。
// 单测范围（design.md D6 / tasks 1.4）：魔数嗅探各格式 + 小图直出（≤2048 不碰 canvas，
// happy-dom 无 canvas 2d 实现）；canvas 压缩路径留 `tauri dev` 人工确认。
import { describe, expect, it, vi } from 'vitest'

import { bytesToCoverInput, sniffMime } from './cover'

/** 1×1 透明 PNG 的完整字节（小图直出用，≤2048 不经 canvas）。 */
const TINY_PNG_BYTES = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84,
  120, 218, 99, 252, 207, 192, 80, 15, 0, 4, 133, 1, 128, 132, 169, 140, 33,
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]

describe('lib/cover — sniffMime（魔数嗅探：JPEG/PNG/WebP/GIF，未知 → null）', () => {
  it('JPEG：FF D8 FF 开头 → image/jpeg', () => {
    expect(sniffMime([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])).toBe('image/jpeg')
  })

  it('PNG：89 50 4E 47 → image/png', () => {
    expect(sniffMime([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).toBe('image/png')
  })

  it('WebP：RIFF....WEBP（12 字节）→ image/webp', () => {
    // R I F F 0 0 0 0 W E B P
    expect(sniffMime([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])).toBe('image/webp')
  })

  it('GIF：GIF8（GIF87a/GIF89a）→ image/gif', () => {
    expect(sniffMime([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])).toBe('image/gif')
    expect(sniffMime([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])).toBe('image/gif')
  })

  it('未知 / 字节不足 → null（不误判）', () => {
    expect(sniffMime([0x00, 0x01, 0x02, 0x03])).toBeNull()
    expect(sniffMime([])).toBeNull()
    expect(sniffMime([0xff, 0xd8])).toBeNull() // JPEG 魔数需 ≥3 字节
  })
})

describe('lib/cover — bytesToCoverInput（bytes → data URL + mime）', () => {
  it('小图直出：PNG 1×1（≤2048）不碰 canvas → 原字节 data URL + image/png', async () => {
    const input = await bytesToCoverInput(TINY_PNG_BYTES)
    expect(input.mime).toBe('image/png')
    expect(input.data_url.startsWith('data:image/png;base64,')).toBe(true)
    // 直出 = 原字节 base64 原样（无 canvas 重编码）
    expect(input.data_url).toBe(
      `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='}`,
    )
  })

  it('魔数无法识别（非图片 bytes）→ reject「封面格式无法识别」', async () => {
    await expect(bytesToCoverInput([0x00, 0x01, 0x02, 0x03, 0x04])).rejects.toThrow('封面格式无法识别')
  })

  it('空 bytes → reject（无魔数可嗅探）', async () => {
    await expect(bytesToCoverInput([])).rejects.toThrow('封面格式无法识别')
  })

  it('图片解码失败（Image onerror）→ reject「封面图片解码失败」', async () => {
    // happy-dom 不校验 data URL 真实性（corrupt 也 onload），故 stub 全局 Image 触发 onerror，
    // 验证解码失败路径 reject 中文原因（生产 WebView 对损坏数据 URL 会真实触发 onerror）。
    const FakeImage = vi.fn(function (this: {
      naturalWidth: number
      naturalHeight: number
      onload: (() => void) | null
      onerror: (() => void) | null
    }) {
      this.naturalWidth = 1
      this.naturalHeight = 1
      this.onload = null
      this.onerror = null
    })
    Object.defineProperty(FakeImage.prototype, 'src', {
      set() {
        queueMicrotask(() => this.onerror?.())
      },
      get() {
        return ''
      },
    })
    vi.stubGlobal('Image', FakeImage)
    try {
      await expect(bytesToCoverInput([0x89, 0x50, 0x4e, 0x47, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00])).rejects.toThrow(
        '封面图片解码失败',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
