// lib/api/errors.ts
// 业务异常类型，携带 HTTP 状态码，被 withApiHandler 识别后透传响应码。
//
// 分层规则：lib/ 是低层基础设施，app/ 是高层路由。低层定义，高层消费，
// 所以 ApiError 必须放在 lib/api/errors.ts，不能放在 app/api/admin/*。
// 高层（如 app/api/admin/require-admin.ts）可选择 re-export 保持旧 import 路径可用。

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}
