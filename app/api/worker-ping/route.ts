import { NextRequest } from 'next/server'

export async function GET(_request: NextRequest) {
  const workerUrl = process.env.WORKER_URL
  if (workerUrl) {
    fetch(`${workerUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => {})
  }
  return Response.json({ ok: true })
}
