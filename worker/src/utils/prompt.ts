// worker/src/utils/prompt.ts

export interface ParsedData {
  tech_theme?: string
  applicant?: string
  inventor?: string
  filing_date?: string
  main_tech_steps?: string
  core_invention?: string
  custom_fields?: Record<string, string>
}

export function fillPromptTemplate(template: string, parsedData: ParsedData): string {
  const variables: Record<string, string> = {
    tech_theme: parsedData.tech_theme || '',
    applicant: parsedData.applicant || '',
    inventor: parsedData.inventor || '',
    filing_date: parsedData.filing_date || '',
    main_tech_steps: parsedData.main_tech_steps || '',
    core_invention: parsedData.core_invention || ''
  }

  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }

  if (parsedData.custom_fields) {
    for (const [key, value] of Object.entries(parsedData.custom_fields)) {
      result = result.replace(new RegExp(`\\{\\{custom\\.${key}\\}\\}`, 'g'), value)
    }
  }

  return result
}

const DEFAULT_PARSE_PROMPT = `你是一位专利审查专家。请从以下专利文献中提取关键信息，以JSON格式返回：
{
  "tech_theme": "技术主题（一句话概括）",
  "applicant": "申请人",
  "inventor": "发明人（多人用顿号分隔）",
  "filing_date": "申请日（YYYY-MM-DD格式，如无法确定则留空）",
  "main_tech_steps": "主要技术方案步骤（详细描述）",
  "core_invention": "核心发明构思（详细描述）",
  "custom_fields": {}
}

请仅返回JSON，不要包含其他内容。`

export function buildParsePrompt(fileContent: string, systemPrompt?: string): string {
  const base = systemPrompt && systemPrompt.trim()
    ? `${systemPrompt.trim()}\n\n文献内容：\n${fileContent}`
    : `${DEFAULT_PARSE_PROMPT}\n\n文献内容：\n${fileContent}`
  return base
}

export function extractParsedData(aiContent: string): ParsedData {
  const jsonMatch = aiContent.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('AI响应中未找到有效的JSON数据')
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      tech_theme: parsed.tech_theme || '',
      applicant: parsed.applicant || '',
      inventor: parsed.inventor || '',
      filing_date: parsed.filing_date || '',
      main_tech_steps: parsed.main_tech_steps || '',
      core_invention: parsed.core_invention || '',
      custom_fields: parsed.custom_fields || {}
    }
  } catch {
    throw new Error(`JSON解析失败: ${jsonMatch[0].substring(0, 100)}`)
  }
}

export interface SearchResult {
  title: string
  authors: string
  url: string
  pub_date: string
  relevance_desc: string
  citation_gb: string
}

export function parseSearchResults(aiContent: string, limit: number): SearchResult[] {
  try {
    const jsonMatch = aiContent.match(/(\[[\s\S]*?\])/m)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1])
      if (Array.isArray(parsed)) {
        return parsed.slice(0, limit).map((item: Record<string, string>, index: number) => ({
          title: item.title || `文献${index + 1}`,
          authors: item.authors || '未知',
          url: item.url || '',
          pub_date: item.pub_date || '',
          relevance_desc: item.relevance_desc || item.description || '',
          citation_gb: item.citation_gb || generateCitation(item)
        }))
      }
    }
  } catch {
    // JSON解析失败，尝试文本解析
  }

  // 降级：提取链接作为结果
  const urls = aiContent.match(/https?:\/\/[^\s，,。]+/g) || []
  return urls.slice(0, limit).map((url, i) => ({
    title: `检索结果 ${i + 1}`,
    authors: '未知',
    url,
    pub_date: '',
    relevance_desc: '',
    citation_gb: url
  }))
}

function generateCitation(item: Record<string, string>): string {
  const parts: string[] = []
  if (item.authors) parts.push(item.authors)
  if (item.pub_date) parts.push(item.pub_date)
  if (item.url) parts.push(item.url)
  return parts.join('. ')
}

const DEFAULT_SELECTION_PROMPT = `你是一位专利审查专家。请根据以下专利信息，从候选文献中筛选出最相关的 %LIMIT% 篇对比文献。

【待审专利信息】
技术主题：%TECH_THEME%
申请人：%APPLICANT%
发明人：%INVENTOR%
申请日：%FILING_DATE%
核心发明构思：%CORE_INVENTION%
主要技术方案步骤：%MAIN_TECH_STEPS%

【候选文献】
%RESULTS%

请返回JSON数组，包含最相关的 %LIMIT% 篇文献的序号（从1开始），按相关性从高到低排序：
[3, 7, 1, ...]`

export function buildSelectionPrompt(
  parsedData: ParsedData,
  results: SearchResult[],
  limit: number
): string {
  const resultList = results.map((r, i) => `[${i + 1}] ${r.title}\n作者：${r.authors}\n相关描述：${r.relevance_desc}`).join('\n\n')

  let prompt = DEFAULT_SELECTION_PROMPT
    .replace(/%LIMIT%/g, String(limit))
    .replace(/%TECH_THEME%/g, parsedData.tech_theme || '')
    .replace(/%APPLICANT%/g, parsedData.applicant || '')
    .replace(/%INVENTOR%/g, parsedData.inventor || '')
    .replace(/%FILING_DATE%/g, parsedData.filing_date || '')
    .replace(/%CORE_INVENTION%/g, parsedData.core_invention || '')
    .replace(/%MAIN_TECH_STEPS%/g, parsedData.main_tech_steps || '')
    .replace(/%RESULTS%/g, resultList)

  return prompt
}

export function parseSelectionResult(
  aiContent: string,
  allResults: SearchResult[],
  limit: number
): SearchResult[] {
  try {
    const jsonMatch = aiContent.match(/\[([\d,\s]+)\]/)
    if (jsonMatch) {
      const indices = jsonMatch[1].split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < allResults.length)
      if (indices.length > 0) {
        return indices.slice(0, limit).map((i, rank) => ({ ...allResults[i], rank: rank + 1 }))
      }
    }
  } catch {
    // 解析失败
  }

  // 降级：返回前 N 个
  return allResults.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }))
}