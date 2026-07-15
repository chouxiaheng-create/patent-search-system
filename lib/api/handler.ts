// lib/api/handler.ts
// Next.js App Router API 路由的通用错误包装器。
// 把所有未捕获异常都转换成 JSON 响应，避免前端拿到 HTML 错误页时解析 JSON 失败。
//
// 注意：不使用泛型类型，因为 Turbopack 在处理带 params 的路由时
// 会因泛型类型推断导致编译 worker 崩溃（Jest worker exceptions）。

import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from './errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiHandler = (request: NextRequest, context?: any) => Promise<Response>

/**
 * 包装 API route handler，捕获所有异常并返回 JSON 错误。
 *
 * 如果抛出的错误是 ApiError（如 requireAdmin() 抛的 401/403），用其 status；
 * 否则一律按 500 处理，避免泄漏堆栈。
 */
export function withApiHandler(handler: ApiHandler): ApiHandler {
  return async (request: NextRequest, context?: any) => {
    try {
      return await handler(request, context)
    } catch (error: unknown) {
      const method = request.method
      const url = (request as any).nextUrl?.toString?.() ?? request.url
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')

      // ApiError 携带业务状态码（如 401/403），原样返回
      if (error instanceof ApiError) {
        console.warn(`[API ${error.status}] ${method} ${url}: ${message}`)
        return NextResponse.json(
          { error: message, path: new URL(request.url).pathname },
          { status: error.status }
        )
      }

      console.error(`[API ERROR] ${method} ${url}: ${message}`, error)
      return NextResponse.json(
        { error: '服务器内部错误', detail: message, path: new URL(request.url).pathname },
        { status: 500 }
      )
    }
  }
}
