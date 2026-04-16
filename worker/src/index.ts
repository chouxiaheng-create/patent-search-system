// worker/src/index.ts
import { PgBoss } from 'pg-boss'
import type { Job } from 'pg-boss'
import { startHealthServer } from './health'
import { handleParseJob } from './handlers/parse-job'
import { handleSearchJob } from './handlers/search-job'

const DATABASE_URL = process.env.DATABASE_URL!

async function main() {
  console.log('[Worker] Starting...')

  // 启动健康检查服务
  startHealthServer(Number(process.env.PORT) || 3001)

  const boss = new PgBoss(DATABASE_URL)

  boss.on('error', (err: Error) => {
    console.error('[pg-boss] Error:', err)
  })

  await boss.start()
  console.log('[Worker] pg-boss started')

  // 注册任务处理器
  await boss.work('parse-job', { localConcurrency: 1 }, handleParseJob as (job: Job<unknown>[]) => Promise<void>)
  await boss.work('search-job', { localConcurrency: 1 }, handleSearchJob as (job: Job<unknown>[]) => Promise<void>)

  console.log('[Worker] Ready and listening for jobs')
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err)
  process.exit(1)
})
