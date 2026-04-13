// worker/src/health.ts
import express from 'express'

export function startHealthServer(port = 3001) {
  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.listen(port, () => {
    console.log(`[Health] Server running on port ${port}`)
  })

  return app
}
