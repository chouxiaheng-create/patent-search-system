// app/api/reports/[reportId]/export/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withApiHandler } from '@/lib/api/handler'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ExternalHyperlink,
} from 'docx'

function buildMarkdown(report: {
  html_content: string
  selected_docs: Array<{
    rank: number
    title: string
    authors: string
    url: string
    pub_date: string
    relevance_desc: string
    citation_gb: string
    source_platform: string
    source_strategy: string
  }>
  created_at: string
  document?: { title: string }
}): string {
  const docTitle = report.document?.title || '待审专利'

  let md = `# 专利检索报告\n\n`
  md += `**待审专利**: ${docTitle}\n`
  md += `**生成时间**: ${new Date(report.created_at).toLocaleString('zh-CN')}\n`
  md += `**对比文献**: ${report.selected_docs.length} 篇\n\n`
  md += `---\n\n`

  md += `## 最相关对比文献\n\n`

  for (const doc of report.selected_docs) {
    md += `### ${doc.rank}. ${doc.title}\n\n`
    md += `- **来源**: ${doc.source_platform} × ${doc.source_strategy}\n`
    if (doc.authors) md += `- **作者**: ${doc.authors}\n`
    if (doc.pub_date) md += `- **时间**: ${doc.pub_date}\n`
    if (doc.url) md += `- **链接**: ${doc.url}\n`
    if (doc.relevance_desc) md += `- **相关描述**: ${doc.relevance_desc}\n`
    md += `\n`
  }

  return md
}

function buildDocx(report: {
  html_content: string
  selected_docs: Array<{
    rank: number
    title: string
    authors: string
    url: string
    pub_date: string
    relevance_desc: string
    citation_gb: string
    source_platform: string
    source_strategy: string
  }>
  created_at: string
  document?: { title: string }
}): Document {
  const docTitle = report.document?.title || '待审专利'

  const children: Paragraph[] = []

  // 标题
  children.push(
    new Paragraph({
      text: '专利检索报告',
      heading: HeadingLevel.TITLE,
      spacing: { after: 400 },
    })
  )

  // 元信息
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '待审专利: ', bold: true }),
        new TextRun(docTitle),
      ],
    })
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '生成时间: ', bold: true }),
        new TextRun(new Date(report.created_at).toLocaleString('zh-CN')),
      ],
    })
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '对比文献: ', bold: true }),
        new TextRun(`${report.selected_docs.length} 篇`),
      ],
      spacing: { after: 400 },
    })
  )

  // 文献列表
  children.push(
    new Paragraph({
      text: '最相关对比文献',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  )

  for (const doc of report.selected_docs) {
    children.push(
      new Paragraph({
        text: `${doc.rank}. ${doc.title}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    )
    children.push(
      new Paragraph({ text: `来源: ${doc.source_platform} × ${doc.source_strategy}` })
    )
    if (doc.authors) children.push(new Paragraph({ text: `作者: ${doc.authors}` }))
    if (doc.pub_date) children.push(new Paragraph({ text: `时间: ${doc.pub_date}` }))
    if (doc.url) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: '链接: ' }),
            new ExternalHyperlink({
              link: doc.url,
              children: [new TextRun({ text: doc.url, style: 'Hyperlink' })],
            }),
          ],
        })
      )
    }
    if (doc.relevance_desc) {
      children.push(
        new Paragraph({
          text: `相关描述: ${doc.relevance_desc}`,
          spacing: { after: 300 },
        })
      )
    }
  }

  return new Document({
    sections: [{ children }],
  })
}

export const GET = withApiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) => {
  const { reportId } = await params
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'markdown'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: report, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .eq('user_id', user.id)
    .single()

  if (error || !report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  // 通过 job 获取关联文档标题（reports 表无 document_id 列，需间接查询）
  let documentTitle = ''
  const { data: jobData } = await supabase
    .from('search_jobs')
    .select('document_id')
    .eq('id', report.job_id)
    .single()

  if (jobData?.document_id) {
    const { data: docData } = await supabase
      .from('patent_documents')
      .select('title')
      .eq('id', jobData.document_id)
      .single()
    if (docData?.title) {
      documentTitle = docData.title
    }
  }

  // 附加文档信息到 report 对象
  const enrichedReport = { ...report, document: { title: documentTitle } }

  if (format === 'markdown') {
    const content = buildMarkdown(enrichedReport)
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="patent-report-${reportId}.md"`,
      },
    })
  }

  if (format === 'docx') {
    const doc = buildDocx(enrichedReport)
    const buffer = await Packer.toBuffer(doc)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="patent-report-${reportId}.docx"`,
      },
    })
  }

  return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
})
