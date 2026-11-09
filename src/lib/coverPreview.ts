// 候选封面缩略图加载（Issue #192 路线 2）：
// 复用后端 `download_cover`（Rust reqwest，5s 超时 / 12MB 限流），拉回 bytes 后由
// lib/cover.ts::coverBytesToDataUrl 转 data URL 直接渲染，绕开 WKWebView 的外链图片加载。
//
// 并发限流：一次搜索最多 15 条候选，全部同时打 IPC 会挤占带宽；这里限制 4 个并发，
// 其余排队。切歌 / 重搜的结果由 CoverCandidate 用 coverSearchSeq 守卫丢弃（本模块不缓存）。
import { downloadCover } from '../api/search'

/** 同时进行的缩略图下载数上限。 */
const MAX_CONCURRENT = 4

let active = 0
const waiting: Array<() => void> = []

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => {
      active += 1
      resolve()
    })
  })
}

function release(): void {
  active -= 1
  waiting.shift()?.()
}

/**
 * 下载一张候选封面（裸 bytes）。失败 reject，由调用方降级到占位格（不报错、不标红）。
 * 并发超过上限时排队等待，先到先服务。
 */
export async function loadCoverPreview(url: string): Promise<number[]> {
  await acquire()
  try {
    return await downloadCover(url)
  } finally {
    release()
  }
}
