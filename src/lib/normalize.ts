// lib/normalize — 比较侧归一化（fix-search-sources-locale D5/D10）。
//
// 管线与 Rust `searcher::norm` **逐条同规则同顺序**：`trim` → 繁→简折叠 → 全角转半角 → 小写。
// 顺序口径见 `src-tauri/src/service/searcher/mod.rs` 的 `norm()` Doc（折叠在前可让繁体的全角
// 标点与词条一并按原表语义处理；三者对同一字符集互不冲突）。
//
// 自 `src/store/song.ts` 的本地 `normalizeForMatch` **迁出**（原实现只有 `trim` + 全角半角 +
// 小写，本模块逐行保留那三步，只在前面插入折叠调用），目的是让它与后端打分归一化同规则，
// 避免 C2 换源出现「后端认为同曲、前端认为不同曲」的撕裂。
//
// **只用于比较侧**（唯一调用点是 `store/song.ts` 的 `findSameSong` → C2 换源身份校验），
// **绝不改写**候选的展示文本、点选填入表单的文本与写盘文本：用户从 iTunes HK 点选到的仍是
// 远端原文（如 `周杰倫`）。折叠只影响「能不能匹配上」，「存什么」是独立的产品决策。
//
// 无 Vue / Tauri 依赖（design.md §10.0 纯工具层）。
import { toSimplified } from './simplified'

/**
 * 归一化 `normalizeForMatch(s)`：`trim` → 繁→简折叠 → 全角转半角 → 小写。
 *
 * 供 C2 候选身份校验（`store/song.ts` 的 `findSameSong`）使用，规则与后端 `searcher::norm`
 * 完全一致——「取词失败自动换源」时前端用繁体关键词换源会拿回简体条目，只有比较侧折叠
 * 才能把二者判为同一首。
 */
export function normalizeForMatch(s: string): string {
  return toSimplified(s.trim())
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0)
      if (code === 0x3000) return ' ' // 全角空格
      if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0)
      return ch
    })
    .join('')
    .toLowerCase()
}
