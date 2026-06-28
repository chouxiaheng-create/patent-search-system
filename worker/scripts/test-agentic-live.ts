// 一次性集成探测：用真实 DeepSeek/MiniMax 凭证 + 真实 Tavily key 跑 agentic 循环。
// 验证：模型端点是否接受 tools、是否真的调用 web_search、是否返回带真实 URL 的结果。
import 'dotenv/config'
import pg from 'pg'
import { OpenAICompatAdapter } from '../src/adapters/openai-compat'

const SYS = `你是一个专业专利检索专家。通过 web_search 工具联网查找相关文献，并以 JSON 数组格式返回。
只能返回通过搜索工具实际检索到的文献，严禁编造。若搜索无结果返回 []。
每条字段：title(标题)、authors(作者)、url(出处链接)、pub_date(公开日期YYYY-MM-DD)、relevance_desc(相关性说明)。
仅返回 JSON 数组，不要 markdown 代码块、不要解释。`

const PROMPT = `检索与"基于深度学习的图像识别方法"相关的专利与论文，返回最相关的 3 条。`

async function runFor(client: pg.Client, modelName: string) {
  const { rows } = await client.query(
    `SELECT name, api_base_url, api_key_encrypted, model_id, adapter_config
     FROM ai_models WHERE name=$1 AND is_builtin=true LIMIT 1`,
    [modelName]
  )
  if (!rows[0]) { console.log(`[${modelName}] 未找到`); return }
  const r = rows[0]
  console.log(`\n========== ${modelName} ==========`)
  console.log(`model_id=${r.model_id} base=${r.api_base_url} method=${r.adapter_config?.web_search_method}`)
  const adapter = new OpenAICompatAdapter(r.api_base_url, r.api_key_encrypted, r.adapter_config)
  const t0 = Date.now()
  const result = await adapter.call({
    modelId: r.model_id,
    prompt: PROMPT,
    systemPrompt: SYS,
    enableWebSearch: true,
    enableThinking: false,
    timeout: 150000,
  })
  const ms = Date.now() - t0
  console.log(`[${modelName}] ${result.success ? 'SUCCESS' : 'FAIL'} (${ms}ms)`)
  if (result.success) {
    const c = result.content || ''
    const hasUrl = /https?:\/\//.test(c)
    console.log(`[${modelName}] 内容长度=${c.length} 含URL=${hasUrl}`)
    console.log(`[${modelName}] 预览: ${c.slice(0, 400)}`)
  } else {
    console.log(`[${modelName}] error: ${result.error}`)
  }
}

async function main() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('no DATABASE_URL')
  const client = new pg.Client({ connectionString: cs, ssl: false })
  await client.connect()
  try {
    await runFor(client, 'DeepSeek')
    await runFor(client, 'MiniMax')
  } finally {
    await client.end()
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
