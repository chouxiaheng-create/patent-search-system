// lib/admin/export-reports-md.ts
// 把"用户 + 报告"列表拼成单个 Markdown 文档
// 纯函数：输入什么数据，输出什么字符串。无 IO，可在测试里放心跑。

export type ExportReport = {
  id: string
  job_id: string
  created_at: string
  doc_count: number
  html_content: string
  selected_docs: Array<{ title?: string; url?: string }>
}

export type ExportUser = {
  id: string
  email: string
  reports: ExportReport[]
}

export type ExportInput = {
  users: ExportUser[]
  generatedAt?: Date
}

export function buildReportMarkdown(input: ExportInput): string {
  const at = input.generatedAt ?? new Date()
  const totalReports = input.users.reduce((s, u) => s + u.reports.length, 0)

  const lines: string[] = []
  lines.push('# 检索报告导出')
  lines.push('')
  lines.push(`导出时间：${formatDateTime(at)} · 用户数：${input.users.length} · 报告总数：${totalReports}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  if (input.users.length === 0) {
    lines.push('（无选中用户）')
    return lines.join('\n')
  }

  for (const u of input.users) {
    lines.push(`## 用户：${escapeMd(u.email)}`)
    lines.push('')
    if (u.reports.length === 0) {
      lines.push('（该用户没有报告）')
      lines.push('')
      continue
    }
    let n = 0
    for (const r of u.reports) {
      n += 1
      lines.push(`### 报告 ${n}`)
      lines.push('')
      lines.push(`- 报告 ID: \`${r.id}\``)
      lines.push(`- 任务 ID: \`${r.job_id}\``)
      lines.push(`- 创建时间: ${formatDateTime(new Date(r.created_at))}`)
      lines.push(`- 文档数: ${r.doc_count}`)
      lines.push('')
      // 关联文档
      const docs = r.selected_docs ?? []
      if (docs.length > 0) {
        lines.push('#### 关联文档')
        lines.push('')
        for (const d of docs) {
          const title = d.title?.trim() || '(无标题)'
          const url = d.url ?? ''
          // Markdown 链接形式：[title](url)
          lines.push(url ? `- [${escapeMd(title)}](${url})` : `- ${escapeMd(title)}`)
        }
        lines.push('')
      }
      // 报告正文（HTML -> 纯文本）
      lines.push('#### 报告内容')
      lines.push('')
      const plain = stripHtml(r.html_content ?? '').trim()
      if (plain.length === 0) {
        lines.push('（无内容）')
      } else {
        // 长内容块用代码块包住，避免 markdown 误解析
        lines.push('```')
        lines.push(plain)
        lines.push('```')
      }
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

// --- helpers ---

function formatDateTime(d: Date): string {
  if (Number.isNaN(d.getTime())) return '(invalid date)'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 把含特殊字符的字符串安全嵌入 markdown 文本
// 注意：仅转义会影响 markdown 语法的字符；行首才有意义的（# - + . !）不算
function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()])/g, '\\$1')
}

// 把 HTML 标签去掉、常见实体解出来；输出纯文本
function stripHtml(html: string): string {
  if (!html) return ''
  let s = html

  // 去掉 <script> 和 <style> 全块（连内容一起）
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')

  // 块级标签前后加换行（让纯文本不至于粘在一起）
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)\s*>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '- ')

  // 去掉所有剩余标签
  s = s.replace(/<[^>]+>/g, '')

  // 常见 HTML 实体
  s = s.replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'")

  // 合并多余空行
  s = s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n')

  return s
}
