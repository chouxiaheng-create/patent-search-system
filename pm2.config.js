// pm2.config.js
// PM2 进程守护配置：前台 Next.js（生产模式）+ 后台 worker
//
// 启动：  pm2 start pm2.config.js
// 查看：  pm2 monit / pm2 list / pm2 logs
// 重载：  pm2 reload patent-frontend
// 停止：  pm2 stop all
// 自启：  pm2 save && pm2 startup  （按提示执行返回的命令，需管理员）

module.exports = {
  apps: [
    {
      name: 'patent-frontend',
      cwd: 'D:/Claude Code Files/Project_Patent search system_v1',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      // 绑 3000，让 Nginx 反代到 80
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '127.0.0.1',
      },
      // 异常退出自动拉起，最多 10 次
      max_restarts: 10,
      min_uptime: '10s',
      // 内存超 800MB 重启
      max_memory_restart: '800M',
      // 输出日志
      out_file: './logs/pm2-frontend.out.log',
      error_file: './logs/pm2-frontend.err.log',
      merge_logs: true,
    },
    {
      name: 'patent-worker',
      cwd: 'D:/Claude Code Files/Project_Patent search system_v1/worker',
      // chcp 65001 + node dist/index.js（Windows 强制 UTF-8，避免中文编码错乱）
      script: 'node',
      args: 'dist/index.js',
      // worker 自己写 health 在 3001
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