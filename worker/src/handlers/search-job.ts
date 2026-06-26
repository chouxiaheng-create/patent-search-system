// worker/src/handlers/search-job.ts
import type { Job } from 'pg-boss'
import {
  getModel, getStrategy, getJob, getDocument, updateJob, updateTaskStatus,
  getSearchTasks, createSearchTasks, resetTasksToPending, getPlatformNames, getStrategyNames
} from '../services/supabase'
import { sendNotification } from '../services/notification'
import { createAdapter } from '../adapters'
import { fillPromptTemplate, parseSearchResults, filterByQuality, ParsedData, SearchResult } from '../utils/prompt'
import { generateReport } from '../services/report'
import { callWithRetry, sleep } from '../utils/retry'
import { handleJobFailure } from '../services/job-retry'

interface SearchJobData {
  jobId: string
}

interface ModelFeatureOverride {
  model_id: string
  enable_thinking: boolean
  enable_web_search: boolean
}

type EnrichedResult = SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }

/** 同模型组内最大并发数（避免单个 API 限流）*/
const MAX_CONCURRENT_PER_MODEL = 2
/** 单个搜索任务AI调用超时，10分钟。
 *  Kimi K2.6 的 $web_search 多步调用（1次工具触发+服务端搜索+1次合成）在复杂 prompt
 *  下需要 5-8 分钟，5 分钟会导致超时 abandoned。智谱 DeepSeek 千问也类似 */
const SEARCH_TASK_TIMEOUT_MS = 10 * 60 * 1000

/** 单次尝试硬超时（25 分钟）。
 *  整个 execution 套此上限；到点强制 throw → catch → handleJobFailure（重排或判 failed）。
 *  pg-boss expirein 设为 30min（>25min），避免在跑期间被 pg-boss 过早 expire/重复执行。 */
const HARD_TIMEOUT_MS = 25 * 60 * 1000

