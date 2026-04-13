// worker/src/index.ts
import { PgBoss } from 'pg-boss'
import { startHealthServer } from './health'

const DATABASE_URL = process.env.DATABASE_URL!

async function main() {
  console.log('[Worker] Starting...')

  // 启动健康检查服务（Render 部署需要）
  startHealthServer(Number(process.env.PORT) || 3001)

  const boss = new PgBoss(DATABASE_URL)

  boss.on('error', (err: Error) => {
    console.error('[pg-boss] Error:', err)
  })

  await boss.start()
  console.log('[Worker] pg-boss started')

  // parse-job handler（文献解析任务，Plan 3 实现）
  await boss.work('parse-job', { localConcurrency: 1 }, async (jobs) => {
    const job = jobs[0]
    console.log(`[parse-job] Received job ${job.id}`)
    // TODO: Plan 3 中实现
  })

  // search-job handler（检索任务，Plan 4 实现）
  await boss.work('search-job', { localConcurrency: 1 }, async (jobs) => {
    const job = jobs[0]
    console.log(`[search-job] Received job ${job.id}`)
    // TODO: Plan 4 中实现
  })

  console.log('[Worker] Ready and listening for jobs')
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err)
  process.exit(1)
})
