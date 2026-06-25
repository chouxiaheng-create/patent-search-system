// worker/src/services/report.ts
import { supabase, getModel } from './supabase'
import { getSearchTasks, getPlatformNames, getStrategyNames } from './supabase'
import { createAdapter } from '../adapters'
import { ParsedData, SearchResult, buildSelectionPrompt, parseSelectionResult } from '../utils/prompt'
import { callWithRetry } from '../utils/retry'

type EnrichedResult = SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }

interface SelectedDoc {
  rank: number
  title: string
  authors: string
  url: string
  pub_date: string
  relevance_desc: string
  citation_gb: string
  source_platform: string
  source_strategy: string
  source_task_id: string
  user_rating: null
  warnings: string[]
}

interface PathSummary {
  platform: string
  strategy: string
  status: 'done' | 'abandoned'
  docCount: number
  errorMsg?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

interface ReportInput {
  jobId: string
  userId: string
  patentInfo: ParsedData
  searchPlatforms: string[]
  searchStrategies: string[]
  topDocs: SelectedDoc[]
  pathSummary: PathSummary[]
}

export async function generateReport(
  jobId: string,
  userId: string,
  allResults: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>,
  config: { model_ids: string[]; strategy_ids: string[]; per_task_limit: number; report_limit: number; report_model_id: string }
): Promise<void> {
  // 1. 获取子任务详情（用于路径摘要）
  const tasks = await getSearchTasks(jobId)
  const models = await getPlatformNames(config.model_ids)
  const strategies = await getStrategyNames(config.strategy_ids)

  // 2. 构建路径摘要（用 Map 匹配名称，避免 index 假设顺序一致的 bug）
  const modelNameMap = new Map(config.model_ids.map((id, i) => [id, models[i] || id]))
  const strategyNameMap = new Map(config.strategy_ids.map((id, i) => [id, strategies[i] || id]))

  const pathSummary: PathSummary[] = tasks.map((task: Record<string, unknown>) => {
    const started = task.started_at as string | undefined
    const completed = task.completed_at as string | undefined
    const durationMs = (started && completed)
      ? new Date(completed).getTime() - new Date(started).getTime()
      : undefined
    return {
      platform: modelNameMap.get(task.model_id as string) || String(task.model_id),
      strategy: strategyNameMap.get(task.strategy_id as string) || String(task.strategy_id),
      status: task.status as 'done' | 'abandoned',
      docCount: Array.isArray(task.results) ? task.results.length : 0,
      errorMsg: task.error_msg as string | undefined,
      startedAt: started,
      completedAt: completed,
      durationMs
    }
  })

  // 3. 去重
  const uniqueResults = deduplicateResults(allResults)

  // 4. 筛选 Top-N
  const topDocs = await selectTopDocs(jobId, uniqueResults, config)

  // 5. 生成 HTML
  const reportData: ReportInput = {
    jobId,
    userId,
    patentInfo: {},
    searchPlatforms: models,
    searchStrategies: strategies,
    topDocs,
    pathSummary
  }

  const htmlContent = buildHtmlReport(reportData)

  // 6. 写入数据库
  const { error } = await supabase.from('reports').insert({
    job_id: jobId,
    user_id: userId,
    html_content: htmlContent,
    selected_docs: topDocs,
    doc_count: topDocs.length,
    path_summary: pathSummary
  })

  if (error) throw new Error(`写入报告失败: ${error.message}`)
}

function deduplicateResults(results: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>): Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }> {
  const seen = new Map<string, typeof results[0]>()

  for (const result of results) {
    // 主键：优先使用 URL 去重
    const urlKey = result.url ? normalizeUrlForDedup(result.url) : null
    const titleKey = normalizeTitleForDedup(result.title)

    // URL 去重（同一篇文献在不同来源出现）
    if (urlKey && seen.has(urlKey)) {
      // 保留质量分数更高的版本
      const existing = seen.get(urlKey)!
      if ((result.quality_score || 0) > (existing.quality_score || 0)) {
        seen.set(urlKey, result)
      }
      continue
    }

    // 标题去重（处理专利族：相同标题但不同专利号）
    if (titleKey && seen.has(titleKey)) {
      const existing = seen.get(titleKey)!
      // 如果是专利族（相同标题，不同 URL），合并来源信息
      if (existing.url !== result.url) {
        // 保留质量分数更高的，但记录有多个来源
        if ((result.quality_score || 0) > (existing.quality_score || 0)) {
          seen.set(titleKey, {
            ...result,
            relevance_desc: `${result.relevance_desc} [注：该专利有多个公开版本]`
          })
        }
      }
      continue
    }

    // 添加新条目
    if (urlKey) seen.set(urlKey, result)
    if (titleKey) seen.set(titleKey, result)
    if (!urlKey && !titleKey) {
      // 无 URL 且无标题的情况，使用随机键（低质量，但仍保留）
      seen.set(`fallback_${seen.size}`, result)
    }
  }

  return Array.from(seen.values())
}

