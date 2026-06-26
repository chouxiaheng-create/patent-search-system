// worker/src/utils/retry.ts — 限流重试工具

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 给任意 PromiseLike 套一个超时上限（supabase 查询构造器是 thenable 但非 Promise，故用 PromiseLike + Promise.resolve 包一层）。
 * 超时后 reject（原 Promise 不会被取消，但其结果将被丢弃——用于保证调用方有界返回）。
 * 这是"卡住任务自动结束"的关键保证：DB/RPC 不可达时，handler 不会被永不返回的 await 拖死。
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}秒）`)), ms)
  })
  return Promise.race<T>([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** 检测是否为限流错误（429 或 rate_limit 相关） */
export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return /429|rate_limit|concurrency|too many requests/i.test(msg)
}

/** 从错误消息中提取建议等待秒数，默认 5 秒 */
export function parseRetryAfter(error: unknown): number {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  const match = msg.match(/try again after (\d+)\s*seconds?/i)
    || msg.match(/retry after (\d+)/i)
    || msg.match(/wait (\d+)\s*seconds?/i)
  return match ? parseInt(match[1], 10) : 5
}

/** 带抖动的等待 */
function jitter(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs * 0.5)
}

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  onRetry?: (attempt: number, delayMs: number, error: unknown) => Promise<void> | void
}

/**
 * 执行异步函数，遇到限流错误时自动重试（指数退避 + 抖动）。
 * 非限流错误直接抛出，不重试。
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 2000, onRetry } = options

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= maxRetries) throw error
      if (!isRateLimitError(error)) throw error

      const suggestedWait = parseRetryAfter(error)
      const delayMs = Math.max(suggestedWait * 1000, baseDelayMs * Math.pow(2, attempt))
      const waitMs = jitter(delayMs)

      if (onRetry) {
        await onRetry(attempt + 1, waitMs, error)
      } else {
        console.log(`[retry] Rate limited, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`)
      }

      await sleep(waitMs)
    }
  }

  throw new Error('unreachable')
}

