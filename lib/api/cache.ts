// lib/api/cache.ts
// 简单的服务端内存缓存，用于不常变化的数据（模型列表、策略列表等）。
// 注意：这是进程级缓存，多进程/无服务器部署时不适用。

interface CacheStore<T> {
  data: T | null
  timestamp: number
}

const stores = new Map<string, CacheStore<unknown>>()
// M1 修复：in-flight 请求去重（缓存击穿防护）——
// 缓存过期瞬间若有 N 个并发请求，仅第一个执行 fetcher，其余复用同一个 in-flight Promise，
// 避免全部穿透打到数据库。
const inflight = new Map<string, Promise<unknown>>()

/**
 * 缓存包装器：在 TTL 内命中直接返回缓存，否则执行 fetcher 并缓存结果。
 * 并发调用同一 key 时共享同一个 fetcher 执行（cache stampede 防护）。
 *
 * @param key      缓存键（如 'models-list', 'strategies-list'）
 * @param ttlMs    存活时间（毫秒）
 * @param fetcher  数据获取函数
 * @returns        缓存数据或新获取的数据
 */
export async function withCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const store = stores.get(key) as CacheStore<T> | undefined
  if (store && store.data !== null && Date.now() - store.timestamp < ttlMs) {
    return store.data
  }

  // 已有并发请求在执行同一 key 的 fetcher，直接复用其结果
  const existing = inflight.get(key)
  if (existing) {
    return existing as Promise<T>
  }

  const promise = (async () => {
    try {
      const data = await fetcher()
      stores.set(key, { data, timestamp: Date.now() })
      return data
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

/** 清除指定缓存（用于数据变更后刷新） */
export function invalidateCache(key: string): void {
  stores.delete(key)
}

/** 清除所有缓存 */
export function clearAllCache(): void {
  stores.clear()
  inflight.clear()
}
