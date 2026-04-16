import { supabase } from './supabase'

export type NotificationType =
  | 'job_completed'
  | 'job_failed'
  | 'job_cancelled'
  | 'parse_done'
  | 'parse_failed'

export async function sendNotification(
  userId: string,
  type: NotificationType,
  message: string,
  jobId?: string
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    job_id: jobId ?? null,
    type,
    message,
    read_at: null
  })

  if (error) {
    console.error(`[notification] 发送通知失败: ${error.message}`)
  }
}
