// __tests__/admin/export-reports-md.test.ts
import { describe, it, expect } from 'vitest'
import { buildReportMarkdown, type ExportInput } from '@/lib/admin/export-reports-md'

const FIXED = new Date('2026-07-15T10:30:00Z')

describe('buildReportMarkdown', () => {
  it('空输入返回最小占位 markdown', () => {
    const md = buildReportMarkdown({ users: [], generatedAt: FIXED })
    expect(md).toContain('# 检索报告导出')
    expect(md).toContain('用户数：0 · 报告总数：0')
    expect(md).toContain('（无选中用户）')
  })

  it('单用户多报告：header / sub-section / 计数都正确', () => {
    const input: ExportInput = {
      generatedAt: FIXED,
      users: [{
        id: 'u1', email: 'alice@example.com',
        reports: [
          { id: 'r1', job_id: 'j1', created_at: '2026-07-01T14:23:00Z',
            doc_count: 12, html_content: '<p>Hello world</p>',
            selected_docs: [{ title: 'doc A', url: 'https://example.com/a' }] },
          { id: 'r2', job_id: 'j2', created_at: '2026-07-02T08:00:00Z',
            doc_count: 0, html_content: '', selected_docs: [] },
        ],
      }],
    }
    const md = buildReportMarkdown(input)
    expect(md).toContain('用户数：1 · 报告总数：2')
    expect(md).toContain('## 用户：alice@example.com')
    expect(md).toContain('### 报告 1')
    expect(md).toContain('### 报告 2')
    expect(md).toContain('报告 ID: `r1`')
    expect(md).toContain('任务 ID: `j1`')
    expect(md).toContain('文档数: 12')
    expect(md).toContain('[doc A](https://example.com/a)')
    expect(md).toContain('Hello world')
    expect(md).toContain('（无内容）')   // r2 的 html_content 空
  })

  it('多用户：用 --- 分隔', () => {
    const input: ExportInput = {
      generatedAt: FIXED,
      users: [
        { id: 'u1', email: 'a@x.com', reports: [
          { id: 'r1', job_id: 'j1', created_at: '2026-07-01T00:00:00Z', doc_count: 1, html_content: 'X', selected_docs: [] },
        ]},
        { id: 'u2', email: 'b@y.com', reports: [] },
      ],
    }
    const md = buildReportMarkdown(input)
    expect(md).toContain('用户数：2 · 报告总数：1')
    expect(md).toContain('## 用户：a@x.com')
    expect(md).toContain('## 用户：b@y.com')
    expect(md).toContain('（该用户没有报告）')
    // 至少两个 --- 分隔（开头一个 + 用户间一个）
    const sep = md.match(/^---$/gm) ?? []
    expect(sep.length).toBeGreaterThanOrEqual(2)
  })

  it('stripHtml 去掉 script/style/标签并解实体', () => {
    const input: ExportInput = {
      generatedAt: FIXED,
      users: [{
        id: 'u1', email: 'a@x.com',
        reports: [{
          id: 'r1', job_id: 'j1', created_at: '2026-07-01T00:00:00Z', doc_count: 1,
          html_content: '<script>alert(1)</script><p>Hi &amp; bye</p><br/><style>body{}</style>after',
          selected_docs: [],
        }],
      }],
    }
    const md = buildReportMarkdown(input)
    expect(md).not.toContain('alert(1)')
    expect(md).not.toContain('body{}')
    expect(md).toContain('Hi & bye')
    expect(md).toContain('after')
  })

  it('空报告列表用户显示"该用户没有报告"', () => {
    const md = buildReportMarkdown({
      generatedAt: FIXED,
      users: [{ id: 'u1', email: 'lonely@x.com', reports: [] }],
    })
    expect(md).toContain('## 用户：lonely@x.com')
    expect(md).toContain('（该用户没有报告）')
  })

  it('escapeMd 转义 markdown 特殊字符（特别是 user email 中的 [_.]）', () => {
    const md = buildReportMarkdown({
      generatedAt: FIXED,
      users: [{
        id: 'u1', email: 'has_underscore@x.com',
        reports: [{
          id: 'r1', job_id: 'j1', created_at: '2026-07-01T00:00:00Z', doc_count: 0,
          html_content: '', selected_docs: [{ title: 'a*b_c', url: 'https://x.com' }],
        }],
      }],
    })
    // email 中的 _ 转义、但 . 不转义
    expect(md).toContain('has\\_underscore')
    expect(md).toContain('@x.com')       // 邮箱点不应被转义
    // title 中的 * 和 _ 都转义
    expect(md).toContain('a\\*b\\_c')
  })

  // ---- items 模式下的边界：API 把 items 规范化后喂给 builder，覆盖下列 case ----

  it('items 模式：单用户仅勾选 1 个报告（其余过滤掉），编号仍从 1 开始', () => {
    const md = buildReportMarkdown({
      generatedAt: FIXED,
      users: [{
        id: 'u1', email: 'a@x.com',
        reports: [{
          id: 'r-only', job_id: 'j-only', created_at: '2026-07-01T00:00:00Z',
          doc_count: 3, html_content: 'just one', selected_docs: [],
        }],
      }],
    })
    expect(md).toContain('用户数：1 · 报告总数：1')
    expect(md).toContain('### 报告 1')
    expect(md).not.toContain('### 报告 2')
    expect(md).toContain('报告 ID: `r-only`')
  })

  it('items 模式：用户存在但 reportIds 全被过滤（无报告），显示"该用户没有报告"', () => {
    const md = buildReportMarkdown({
      generatedAt: FIXED,
      users: [{ id: 'u1', email: 'empty@x.com', reports: [] }],
    })
    expect(md).toContain('## 用户：empty@x.com')
    expect(md).toContain('（该用户没有报告）')
    expect(md).toContain('用户数：1 · 报告总数：0')
  })

  it('items 模式：多用户混合（全选/部分选/零选），正确分隔与计数', () => {
    const md = buildReportMarkdown({
      generatedAt: FIXED,
      users: [
        // 全选：2 个报告
        { id: 'u1', email: 'full@x.com', reports: [
          { id: 'r1', job_id: 'j1', created_at: '2026-07-01T00:00:00Z', doc_count: 1, html_content: 'A', selected_docs: [] },
          { id: 'r2', job_id: 'j2', created_at: '2026-07-02T00:00:00Z', doc_count: 1, html_content: 'B', selected_docs: [] },
        ]},
        // 部分选：1 个报告
        { id: 'u2', email: 'partial@y.com', reports: [
          { id: 'r3', job_id: 'j3', created_at: '2026-07-03T00:00:00Z', doc_count: 2, html_content: 'C', selected_docs: [] },
        ]},
        // 零选
        { id: 'u3', email: 'none@z.com', reports: [] },
      ],
    })
    expect(md).toContain('用户数：3 · 报告总数：3')
    // 全选用户两个报告
    expect(md).toContain('## 用户：full@x.com')
    expect(md).toContain('### 报告 1')
    expect(md).toContain('### 报告 2')
    // 部分选用户一个报告（编号独立从 1 开始）
    expect(md).toContain('## 用户：partial@y.com')
    expect(md).toContain('### 报告 1')
    expect(md).not.toContain('### 报告 3')   // 每个用户的报告编号独立
    // 零选用户
    expect(md).toContain('## 用户：none@z.com')
    expect(md).toContain('（该用户没有报告）')
  })
})
