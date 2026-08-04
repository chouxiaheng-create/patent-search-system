import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'url'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // 排除 git worktree 元数据目录：.worktrees 下的测试是其他分支的独立副本，
    // 且其 @ alias 会被解析到本目录，混入会测到"新代码+旧 mock"导致误报。
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**', '**/.worktrees/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
