// pm2.config.linux.js
// PM2 进程守护配置（Linux 版）：Next.js 生产模式 + Worker
//
// 启动前请先完成构建：
//   npm run build          # 前端
//   cd worker && npm run build    # worker
//
// 启动：  pm2 start pm2.config.linux.js
// 状态：  pm2 list
// 日志：  pm2 logs
// 自启：  pm2 save && pm2 startup systemd

const path = require('path')

module.exports = {
  apps: [
    {
      name: 'patent-frontend',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
      },
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '800M',
      out_file: './logs/pm2-frontend.out.log',
      error_file: './logs/pm2-frontend.err.log',
      merge_logs: true,
    },
    {
      name: 'patent-worker',
      script: 'dist/index.js',
      cwd: path.join(__dirname, 'worker'),
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '600M',
      out_file: './logs/pm2-worker.out.log',
      error_file: './logs/pm2-worker.err.log',
      merge_logs: true,
    },
  ],
}