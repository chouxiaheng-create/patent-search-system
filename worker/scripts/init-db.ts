// worker/scripts/init-db.ts
// 初始化 pg-boss 队列表
import 'dotenv/config'
import { PgBoss } from 'pg-boss'

const DATABASE_URL = process.env.DATABASE_URL!

async function main() {
  console.log('[Init] 连接到数据库...')
  const boss = new PgBoss(DATABASE_URL)

  boss.on('error', (err: Error) => {
    console.error('[Init] pg-boss error:', err)
  })

  console.log('[Init] 启动 pg-boss...')
  await boss.start()
  console.log('[Init] pg-boss 已启动，正在创建队列...')

  // 创建队列（会创建表）
  await boss.createQueue('parse-job')
  console.log('[Init] 队列 parse-job 已创建')

  await boss.createQueue('search-job')
  console.log('[Init] 队列 search-job 已创建')

  console.log('[Init] 关闭连接...')
  await boss.stop()
  console.log('[Init] 完成！')
}

main().catch((err) => {
  console.error('[Init] 初始化失败:', err)
  process.exit(1)
})
