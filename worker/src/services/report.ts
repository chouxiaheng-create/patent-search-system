// worker/src/services/report.ts
import { supabase } from './supabase'
import { getSearchTasks, getPlatformNames, getStrategyNames } from './supabase'
import { createAdapter } from '../adapters'
import { ParsedData, SearchResult, buildSelectionPrompt, parseSelectionResult } from '../utils/prompt'

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
}

interface PathSummary {
  platform: string
  strategy: string
  status: 'done' | 'abandoned'
  docCount: number
  errorMsg?: string
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

  // 2. 构建路径摘要
  const pathSummary: PathSummary[] = tasks.map((task: Record<string, unknown>) => ({
    platform: models.find((_, i) => config.model_ids[i] === task.model_id) || String(task.model_id),
    strategy: strategies.find((_, i) => config.strategy_ids[i] === task.strategy_id) || String(task.strategy_id),
    status: task.status as 'done' | 'abandoned',
    docCount: Array.isArray(task.results) ? task.results.length : 0,
    errorMsg: task.error_msg as string | undefined
  }))

  // 3. 去重
  const uniqueResults = deduplicateResults(allResults)

  // 4. 筛选 Top-N
  const topDocs = await selectTopDocs(uniqueResults, config)

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
    const key = result.url || result.title
    if (!seen.has(key)) {
      seen.set(key, result)
    }
  }

  return Array.from(seen.values())
}

async function selectTopDocs(
  results: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>,
  config: { report_limit: number; report_model_id: string }
): Promise<SelectedDoc[]> {
  if (results.length === 0) return []

  const limit = config.report_limit

  if (results.length <= limit) {
    return results.map((r, i) => toSelectedDoc(r, i + 1))
  }

  // 获取专利信息
  const { data: job } = await supabase.from('search_jobs').select('document_id').eq('id', jobId).single().catch(() => ({ data: null }))
  if (!job) return results.slice(0, limit).map((r, i) => toSelectedDoc(r, i + 1))

  const { data: doc } = await supabase.from('patent_documents').select('parsed_data').eq('id', (job as { document_id: string }).document_id).single().catch(() => ({ data: null }))
  const parsedData = (doc?.parsed_data || {}) as ParsedData

  // 调用汇总模型
  try {
    const model = await getModel(config.report_model_id)
    const adapter = createAdapter(model)
    const prompt = buildSelectionPrompt(parsedData, results, limit)
    const result = await adapter.call({ modelId: model.model_id, prompt, enableThinking: true, timeout: 300000 })

    if (result.success) {
      const selected = parseSelectionResult(result.content!, results, limit)
      return selected.map((r, i) => toSelectedDoc(r, i + 1))
    }
  } catch {
    // 筛选失败，降级
  }

  return results.slice(0, limit).map((r, i) => toSelectedDoc(r, i + 1))
}

function toSelectedDoc(r: SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }, rank: number): SelectedDoc {
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
    user_rating: null
  }
}

var jobId: string

function buildHtmlReport(data: ReportInput): string {
  const { topDocs, pathSummary, searchPlatforms, searchStrategies } = data

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
    .info-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .info-table td { padding: 8px 12px; border: 1px solid #e2e8f0; vertical-align: top; }
    .info-table td:first-child { width: 120px; color: #64748b; background: #f8fafc; }
    .doc-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 12px 0; background: white; }
    .doc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .doc-rank { background: #3b82f6; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 600; }
    .source-tag { background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-size: 12px; color: #475569; }
    .doc-title { font-size: 16px; font-weight: 600; margin: 8px 0; }
    .doc-meta { color: #64748b; font-size: 14px; margin: 4px 0; }
    .doc-link { color: #3b82f6; text-decoration: none; }
    .doc-link:hover { text-decoration: underline; }
    .doc-desc { margin-top: 8px; color: #475569; font-size: 14px; line-height: 1.6; }
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
  </div>

  <h2>一、检索路径执行情况</h2>
  ${pathSummary.length > 0 ? pathSummary.map(p => `
    <div class="path-item">
      <span class="path-name">${p.platform} — ${p.strategy}</span>
      <span class="${p.status === 'done' ? 'status-done' : 'status-abandoned'}">
        ${p.status === 'done' ? `✅ 完成（${p.docCount} 篇）` : `❌ 放弃${p.errorMsg ? `：${p.errorMsg}` : ''}`}
      </span>
    </div>
  `).join('') : '<p class="empty">无子任务记录</p>'}

  <h2>二，最相关对比文献（Top ${topDocs.length}）</h2>
  ${topDocs.length > 0 ? topDocs.map(doc => `
    <div class="doc-card">
      <div class="doc-header">
        <span class="doc-rank">第 ${doc.rank} 位</span>
        <span class="source-tag">${doc.source_platform} · ${doc.source_strategy}</span>
      </div>
      <div class="doc-title">${escapeHtml(doc.title)}</div>
      <div class="doc-meta">作者：${escapeHtml(doc.authors)} | 公开时间：${escapeHtml(doc.pub_date)}</div>
      ${doc.url ? `<div class="doc-meta"><a class="doc-link" href="${escapeHtml(doc.url)}" target="_blank">查看原文</a></div>` : ''}
      ${doc.relevance_desc ? `<p class="doc-desc">${escapeHtml(doc.relevance_desc)}</p>` : ''}
    </div>
  `).join('') : '<p class="empty">未找到相关文献</p>'}
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

async function getModel(modelId: string) {
  const { data, error } = await supabase.from('ai_models').select('*').eq('id', modelId).single()
  if (error || !data) throw new Error(`获取汇总模型失败: ${modelId}`)
  return data
}
