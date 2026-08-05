// 授权门禁 store 单测（pre-release-check T1.1）：注入 env 桩（仿 theme.test.ts makeEnv 模式），
// 覆盖 isEulaAccepted（未同意 / 已同意 '1' / 其它值 / 存储不可用静默降级）、
// acceptEula 写 '1'、rejectEula 调 closeWindow、默认环境写 localStorage。
import { beforeEach, describe, expect, it } from 'vitest'

import type { EulaEnv } from './eula'
import {
  acceptEula,
  EULA_ACCEPTED_VALUE,
  EULA_STORAGE_KEY,
  isEulaAccepted,
  rejectEula,
} from './eula'

/** 构造可注入的授权环境桩（localStorage + closeWindow 轻量替身，仿 theme.test.ts makeEnv）。 */
function makeEnv(opts: { stored?: string | null } = {}) {
  const { stored = null } = opts
  let storedValue: string | null = stored
  const closed: Array<string> = []

  const env: EulaEnv = {
    readAccepted: () => storedValue,
    writeAccepted: () => {
      storedValue = EULA_ACCEPTED_VALUE // 镜像默认环境语义：写 '1'
    },
    closeWindow: () => {
      closed.push('closed')
    },
  }

  return {
    env,
    closed,
    getStored: () => storedValue,
  }
}

/**
 * 替换 window.localStorage 为抛错的假存储（模拟隐私模式等「存储不可用」），返回恢复函数。
 * 用 defineProperty 而非 vi.spyOn(Storage.prototype)：happy-dom 对 Storage.prototype
 * spy 在 restoreAllMocks 后二次 spy 不生效（vitest 已知怪癖），defineProperty 稳定。
 */
function stubStorageUnavailable() {
  const original = window.localStorage
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
      clear: () => {
        throw new Error('denied')
      },
      key: () => {
        throw new Error('denied')
      },
      length: 0,
    },
  })
  return () =>
    Object.defineProperty(window, 'localStorage', { configurable: true, value: original })
}

beforeEach(() => {
  // 默认环境用例会写真实 happy-dom localStorage，须逐用例清空避免串扰
  window.localStorage.clear()
})

describe('store/eula — isEulaAccepted（同步读，true 当且仅当持久化值为 \'1\'）', () => {
  it('无持久化记录 → false（首次启动，spec「首次启动弹出授权窗口」前提）', () => {
    const { env } = makeEnv()
    expect(isEulaAccepted(env)).toBe(false)
  })

  it('持久化 \'1\' → true（已同意，spec「已同意后二次启动不弹窗」）', () => {
    const { env } = makeEnv({ stored: '1' })
    expect(isEulaAccepted(env)).toBe(true)
  })

  it('持久化其它值 → false（仅 \'1\' 视为已同意）', () => {
    const { env } = makeEnv({ stored: '0' })
    expect(isEulaAccepted(env)).toBe(false)
  })

  it('存储不可用（localStorage 读抛错）→ 静默降级为 false，不抛错', () => {
    const restore = stubStorageUnavailable()
    try {
      // 无 env → 走默认环境：读 try/catch 静默降级 → false（本轮不弹、重启后重弹，可接受）
      expect(isEulaAccepted()).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('store/eula — acceptEula（写 \'1\'，二次启动不弹）', () => {
  it('注入桩：写 \'1\' 并变为已同意', () => {
    const { env, getStored } = makeEnv()
    expect(isEulaAccepted(env)).toBe(false)

    acceptEula(env)

    expect(getStored()).toBe('1')
    expect(isEulaAccepted(env)).toBe(true)
  })

  it('默认环境：acceptEula 落盘 localStorage(key, \'1\')（持久化语义）', () => {
    acceptEula()
    expect(window.localStorage.getItem(EULA_STORAGE_KEY)).toBe('1')
  })

  it('存储不可用（localStorage 写抛错）→ 静默降级不抛错（重启后重弹，可接受）', () => {
    const restore = stubStorageUnavailable()
    try {
      expect(() => acceptEula()).not.toThrow()
      // 未持久化成功 → 仍视为未同意
      expect(isEulaAccepted()).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('store/eula — rejectEula（拒绝即退出应用，不写持久化）', () => {
  it('注入桩：调用 closeWindow（Tauri 关窗），且不写同意记录', () => {
    const { env, closed, getStored } = makeEnv({ stored: null })
    expect(getStored()).toBeNull()

    rejectEula(env)

    expect(closed).toEqual(['closed'])
    expect(getStored()).toBeNull() // 拒绝不写持久化 → 二次启动仍弹
  })
})
