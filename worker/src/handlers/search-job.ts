// worker/src/handlers/search-job.ts
import type { Job } from 'pg-boss'
import { supabase, getModel, getStrategy, getJob, getDocument, updateJob, updateTaskStatus, getSearchTasks, createSearchTasks } from '../services/supabase'
import { sendNotification } from '../services/notification'
import { createAdapter } from '../adapters'
import { fillPromptTemplate, parseSearchResults, ParsedData, SearchResult } from '../utils/prompt'
import { generateReport } from '../services/report'

interface SearchJobData {
  jobId: string
}

interface ModelFeatureOverride {
  model_id: string
  enable_thinking: boolean
  enable_web_search: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function handleSearchJob(jobs: Job<SearchJobData>[]): Promise<void> {
  const job = jobs[0]
  const { jobId } = job.data

  console.log(`[search-job] Starting job ${job.id}, jobId: ${jobId}`)

  try {
    // 1. 检查任务是否已被取消
    const jobRecord = await getJob(jobId)

    if (jobRecord.status === 'cancelled') {
      console.log(`[search-job] Job ${jobId} was cancelled before start`)
      return
    }

    // 2. 更新状态为 'running'
    await updateJob(jobId, { status: 'running', started_at: new Date().toISOString() })

    // 3. 获取解析数据
    const doc = await getDocument(jobRecord.document_id)
    const parsedData = doc.parsed_data as ParsedData | null

    if (!parsedData) {
      throw new Error('文档解析数据为空')
    }

    const userId = doc.user_id
    const config = jobRecord.config

    // 4. 创建子任务记录
    const tasks = await createSearchTasks(jobId, config.model_ids, config.strategy_ids)

    // 5. 并发执行所有子任务
    const cancelCheckInterval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('search_jobs')
          .select('status')
          .eq('id', jobId)
          .single()

        if (data?.status === 'cancelled') {
          clearInterval(cancelCheckInterval)
        }
      } catch {
        // 忽略错误
      }
    }, 5000)

    try {
      // 收集所有结果
      const allResults: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }> = []

      for (const task of tasks) {
        const taskResults = await executeSingleTask(task, parsedData, config, jobId, userId)
        for (const r of taskResults) {
          allResults.push(r)
        }

        // 检查是否被取消
        const { data: currentJob } = await supabase
          .from('search_jobs')
          .select('status')
          .eq('id', jobId)
          .single()

        if (currentJob?.status === 'cancelled') {
          console.log(`[search-job] Job ${jobId} was cancelled during execution`)
          clearInterval(cancelCheckInterval)
          return
        }
      }

      clearInterval(cancelCheckInterval)

      // 6. 生成报告
      await generateReport(jobId, userId, allResults, config)

      // 7. 更新状态为 'completed'
      await updateJob(jobId, { status: 'completed', completed_at: new Date().toISOString() })

      // 8. 发送通知
      await sendNotification(userId, 'job_completed', `检索任务完成，共找到 ${allResults.length} 篇文献`, jobId)

      console.log(`[search-job] Job ${jobId} completed successfully`)

    } finally {
      clearInterval(cancelCheckInterval)
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[search-job] Job ${jobId} failed: ${message}`)

    await updateJob(jobId, { status: 'failed', completed_at: new Date().toISOString() }).catch(() => {})

    const jobRecord = await getJob(jobId).catch(() => null)
    if (jobRecord) {
      await sendNotification(jobRecord.user_id, 'job_failed', `检索任务失败: ${message}`, jobId)
    }

    throw error
  }
}

async function executeSingleTask(
  task: { id: string; model_id: string; strategy_id: string },
  parsedData: ParsedData,
  config: { model_ids: string[]; strategy_ids: string[]; per_task_limit: number; report_limit: number; report_model_id: string; model_feature_overrides?: ModelFeatureOverride[] },
  jobId: string,
  userId: string
): Promise<Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>> {
  const maxRetries = 1

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 更新状态
      await updateTaskStatus(task.id, attempt > 0 ? 'retrying' : 'running', {
        retry_count: attempt,
        started_at: new Date().toISOString()
      })

      // 获取模型和策略
      const model = await getModel(task.model_id)
      const strategy = await getStrategy(task.strategy_id)
      const adapter = createAdapter(model)

      // 获取功能开关配置
      const featureOverride = config.model_feature_overrides?.find(o => o.model_id === task.model_id)
      const enableThinking = featureOverride?.enable_thinking ?? true
      const enableWebSearch = featureOverride?.enable_web_search ?? true

      // 构建提示词
      const prompt = fillPromptTemplate(strategy.prompt_template, parsedData)

      // 调用 AI
      const result = await adapter.call({
        modelId: model.model_id,
        prompt,
        enableThinking,
        enableWebSearch,
        timeout: 600000
      })

      if (result.success) {
        const searchResults = parseSearchResults(result.content!, config.per_task_limit)

        await updateTaskStatus(task.id, 'done', {
          results: searchResults,
          completed_at: new Date().toISOString()
        })

        return searchResults.map(r => ({
          ...r,
          source_task_id: task.id,
          source_platform: model.name,
          source_strategy: strategy.name
        }))
      }

      throw new Error(result.error)

    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`[search-job] Task ${task.id} failed, retrying in 30s...`)
        await sleep(30000)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[search-job] Task ${task.id} abandoned: ${message}`)

        await updateTaskStatus(task.id, 'abandoned', {
          error_msg: message,
          completed_at: new Date().toISOString()
        })
      }
    }
  }

  return []
}
