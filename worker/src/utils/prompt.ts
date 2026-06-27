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
    result = result.split(`{{${key}}}`).join(value)
  }

  if (parsedData.custom_fields) {
    for (const [key, value] of Object.entries(parsedData.custom_fields)) {
      result = result.split(`{{custom.${key}}}`).join(value)
    }
  }

  return result
}

const DEFAULT_PARSE_PROMPT = `你是一位专利审查专家。请从以下专利文献中提取关键信息，以JSON格式返回。键名必须使用英文，不可翻译：

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
      tech_theme: parsed.tech_theme || parsed['技术主题'] || '',
      applicant: parsed.applicant || parsed['申请人'] || '',
      inventor: parsed.inventor || parsed['发明人'] || '',
      filing_date: parsed.filing_date || parsed['申请日'] || '',
      main_tech_steps: parsed.main_tech_steps || parsed['主要技术方案步骤'] || '',
      core_invention: parsed.core_invention || parsed['核心发明构思'] || '',
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
  rank?: number
  quality_score?: number  // 0-100，用于过滤低质量结果
  quality_warnings?: string[]  // 质量问题描述
  metadata_source?: string  // 元数据富化来源（arXiv/Crossref/Semantic Scholar/页面meta），用于追溯
}

/**
 * 计算搜索结果的质量分数（0-100）
 * 用于过滤低质量/占位符结果
 */
export function calculateQualityScore(result: {
  title: string
  authors: string
  url: string
  pub_date: string
  relevance_desc: string
}): { score: number; warnings: string[] } {
  let score = 100
  const warnings: string[] = []

  // URL 缺失：严重问题（-35）
  if (!result.url || result.url === '无' || result.url === '未知') {
    score -= 35
    warnings.push('缺少出处链接')
  } else if (!result.url.startsWith('http://') && !result.url.startsWith('https://')) {
    score -= 15
    warnings.push('链接格式异常')
  }

  // 作者缺失或为"未知"（-20）
  if (!result.authors || result.authors === '未知' || result.authors.trim() === '') {
    score -= 20
    warnings.push('作者信息缺失')
  }

  // 公开时间缺失（-10）
  if (!result.pub_date || result.pub_date.trim() === '') {
    score -= 10
    warnings.push('公开时间缺失')
  } else if (!isValidDateFormat(result.pub_date)) {
    score -= 5
    warnings.push('日期格式异常')
  }

  // 标题为占位符或过短（-30）
  if (!result.title || result.title.length < 5) {
    score -= 30
    warnings.push('标题异常或不完整')
  } else if (/^文献\s*\d+$/.test(result.title) || /^检索结果\s*\d*$/.test(result.title)) {
    score -= 30
    warnings.push('标题为占位符')
  }

  // 相关性描述缺失（-10）
  if (!result.relevance_desc || result.relevance_desc.length < 10) {
    score -= 10
    warnings.push('相关性描述缺失或过短')
  }

  return { score: Math.max(0, score), warnings }
}

/**
 * 验证日期格式是否为 YYYY-MM-DD
 */
function isValidDateFormat(dateStr: string): boolean {
  if (!dateStr) return false
  // 匹配 YYYY-MM-DD 格式
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  const day = parseInt(match[3], 10)
  // 基本范围检查
  if (year < 1900 || year > 2100) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  return true
}

/**
 * 过滤低质量结果
 * @param results 原始结果数组
 * @param minScore 最低质量分数（默认 40）
 */
export function filterByQuality(results: SearchResult[], minScore: number = 40): {
  passed: SearchResult[]
  filtered: SearchResult[]
} {
  const passed: SearchResult[] = []
  const filtered: SearchResult[] = []

  for (const result of results) {
    const { score, warnings } = calculateQualityScore(result)
    const enriched = { ...result, quality_score: score, quality_warnings: warnings }

    if (score >= minScore) {
      passed.push(enriched)
    } else {
      filtered.push(enriched)
    }
  }

  return { passed, filtered }
}

export function parseSearchResults(aiContent: string, limit: number): SearchResult[] {
  if (!aiContent || aiContent.trim() === '') {
    return []
  }

  let rawResults: SearchResult[] = []

  try {
    // 移除 markdown 代码块包裹
    let cleanContent = aiContent
    const codeBlockMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      cleanContent = codeBlockMatch[1]
    }

    // 尝试 JSON 数组解析：用贪婪匹配获取最外层数组
    const firstBracket = cleanContent.indexOf('[')
    if (firstBracket >= 0) {
      let depth = 0
      let lastBracket = -1
      for (let i = firstBracket; i < cleanContent.length; i++) {
        if (cleanContent[i] === '[') depth++
        if (cleanContent[i] === ']') {
          depth--
          if (depth === 0) {
            lastBracket = i
            break
          }
        }
      }
      if (lastBracket > firstBracket) {
        const jsonStr = cleanContent.substring(firstBracket, lastBracket + 1)
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed) && parsed.length > 0) {
          rawResults = parsed.slice(0, limit).map((item: Record<string, unknown>, index: number) => ({
            title: String(item.title || ''),
            authors: String(item.authors || '未知'),
            url: String(item.url || ''),
            pub_date: normalizeDate(String(item.pub_date || '')),
            relevance_desc: String(item.relevance_desc || item.description || ''),
            citation_gb: String(item.citation_gb || generateCitation(item as Record<string, string>))
          }))
        }
      }
    }
  } catch {
    // JSON解析失败，尝试文本解析
  }

  // 如果 JSON 解析没有结果，尝试文本解析
  if (rawResults.length === 0) {
    const sections = aiContent.split(/(?=^标题：)/m)
    const entries = sections.length > 1 ? sections.slice(1) : [aiContent]

    for (const entry of entries) {
      if (rawResults.length >= limit) break

      const titleMatch = entry.match(/^标题[：:]\s*(.+)$/m)
      const urlMatch = entry.match(/链接[：:]\s*(https?:\/\/\S+)/m) || entry.match(/链接[：:]\s*(.+)$/m)
      const descMatch = entry.match(/摘要[：:]\s*([\s\S]+?)(?=\n(?:链接|标题|日期|作者|$)|\n\s*\n)/)
      const dateMatch = entry.match(/(?:日期|公开时间|发表时间)[：:]\s*(.+)$/m)
      const authorMatch = entry.match(/(?:作者|发明人)[：:]\s*(.+)$/m)

      const title = titleMatch ? titleMatch[1].trim() : ''
      const url = urlMatch ? urlMatch[1].trim() : ''
      const desc = descMatch ? descMatch[1].trim() : ''
      const date = dateMatch ? dateMatch[1].trim() : ''
      const authors = authorMatch ? authorMatch[1].trim() : '未知'

      if (title || url) {
        rawResults.push({
          title,
          authors,
          url: cleanUrl(url),
          pub_date: normalizeDate(date),
          relevance_desc: desc,
          citation_gb: url || title || ''
        })
      }
    }
  }

  // 清理 URL 并计算质量分数
  const enrichedResults = rawResults.map(r => {
    const cleaned = { ...r, url: cleanUrl(r.url) }
    const { score, warnings } = calculateQualityScore(cleaned)
    return { ...cleaned, quality_score: score, quality_warnings: warnings }
  })

  return enrichedResults
}

/**
 * 标准化日期格式为 YYYY-MM-DD
 */
export function normalizeDate(dateStr: string): string {
  if (!dateStr) return ''

  const trimmed = dateStr.trim()

  // 已经是 YYYY-MM-DD 格式
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // 尝试 YYYY-M-D（允许单位月/日，如 Crossref date-parts join 后的 "2023-5-15"）
  const dashMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (dashMatch) {
    return `${dashMatch[1]}-${dashMatch[2].padStart(2, '0')}-${dashMatch[3].padStart(2, '0')}`
  }

  // 尝试 YYYY/MM/DD 格式
  const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (slashMatch) {
    return `${slashMatch[1]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[3].padStart(2, '0')}`
  }

  // 尝试 YYYY年MM月DD日 格式
  const cnMatch = trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/)
  if (cnMatch) {
    return `${cnMatch[1]}-${cnMatch[2].padStart(2, '0')}-${cnMatch[3].padStart(2, '0')}`
  }

  // 尝试仅年份
  const yearMatch = trimmed.match(/^(\d{4})$/)
  if (yearMatch) {
    return `${yearMatch[1]}-01-01`
  }

  // 无法识别，返回空
  return ''
}

function cleanUrl(url: string): string {
  // 去除 markdown 链接后缀 ](url) — 取最后一个 http 开头的部分
  const lastHttp = url.lastIndexOf('http')
  if (lastHttp > 0) return url.substring(lastHttp)
  // 去除尾部括号
  return url.replace(/[)\]]+$/, '').trim()
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