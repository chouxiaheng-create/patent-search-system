// lib/api/handler.ts
// Next.js App Router API 路由的通用错误包装器。
// 把所有未捕获异常都转换成 JSON 响应，避免前端拿到 HTML 错误页时解析 JSON 失败。

import { NextRequest, NextResponse } from 'next/server'

type ApiHandler<P extends Record<string, string> = Record<string, string>> = (
  request: NextRequest,
  context: { params: Promise<P> }
) => Promise<Response>

/**
 * 包装 API route handler，捕获所有异常并返回 JSON 错误。
 * 同时会记录错误到服务端 console，方便排查。
 */
export function withApiHandler<P extends Record<string, string> = Record<string, string>>(
  handler: ApiHandler<P>
): ApiHandler<P> {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      return await handler(request, context)
    } catch (error: unknown) {
      const method = request.method
      const url = request.nextUrl.toString()
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
      console.error(`[API ERROR] ${method} ${url}: ${message}`, error)
      return NextResponse.json(
        { error: '服务器内部错误', detail: message, path: request.nextUrl.pathname },
        { status: 500 }
      )
    }
  }
}
