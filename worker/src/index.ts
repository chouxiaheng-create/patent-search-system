// worker/src/index.ts
// AI 检索后台 worker：消费 pg-boss 队列中的 parse-job / search-job 任务。

import 'dotenv/config'
import { PgBoss, type Job } from 'pg-boss'
import { startHealthServer } from './health'
import { handleParseJob } from './handlers/parse-job'
import { handleSearchJob } from './handlers/search-job'

// 选择连接串：DIRECT_DATABASE_URL 优先（直连，绕过池化）
// DIRECT_DATABASE_URL 例如：postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
// 若未设置则使用 DATABASE_URL（pg-boss 池化连接）
const CONNECTION_STRING = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL

if (!CONNECTION_STRING) {
  console.error('[Worker] FATAL: Neither DIRECT_DATABASE_URL nor DATABASE_URL is set in worker/.env')
  process.exit(1)
}

const USING_DIRECT = Boolean(process.env.DIRECT_DATABASE_URL)
console.log(`[Worker] Using ${USING_DIRECT ? 'DIRECT' : 'POOLER'} database connection`)

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function startBossWithRetry(maxAttempts = 5): Promise<PgBoss> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const boss = new PgBoss({
      connectionString: CONNECTION_STRING,
      max: 4,
      application_name: 'patent-worker',
      connectionTimeoutMillis: 15000,
      // Supabase pooler 的 SSL 握手会超时，禁用 SSL（数据仍通过 pooler 加密通道传输）
      ssl: false,
    })
    boss.on('error', (err: Error) => {
      console.error('[pg-boss] Error event:', err.message)
    })
    try {
      console.log(`[Worker] Starting pg-boss (attempt ${attempt}/${maxAttempts})...`)
      await boss.start()
      console.log('[Worker] pg-boss started successfully')
      return boss
    } catch (err) {
      lastError = err
      const msg = (err as Error).message
      console.warn(`[Worker] pg-boss start failed (attempt ${attempt}): ${msg}`)
      // 尽力清理失败的实例
      try { await boss.stop({ graceful: false }) } catch { /* ignore */ }
      if (attempt < maxAttempts) {
        const backoff = Math.min(15000, 2000 * Math.pow(2, attempt - 1))
        console.log(`[Worker] Retrying in ${backoff}ms...`)
        await sleep(backoff)
      }
    }
  }
  throw lastError
}

async function main() {
  console.log('[Worker] Starting...')

  startHealthServer(Number(process.env.PORT) || 3001)

  const boss = await startBossWithRetry()

  // 确保队列存在（首次运行时会建表）
  await boss.createQueue('parse-job')
  await boss.createQueue('search-job')
  console.log('[Worker] Queues ready')

  // 注册任务处理器
  await boss.work('parse-job', { localConcurrency: 1 }, handleParseJob as (job: Job<unknown>[]) => Promise<void>)
  await boss.work('search-job', { localConcurrency: 1 }, handleSearchJob as (job: Job<unknown>[]) => Promise<void>)

  console.log('[Worker] Ready and listening for jobs')

  // 优雅退出
  const shutdown = async (signal: string) => {
    console.log(`[Worker] Received ${signal}, shutting down...`)
    try {
      await boss.stop({ graceful: true, timeout: 10000 })
    } catch (err) {
      console.error('[Worker] Error during stop:', (err as Error).message)
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err)
  process.exit(1)
})