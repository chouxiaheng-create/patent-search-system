import type { Job } from 'pg-boss'
import { parseFile, FileType } from '../parsers'
import { getModel, updateDocument, getDocument, downloadFile } from '../services/supabase'
import { sendNotification } from '../services/notification'
import { buildParsePrompt, extractParsedData } from '../utils/prompt'
import { createAdapter } from '../adapters'
import { callWithRetry, withTimeout } from '../utils/retry'

interface ParseJobData {
  documentId: string
  parseModelId: string
  parseSystemPrompt?: string
}

/** H8：解析任务硬超时（20 分钟）。AI 调用 300s×3 次重试+退避已达 ~15min，加解析与收尾余量。 */
const PARSE_HARD_TIMEOUT_MS = 20 * 60 * 1000
/** 文件解析（pdf/xlsx/docx/txt）单次超时：防止畸形文件让解析卡死 */
const FILE_PARSE_TIMEOUT_MS = 5 * 60 * 1000

export async function handleParseJob(jobs: Job<ParseJobData>[]): Promise<void> {
  const job = jobs[0]
  const { documentId, parseModelId, parseSystemPrompt } = job.data

  console.log(`[parse-job] Starting job ${job.id}, document: ${documentId}`)

  // H8：硬超时 guard，防止任何一步挂起导致 handler 永不返回（阻塞整个 parse 队列）
  let hardTimer: NodeJS.Timeout | undefined
  let hardAborted = false
  const hardTimeout = new Promise<never>((_, reject) => {
    hardTimer = setTimeout(() => {
      hardAborted = true
      reject(new Error(`解析任务硬超时（${PARSE_HARD_TIMEOUT_MS / 60000} 分钟）`))
    }, PARSE_HARD_TIMEOUT_MS)
  })

  try {
    const execution = (async () => {
      // 1. 获取文档信息
      const doc = await getDocument(documentId)
      const userId = doc.user_id

      // 2. 更新状态为 'parsing'
      await updateDocument(documentId, { parse_status: 'parsing' })

      // 3. 从 Storage 下载文件（downloadFile 内部有 50MB 大小限制，H7）
      const fileBuffer = await downloadFile(doc.file_url)

      // 4. 解析文件（套超时，防畸形文件卡死）
      const parseResult = await withTimeout(parseFile(fileBuffer, doc.file_type as FileType), FILE_PARSE_TIMEOUT_MS, 'parseFile')

      // 5. 获取 AI 模型并调用
      const model = await getModel(parseModelId)
      const adapter = createAdapter(model)

      const parsePrompt = buildParsePrompt(parseResult.text, parseSystemPrompt)
      const aiResult = await callWithRetry(() => adapter.call({
        modelId: model.model_id,
        prompt: parsePrompt,
        enableThinking: true,
        timeout: 300000
      }), { maxRetries: 3, baseDelayMs: 2000 })

      if (!aiResult.success) {
        throw new Error(`AI解析失败: ${aiResult.error}`)
      }
      if (hardAborted) {
        console.log(`[parse-job] Job ${job.id} hit hard timeout, aborting`)
        return
      }

      // 6. 解析 AI 返回的结构化数据
      const parsedData = extractParsedData(aiResult.content!)

      // 7. 更新文档记录
      const newStatus = parseResult.qualityWarning ? 'needs_review' : 'done'
      await updateDocument(documentId, {
        parse_status: newStatus,
        parsed_data: parsedData,
        quality_warning: parseResult.qualityWarning
      })

      // 8. 发送通知
      const message = parseResult.qualityWarning
        ? `文档 "${doc.title}" 解析完成，请人工审查解析结果`
        : `文档 "${doc.title}" 解析完成`
      await sendNotification(userId, 'parse_done', message)

      console.log(`[parse-job] Completed job ${job.id}, status: ${newStatus}`)
    })()

    // 吞掉被硬超时放弃后 execution 迟到的 rejection，避免 unhandled rejection 崩溃 worker
    execution.catch(() => {})

    await Promise.race([execution, hardTimeout])

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[parse-job] Job ${job.id} failed: ${message}`)

    // 更新文档状态为失败
    await updateDocument(documentId, { parse_status: 'failed' }).catch(() => {})

    // 获取用户 ID 发送通知
    const doc = await getDocument(documentId).catch(() => null)
    if (doc) {
      await sendNotification(doc.user_id, 'parse_failed', `文档 "${doc.title}" 解析失败: ${message}`)
    }

    throw error
  } finally {
    if (hardTimer) clearTimeout(hardTimer)
  }
}
