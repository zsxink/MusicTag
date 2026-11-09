// lib/coverPreview — 候选缩略图下载的并发限流（Issue #192 路线 2）。
// 注：「下载失败 → 占位降级」由 src/components/cover-panel.test.ts 的两个用例覆盖
// （该文件的 mock 上下文能如实传播 mock throw）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownload } = vi.hoisted(() => ({ mockDownload: vi.fn() }))
vi.mock('../api/search', () => ({ downloadCover: mockDownload }))

import { loadCoverPreview } from './coverPreview'

describe('lib/coverPreview — loadCoverPreview', () => {
  beforeEach(() => mockDownload.mockReset())

  it('成功 → 透传 download_cover 的裸 bytes', async () => {
    mockDownload.mockResolvedValue([0xff, 0xd8, 0xff])
    await expect(loadCoverPreview('https://x/1.jpg')).resolves.toEqual([0xff, 0xd8, 0xff])
    expect(mockDownload).toHaveBeenCalledWith('https://x/1.jpg')
  })

  it('超过并发上限的任务排队后仍能全部完成（不丢、不卡死）', async () => {
    mockDownload.mockResolvedValue([0xff, 0xd8, 0xff])
    const results = await Promise.all(
      Array.from({ length: 7 }, (_, i) => loadCoverPreview(`https://x/${i}.jpg`)),
    )
    expect(results).toHaveLength(7)
    expect(mockDownload).toHaveBeenCalledTimes(7)
  })
})