/**
 * 标准化 URL 用于去重比较
 * 去除协议前缀、www、尾部斜杠等差异
 */
function normalizeUrlForDedup(url: string): string {
  try {
    const parsed = new URL(url)
    let normalized = parsed.hostname + parsed.pathname
    // 去除尾部斜杠
    normalized = normalized.replace(/\/$/, '')
    // 去除 www 前缀
    normalized = normalized.replace(/^www\./, '')
    return normalized.toLowerCase()
  } catch {
    return url.toLowerCase().trim()
  }
}

/**
 * 标准化标题用于去重比较
 * 去除空格、标点等差异
 */
function normalizeTitleForDedup(title: string): string {
  if (!title || title.length < 5) return ''
  // 去除空格和常见标点
  return title
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,。.、；;：:！？!？]/g, '')
}

async function selectTopDocs(
  jobId: string,
  results: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>,
  config: { report_limit: number; report_model_id: string }
): Promise<SelectedDoc[]> {
  if (results.length === 0) return []

  const limit = config.report_limit

  if (results.length <= limit) {
    return results.map((r, i) => toSelectedDoc(r, i + 1))
  }

  // 获取专利信息
  let jobDocId: string | null = null
  try {
    const { data: job } = await supabase.from('search_jobs').select('document_id').eq('id', jobId).single()
    if (job) jobDocId = job.document_id
  } catch {
    // ignore
  }
  if (!jobDocId) return results.slice(0, limit).map((r, i) => toSelectedDoc(r, i + 1))

  let parsedData: ParsedData = {}
  try {
    const { data: doc } = await supabase.from('patent_documents').select('parsed_data').eq('id', jobDocId).single()
    if (doc) parsedData = (doc.parsed_data || {}) as ParsedData
  } catch {
    // ignore
  }

  // 调用汇总模型
  try {
    const model = await getModel(config.report_model_id)
    const adapter = createAdapter(model)
    const prompt = buildSelectionPrompt(parsedData, results, limit)
    const result = await callWithRetry(() => adapter.call({ modelId: model.model_id, prompt, enableThinking: true, timeout: 180000 }), { maxRetries: 2, baseDelayMs: 3000 })

    if (result.success) {
      const selectedResults = parseSelectionResult(result.content!, results, limit)
      return selectedResults.map((r, i) => toSelectedDoc(r as EnrichedResult, i + 1))
    }
  } catch {
    // 筛选失败，降级
  }

  return results.slice(0, limit).map((r, i) => toSelectedDoc(r, i + 1))
}

