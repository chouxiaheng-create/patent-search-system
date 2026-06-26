import { describe, it, expect } from 'vitest'
import { withTimeout } from '../../worker/src/utils/retry'

describe('withTimeout', () => {
  it('原 Promise 先完成时返回其结果', async () => {
    const r = await withTimeout(new Promise<string>(res => res('ok')), 2000, 'test')
    expect(r).toBe('ok')
  })

  it('超时后 reject 并带 label', async () => {
    // 永不 resolve 的 Promise，模拟 DB/RPC 挂起
    const hung = new Promise<string>(() => {})
    await expect(withTimeout(hung, 50, 'rpc-call')).rejects.toThrow(/rpc-call 超时/)
  })

  it('原 Promise reject 时透传错误', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 2000, 'test')).rejects.toThrow('boom')
  })
})