export async function handleSearchJob(jobs: Job<SearchJobData>[]): Promise<void> {
  const job = jobs[0]
  const { jobId } = job.data

  console.log(`[search-job] Starting job ${job.id}, jobId: ${jobId}`)

  // 取消检查：每 5s 轮询 search_jobs.status，若被取消则置标志，执行循环会在批次边界退出
  let cancelled = false
  const cancelCheckInterval = setInterval(async () => {
    try {
      const jobRow = await getJob(jobId).catch(() => null)
      if (jobRow && jobRow.status === 'cancelled') {
        cancelled = true
        clearInterval(cancelCheckInterval)
      }
    } catch {
      // 忽略错误
    }
  }, 5000)

  // 硬超时 guard：到点 reject，强制结束 execution
  let hardTimer: NodeJS.Timeout | undefined
  const hardTimeout = new Promise<never>((_, reject) => {
    hardTimer = setTimeout(() => reject(new Error(`检索任务硬超时（${HARD_TIMEOUT_MS / 60000} 分钟）`)), HARD_TIMEOUT_MS)
  })

  try {
    // 整个执行体（含 getJob/getDocument/createSearchTasks/generateReport）都置于硬超时 race 之下，
    // 保证任何一步挂起都不会让 handler 永不返回（pg-boss 无法强杀在跑的 JS Promise，故须自保）。
    const execution = (async () => {
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

      // 4. 确保子任务存在（幂等：首次创建；重跑时返回已有），再取完整记录（含 results）
      await createSearchTasks(jobId, config.model_ids, config.strategy_ids)
      const tasks = await getSearchTasks(jobId)

      // 5. 分流：done 保留，非 done 重置为 pending 后重跑
      //    —— 同时服务首次运行、自动重排、手动部分重试三种场景，无需 flag
      const doneTasks = tasks.filter((t: Record<string, unknown>) => t.status === 'done')
      const toRun = tasks.filter((t: Record<string, unknown>) => t.status !== 'done')
      if (toRun.length > 0) {
        await resetTasksToPending(toRun.map((t: Record<string, unknown>) => t.id as string))
      }
      console.log(`[search-job] Job ${jobId}: ${doneTasks.length} done, ${toRun.length} to-run`)

      // 6. 种子 allResults：从已成功子任务的 results 展平并打来源标签
      const allResults: EnrichedResult[] = await seedResultsFromDoneTasks(doneTasks, config)

      // 7. 并发执行 toRun（按模型分组：模型间并行，同模型内最多 MAX_CONCURRENT_PER_MODEL）
      if (!cancelled && toRun.length > 0) {
        const tasksByModel = new Map<string, Array<Record<string, unknown>>>()
        for (const task of toRun) {
          const mid = task.model_id as string
          if (!tasksByModel.has(mid)) tasksByModel.set(mid, [])
          tasksByModel.get(mid)!.push(task)
        }

        const modelPromises = Array.from(tasksByModel.entries()).map(async ([, modelTasks]) => {
          const results: EnrichedResult[] = []
          for (let i = 0; i < modelTasks.length; i += MAX_CONCURRENT_PER_MODEL) {
            if (cancelled) break
            const batch = modelTasks.slice(i, i + MAX_CONCURRENT_PER_MODEL)
            const batchResults = await Promise.all(
              batch.map(task => executeSingleTask(
                { id: task.id as string, model_id: task.model_id as string, strategy_id: task.strategy_id as string },
                parsedData, config, jobId, userId
              ))
            )
            for (const taskResults of batchResults) {
              results.push(...taskResults)
            }
            // 批次间短暂等待，给 API 限流缓冲
            if (i + MAX_CONCURRENT_PER_MODEL < modelTasks.length) {
              await sleep(500)
            }
          }
          return results
        })

        const allModelResults = await Promise.all(modelPromises)
        for (const modelResults of allModelResults) {
          allResults.push(...modelResults)
        }
      }

      // 8. 检查是否被取消
      if (cancelled) {
        console.log(`[search-job] Job ${jobId} was cancelled during execution`)
        return
      }

      // 9. 生成报告（generateReport 内部会先删旧报告再插入）
      await generateReport(jobId, userId, allResults, config)

      // 10. 更新状态为 'completed'
      await updateJob(jobId, { status: 'completed', completed_at: new Date().toISOString() })

      // 11. 发送通知
      await sendNotification(userId, 'job_completed', `检索任务完成，共找到 ${allResults.length} 篇文献`, jobId)

      console.log(`[search-job] Job ${jobId} completed successfully`)
    })()

    // 吞掉被硬超时放弃后 execution 迟到的 rejection，避免 unhandledReclamation 崩溃 worker
    execution.catch(() => {})

    await Promise.race([execution, hardTimeout])

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[search-job] Job ${jobId} failed: ${message}`)

    // 失败处理：retry_count < MAX 则重排（带 30s 退避），否则判 failed。
    // handleJobFailure 内部所有 DB/RPC await 均有 withTimeout，收尾不会挂住。
    await handleJobFailure(jobId, message)
  } finally {
    if (hardTimer) clearTimeout(hardTimer)
    clearInterval(cancelCheckInterval)
  }
}

/**
 * 从已成功（done）子任务的结果展平，打上 source_task_id/source_platform/source_strategy 标签，
 * 作为后续 generateReport 的种子结果（部分重试时保留已成功项）。
 */
async function seedResultsFromDoneTasks(
  doneTasks: Array<Record<string, unknown>>,
  config: { model_ids: string[]; strategy_ids: string[] }
): Promise<EnrichedResult[]> {
  if (doneTasks.length === 0) return []

  const modelNames = await getPlatformNames(config.model_ids)
  const strategyNames = await getStrategyNames(config.strategy_ids)
  const modelNameMap = new Map(config.model_ids.map((id, i) => [id, modelNames[i] || id]))
  const strategyNameMap = new Map(config.strategy_ids.map((id, i) => [id, strategyNames[i] || id]))

  const seeded: EnrichedResult[] = []
  for (const t of doneTasks) {
    const results = (Array.isArray(t.results) ? t.results : []) as SearchResult[]
    const platform = modelNameMap.get(t.model_id as string) || String(t.model_id)
    const strategy = strategyNameMap.get(t.strategy_id as string) || String(t.strategy_id)
    for (const r of results) {
      seeded.push({ ...r, source_task_id: t.id as string, source_platform: platform, source_strategy: strategy })
    }
  }
  return seeded
}

async function executeSingleTask(
  task: { id: string; model_id: string; strategy_id: string },
  parsedData: ParsedData,
  config: { model_ids: string[]; strategy_ids: string[]; per_task_limit: number; report_limit: number; report_model_id: string; model_feature_overrides?: ModelFeatureOverride[] },
  jobId: string,
  userId: string
): Promise<EnrichedResult[]> {
  // 获取模型和策略（不参与重试）
  const model = await getModel(task.model_id)
  const strategy = await getStrategy(task.strategy_id)
  const featureOverride = config.model_feature_overrides?.find(o => o.model_id === task.model_id)
  const enableThinking = featureOverride?.enable_thinking ?? true
  // 联网搜索开关：
  // - 用户可显式覆盖（featureOverride）
  // - 模型配置 web_search_method='none' 时强制关闭
  // - 追踪检索 + Kimi/MiniMax 等不稳定联网模型时默认关闭（因为这些模型在精确查找时经常 0 results）
  const modelSupportsWebSearch = model.adapter_config?.web_search_method && model.adapter_config.web_search_method !== 'none'
  const isUnstableSearchModel = ['kimi', 'metaso'].includes(model.adapter_config?.provider || '')
  const isTrackingStrategy = strategy.name === '追踪检索'
  const enableWebSearch = (featureOverride?.enable_web_search ?? true)
    && modelSupportsWebSearch
    && !(isUnstableSearchModel && isTrackingStrategy)  // 追踪检索对 Kimi/MiniMax 关闭联网，回退到知识生成
  console.log(`[search-job] Task ${task.id.substring(0,8)} | model=${model.name} | strategy=${strategy.name} | provider=${model.adapter_config?.provider} | enableWebSearch=${enableWebSearch} (supports=${modelSupportsWebSearch}, unstable=${isUnstableSearchModel}, tracking=${isTrackingStrategy})`)
  const prompt = fillPromptTemplate(strategy.prompt_template, parsedData)
  const adapter = createAdapter(model)

  // 根据是否启用联网搜索，构造不同的系统提示
  const SEARCH_SYSTEM_PROMPT = enableWebSearch
    ? `你是一个专业专利检索专家。你的任务是通过联网搜索工具查找相关文献，并以JSON数组格式返回。

【核心原则】
你只能返回通过联网搜索工具实际检索到的文献。严禁根据记忆、训练数据或推测生成任何文献信息。如果你无法使用搜索工具或搜索未返回结果，必须返回空数组[]。宁可少返回几条真实结果，也不要返回任何编造的条目。

【字段规则 - 务必严格遵循】
1. **title**：必须与搜索结果页面显示的标题完全一致，不要缩写或改写
2. **url**：必须是搜索结果中提供的真实可访问链接（https://开头），不要拼接或推测URL
3. **authors**：**必须**从搜索结果中提取真实的作者/发明人姓名。多人用分号分隔（"张三;李四;王五"）。**严禁随意填"未知"**——搜索结果中通常会有作者信息（如 arXiv 论文作者、Google Scholar 引用作者、专利发明人）。**只有搜索结果中确实没有作者信息时才填"未知"**。
4. **pub_date**：从搜索结果中提取真实公开时间，YYYY-MM-DD 格式。无法确定时填""
5. **relevance_desc**：基于搜索结果摘要内容，详细说明与待审专利的关联分析（**至少30字**，最好50字以上）。需要包含：与待审专利的哪个技术特征相关、采用了什么方法、效果如何
6. **citation_gb**：GB/T 7714引用格式，如"作者. 题名[J/OL]. 平台, 年份."

【特别提示】
- arXiv 论文：作者信息通常在搜索结果中显示（如"Authors: John Smith, Jane Doe"），请务必提取
- 专利文献：发明人/专利权人信息是关键字段，请提取
- 学术搜索结果：作者、时间、摘要都是核心信息，不要忽略

【输出格式】
[{"title":"...","url":"https://...","authors":"...","pub_date":"YYYY-MM-DD","relevance_desc":"...","citation_gb":"..."}]

仅返回JSON数组，不要markdown代码块、不要额外说明。未找到文献则返回[]。`
    : `你是一个专业专利检索专家。当前任务**未启用联网搜索**，请基于你的训练知识返回与待审专利最相关的文献。

【核心原则】
1. 优先返回你最确定真实存在的、有据可查的专利或学术文献（如顶级会议/期刊论文、知名专利）
2. url 字段：如果不确定准确链接，填 "https://patents.google.com/" 类似的通用入口（不要瞎编不存在的URL）
3. 严禁完全编造不存在的作者或日期。如果不确定，对应字段填"未知"或空字符串
4. 宁可少返回几条，也不要生成大量虚假数据

【字段规则 - 务必严格遵循】
1. **title**：文献的完整标题
2. **url**：尽量填真实可访问链接，不确定则填通用搜索入口
3. **authors**：作者/发明人姓名，多人用分号分隔（如"张三;李四"）。**对于你非常确定真实存在的经典文献，必须填写真实作者名**（如 ResNet 的作者"何恺明;张祥雨;任少卿;孙剑"）。只有不确定时才填"未知"
4. **pub_date**：YYYY-MM-DD 格式，无法确定则填""
5. **relevance_desc**：基于文献内容与待审专利的关联分析（**至少30字**，最好50字以上）。需要说明技术相似点
6. **citation_gb**：GB/T 7714引用格式

【输出格式】
[{"title":"...","url":"https://...","authors":"...","pub_date":"YYYY-MM-DD","relevance_desc":"...","citation_gb":"..."}]

仅返回JSON数组，不要markdown代码块、不要额外说明。`

  try {
    await updateTaskStatus(task.id, 'running', { retry_count: 0, started_at: new Date().toISOString() })

    const result = await callWithRetry(async () => {
      const r = await adapter.call({
        modelId: model.model_id,
        prompt,
        systemPrompt: SEARCH_SYSTEM_PROMPT,
        enableThinking,
        enableWebSearch,
        timeout: SEARCH_TASK_TIMEOUT_MS
      })
      if (!r.success) throw new Error(r.error!)
      return r
    }, {
      maxRetries: 3,
      baseDelayMs: 3000,
      onRetry: async (attempt) => {
        await updateTaskStatus(task.id, 'retrying', {
          retry_count: attempt,
          started_at: new Date().toISOString()
        })
      }
    })

    // 记录原始 AI 响应（用于问题追溯）
    const rawContent = result.content || ''
    console.log(`[search-job] Task ${task.id}: AI原始响应 ${rawContent.length} 字符, 前200字: ${rawContent.substring(0, 200).replace(/\n/g, '\\n')}`)

    const rawResults = parseSearchResults(rawContent, config.per_task_limit * 2)  // 多取一些用于过滤
    console.log(`[search-job] Task ${task.id}: 解析出 ${rawResults.length} 条结果`)

    // 质量过滤：剔除低质量结果（分数 < 50）
    const MIN_QUALITY_SCORE = 50
    const { passed: searchResults, filtered } = filterByQuality(rawResults, MIN_QUALITY_SCORE)

    // 记录被过滤的结果
    if (filtered.length > 0) {
      console.log(`[search-job] Task ${task.id}: filtered ${filtered.length} low-quality results:`)
      for (const f of filtered) {
        console.log(`  - "${f.title}" (score: ${f.quality_score}, warnings: ${f.quality_warnings?.join(', ')})`)
      }
    }

    // 限制最终返回数量
    const finalResults = searchResults.slice(0, config.per_task_limit)

    await updateTaskStatus(task.id, 'done', {
      results: finalResults,
      completed_at: new Date().toISOString()
    })

    return finalResults.map(r => ({
      ...r,
      source_task_id: task.id,
      source_platform: model.name,
      source_strategy: strategy.name
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[search-job] Task ${task.id} abandoned: ${message}`)
    await updateTaskStatus(task.id, 'abandoned', {
      error_msg: message,
      completed_at: new Date().toISOString()
    })
    return []
  }
}