function toSelectedDoc(r: SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }, rank: number): SelectedDoc {
  // 使用预计算的质量警告，或重新计算
  const warnings: string[] = r.quality_warnings ? [...r.quality_warnings] : []

  // 添加额外的人工核实提示
  if (!r.authors || r.authors === '未知') {
    if (!warnings.includes('作者信息缺失')) {
      warnings.push('作者信息缺失，文献真实性存疑，请人工核实')
    }
  }
  if (!r.url || r.url === '无' || r.url === '未知') {
    if (!warnings.includes('缺少出处链接')) {
      warnings.push('出处链接缺失')
    }
  } else if (!r.url.startsWith('https://') && !r.url.startsWith('http://')) {
    warnings.push('出处链接格式异常，可能不可靠')
  }
  if (!r.title || r.title.startsWith('检索结果') || r.title.length < 5) {
    if (!warnings.includes('标题异常或不完整')) {
      warnings.push('文献标题异常或不完整')
    }
  }

  // 添加质量分数提示
  if (r.quality_score !== undefined && r.quality_score < 60) {
    warnings.push(`质量评分：${r.quality_score}/100（建议人工核实）`)
  }

  return {
    rank,
    title: r.title,
    authors: r.authors,
    url: r.url,
    pub_date: r.pub_date,
    relevance_desc: r.relevance_desc,
    citation_gb: r.citation_gb,
    source_platform: r.source_platform,
    source_strategy: r.source_strategy,
    source_task_id: r.source_task_id,
    user_rating: null,
    warnings
  }
}

function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return '-'
  if (ms < 1000) return Math.round(ms) + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(1) + '秒'
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return minutes + '分' + seconds + '秒'
}

