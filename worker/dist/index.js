"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// worker/src/index.ts
const pg_boss_1 = require("pg-boss");
const health_1 = require("./health");
const parse_job_1 = require("./handlers/parse-job");
const search_job_1 = require("./handlers/search-job");
const DATABASE_URL = process.env.DATABASE_URL;
async function main() {
    console.log('[Worker] Starting...');
    // 启动健康检查服务
    (0, health_1.startHealthServer)(Number(process.env.PORT) || 3001);
    const boss = new pg_boss_1.PgBoss(DATABASE_URL);
    boss.on('error', (err) => {
        console.error('[pg-boss] Error:', err);
    });
    await boss.start();
    console.log('[Worker] pg-boss started');
    // 注册任务处理器
    await boss.work('parse-job', { localConcurrency: 1 }, parse_job_1.handleParseJob);
    await boss.work('search-job', { localConcurrency: 1 }, search_job_1.handleSearchJob);
    console.log('[Worker] Ready and listening for jobs');
}
main().catch((err) => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
});
