import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'

export const GET = withApiHandler(async (_request: NextRequest) => {
  const workerUrl = process.env.WORKER_URL
  if (workerUrl) {
    fetch(`${workerUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true })
})
