import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
})

export async function downloadFile(fileUrl: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from('patent-files')
    .download(fileUrl)

  if (error) throw new Error(`下载文件失败: ${error.message}`)
  if (!data) throw new Error('文件数据为空')

  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export interface AIModelRecord {
  id: string
  owner_id: string | null
  name: string
  api_base_url: string
  api_key_encrypted: string
  model_id: string
  is_builtin: boolean
  usage_types: string[]
  adapter_config: {
    provider: 'openai_compat' | 'metaso'
    web_search_method: 'tools_builtin' | 'tools_web_search' | 'extra_body' | 'native' | 'none'
    web_search_tool_name?: string
    thinking_method: 'param' | 'model_switch' | 'extra_body' | 'default_on' | 'none'
    thinking_model_id?: string
    web_search_disables_thinking: boolean
    thinking_default_on: boolean
  }
  created_at: string
}

export async function getModel(modelId: string): Promise<AIModelRecord> {
  const { data, error } = await supabase
    .from('ai_models')
    .select('*')
    .eq('id', modelId)
    .single()

  if (error || !data) throw new Error(`获取模型失败: ${modelId}`)
  return data as AIModelRecord
}

export interface SearchStrategyRecord {
  id: string
  owner_id: string | null
  name: string
  prompt_template: string
  is_builtin: boolean
  created_at: string
}

export async function getStrategy(strategyId: string): Promise<SearchStrategyRecord> {
  const { data, error } = await supabase
    .from('search_strategies')
    .select('*')
    .eq('id', strategyId)
    .single()

  if (error || !data) throw new Error(`获取策略失败: ${strategyId}`)
  return data as SearchStrategyRecord
}

export async function getJob(jobId: string) {
  const { data, error } = await supabase
    .from('search_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !data) throw new Error(`获取任务失败: ${jobId}`)
  return data
}

export async function getDocument(documentId: string) {
  const { data, error } = await supabase
    .from('patent_documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (error || !data) throw new Error(`获取文档失败: ${documentId}`)
  return data
}

export async function getDocumentById(documentId: string) {
  return getDocument(documentId)
}

export async function updateDocument(documentId: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from('patent_documents')
    .update(updates)
    .eq('id', documentId)

  if (error) throw new Error(`更新文档失败: ${error.message}`)
}

export async function updateJob(jobId: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from('search_jobs')
    .update(updates)
    .eq('id', jobId)

  if (error) throw new Error(`更新任务失败: ${error.message}`)
}

export async function updateTaskStatus(taskId: string, status: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabase
    .from('search_tasks')
    .update({ status, ...extra })
    .eq('id', taskId)

  if (error) throw new Error(`更新子任务失败: ${error.message}`)
}

export async function getSearchTasks(jobId: string) {
  const { data, error } = await supabase
    .from('search_tasks')
    .select('*')
    .eq('job_id', jobId)

  if (error) throw new Error(`获取子任务失败: ${error.message}`)
  return data || []
}

export async function createSearchTasks(jobId: string, modelIds: string[], strategyIds: string[]) {
  const tasks = modelIds.flatMap(modelId =>
    strategyIds.map(strategyId => ({
      job_id: jobId,
      model_id: modelId,
      strategy_id: strategyId,
      status: 'pending',
      retry_count: 0
    }))
  )

  const { data, error } = await supabase
    .from('search_tasks')
    .insert(tasks)
    .select('id, model_id, strategy_id, status, retry_count')

  if (error) throw new Error(`创建子任务失败: ${error.message}`)
  return data
}

export async function getPlatformNames(modelIds: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('ai_models')
    .select('name')
    .in('id', modelIds)

  return (data || []).map(d => d.name)
}

export async function getStrategyNames(strategyIds: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('search_strategies')
    .select('name')
    .in('id', strategyIds)

  return (data || []).map(d => d.name)
}