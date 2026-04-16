import type { Job } from 'pg-boss'
import { parseFile, FileType } from '../parsers'
import { getModel, updateDocument, getDocumentById, downloadFile } from '../services/supabase'
import { sendNotification } from '../services/notification'
import { buildParsePrompt, extractParsedData } from '../utils/prompt'
import { createAdapter } from '../adapters'

interface ParseJobData {
  documentId: string
  parseModelId: string
  parseSystemPrompt?: string
}

export async function handleParseJob(jobs: Job<ParseJobData>[]): Promise<void> {
  const job = jobs[0]
  const { documentId, parseModelId, parseSystemPrompt } = job.data

  console.log(`[parse-job] Starting job ${job.id}, document: ${documentId}`)

  try {
    // 1. 获取文档信息
    const doc = await getDocumentById(documentId)
    const userId = doc.user_id

    // 2. 更新状态为 'parsing'
    await updateDocument(documentId, { parse_status: 'parsing' })

    // 3. 从 Storage 下载文件
    const fileBuffer = await downloadFile(doc.file_url)

    // 4. 解析文件
    const parseResult = await parseFile(fileBuffer, doc.file_type as FileType)

    // 5. 获取 AI 模型并调用
    const model = await getModel(parseModelId)
    const adapter = createAdapter(model)

    const parsePrompt = buildParsePrompt(parseResult.text, parseSystemPrompt)
    const aiResult = await adapter.call({
      modelId: model.model_id,
      prompt: parsePrompt,
      enableThinking: true,
      timeout: 600000
    })

    if (!aiResult.success) {
      throw new Error(`AI解析失败: ${aiResult.error}`)
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
    await sendNotification(userId, 'parse_done', message, documentId)

    console.log(`[parse-job] Completed job ${job.id}, status: ${newStatus}`)

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[parse-job] Job ${job.id} failed: ${message}`)

    // 更新文档状态为失败
    await updateDocument(documentId, { parse_status: 'failed' }).catch(() => {})

    // 获取用户 ID 发送通知
    const doc = await getDocumentById(documentId).catch(() => null)
    if (doc) {
      await sendNotification(doc.user_id, 'parse_failed', `文档 "${doc.title}" 解析失败: ${message}`, documentId)
    }

    throw error
  }
}
