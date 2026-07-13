// lib/api/cache.ts
// 简单的服务端内存缓存，用于不常变化的数据（模型列表、策略列表等）。
// 注意：这是进程级缓存，多进程/无服务器部署时不适用。

interface CacheStore<T> {
  data: T | null
  timestamp: number
}

const stores = new Map<string, CacheStore<unknown>>()

/**
 * 缓存包装器：在 TTL 内命中直接返回缓存，否则执行 fetcher 并缓存结果。
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
  const data = await fetcher()
  stores.set(key, { data, timestamp: Date.now() })
  return data
}

/** 清除指定缓存（用于数据变更后刷新） */
export function invalidateCache(key: string): void {
  stores.delete(key)
}

/** 清除所有缓存 */
export function clearAllCache(): void {
  stores.clear()
}