function buildHtmlReport(data: ReportInput): string {
  const { topDocs, pathSummary, searchPlatforms, searchStrategies } = data

  // 统计总耗时
  const totalDurationMs = pathSummary.reduce((sum, p) => sum + (p.durationMs || 0), 0)

  // 统计质量问题
  const warnedDocs = topDocs.filter(d => d.warnings.length > 0)
  const missingAuthors = topDocs.filter(d => !d.authors || d.authors === '未知').length
  const missingDates = topDocs.filter(d => !d.pub_date).length
  const missingUrls = topDocs.filter(d => !d.url || d.url === '无').length

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>专利检索报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1e293b; }
    h1 { font-size: 24px; border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 16px; }
    h2 { font-size: 18px; color: #334155; margin-top: 32px; border-left: 3px solid #3b82f6; padding-left: 10px; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    .meta span { margin-right: 16px; }
    .quality-alert { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px; margin: 16px 0; color: #92400e; font-size: 14px; }
    .quality-alert strong { color: #b45309; }
    .doc-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 12px 0; background: white; }
    .doc-card.warned { border-color: #fcd34d; background: #fffbeb; }
    .doc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px; }
    .doc-rank { background: #3b82f6; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 600; }
    .source-tag { background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-size: 12px; color: #475569; }
    .doc-title { font-size: 16px; font-weight: 600; margin: 8px 0; }
    .doc-meta { color: #64748b; font-size: 14px; margin: 4px 0; }
    .doc-meta.missing { color: #dc2626; }
    .doc-link { color: #3b82f6; text-decoration: none; }
    .doc-link:hover { text-decoration: underline; }
    .doc-desc { margin-top: 8px; color: #475569; font-size: 14px; line-height: 1.6; }
    .doc-warnings { margin-top: 10px; }
    .doc-warning-tag { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin: 2px 4px 2px 0; }
    .quality-summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; }
    .quality-stat { padding: 8px 16px; border-radius: 8px; font-size: 14px; }
    .quality-stat.good { background: #dcfce7; color: #166534; }
    .quality-stat.warn { background: #fffbeb; color: #92400e; border: 1px solid #fcd34d; }
    .path-item { display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .path-item:last-child { border-bottom: none; }
    .path-name { color: #334155; }
    .status-done { color: #22c55e; font-weight: 500; }
    .status-abandoned { color: #ef4444; font-weight: 500; }
    .empty { color: #94a3b8; font-style: italic; padding: 24px; text-align: center; }
  </style>
</head>
<body>
  <h1>专利检索报告</h1>
  <div class="meta">
    <span>生成时间：${new Date().toLocaleString('zh-CN')}</span>
    <span>检索平台：${searchPlatforms.join('、')}</span>
    <span>检索策略：${searchStrategies.join('、')}</span>
    <span>总耗时：${formatDurationMs(totalDurationMs)}</span>
  </div>

  ${warnedDocs.length > 0 ? `
  <div class="quality-alert">
    <strong>⚠ 数据质量提示</strong>：共 ${topDocs.length} 篇文献中有 ${warnedDocs.length} 篇存在字段缺失或不确定项，已用黄色标注。
    ${missingAuthors > 0 ? `其中 ${missingAuthors} 篇缺少作者信息` : ''}
    ${missingDates > 0 ? `、${missingDates} 篇缺少公开时间` : ''}
    ${missingUrls > 0 ? `、${missingUrls} 篇缺少出处链接` : ''}，请人工核实确认。
  </div>` : ''}

  <h2>一、检索路径执行情况</h2>
  ${pathSummary.length > 0 ? pathSummary.map(p => `
    <div class="path-item">
      <span class="path-name">${p.platform} — ${p.strategy}</span>
      <span class="${p.status === 'done' ? 'status-done' : 'status-abandoned'}">
        ${p.status === 'done' ? `✅ 完成（${p.docCount} 篇）` : `❌ 放弃${p.errorMsg ? `：${p.errorMsg}` : ''}`}
      </span>
    </div>
  `).join('') : '<p class="empty">无子任务记录</p>'}

  <h2>二、数据完整性统计</h2>
  <div class="quality-summary">
    <span class="quality-stat ${topDocs.length - missingAuthors > topDocs.length / 2 ? 'good' : 'warn'}">✓ 作者完整：${topDocs.length - missingAuthors}/${topDocs.length}</span>
    <span class="quality-stat ${topDocs.length - missingDates > topDocs.length / 2 ? 'good' : 'warn'}">✓ 时间完整：${topDocs.length - missingDates}/${topDocs.length}</span>
    <span class="quality-stat ${topDocs.length - missingUrls > topDocs.length / 2 ? 'good' : 'warn'}">✓ 链接完整：${topDocs.length - missingUrls}/${topDocs.length}</span>
  </div>

  <h2>三、最相关对比文献（Top ${topDocs.length}）</h2>
  ${topDocs.length > 0 ? topDocs.map(doc => `
    <div class="doc-card${doc.warnings.length > 0 ? ' warned' : ''}">
      <div class="doc-header">
        <span class="doc-rank">第 ${doc.rank} 位</span>
        <span class="source-tag">${doc.source_platform} · ${doc.source_strategy}</span>
      </div>
      <div class="doc-title">${escapeHtml(doc.title)}</div>
      <div class="doc-meta${!doc.authors || doc.authors === '未知' ? ' missing' : ''}">作者：${escapeHtml(doc.authors)} | 公开时间：${escapeHtml(doc.pub_date) || '<span class="missing">未知</span>'}</div>
      ${doc.url && isSafeUrl(doc.url) ? `<div class="doc-meta"><a class="doc-link" href="${escapeAttr(doc.url)}" target="_blank" rel="noopener noreferrer">查看原文</a></div>` : ''}
      ${doc.relevance_desc ? `<p class="doc-desc">${escapeHtml(doc.relevance_desc)}</p>` : ''}
      ${doc.warnings.length > 0 ? `
      <div class="doc-warnings">
        ${doc.warnings.map(w => `<span class="doc-warning-tag">⚠ ${escapeHtml(w)}</span>`).join('')}
      </div>` : ''}
    </div>
  `).join('') : '<p class="empty">未找到相关文献</p>'}

  <p style="color: #94a3b8; font-size: 12px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
    免责声明：本报告由AI自动生成，文献信息可能存在偏差。标注 ⚠ 的条目建议人工核实出处、作者及公开时间的准确性。
  </p>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// HTML 属性转义（完整转义，防止 XSS）
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// 验证 URL 是否为安全的 http/https 协议
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
