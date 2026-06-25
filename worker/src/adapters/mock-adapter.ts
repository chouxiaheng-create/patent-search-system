import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

/**
 * MockAdapter — 当外部 API 不可用时（余额不足、网络故障、编码错误等）
 * 提供稳定的模拟响应，确保开发流程不被阻塞。
 *
 * 激活方式：
 * 1. 环境变量 MOCK_MODE=true
 * 2. 或在 createAdapter 中手动替换
 */
export class MockAdapter implements AIAdapter {
  name = 'mock'

  // 可预测的模拟响应库，按 prompt 关键词匹配
  private readonly mockResponses: Array<{
    keywords: string[]
    results: Array<{ title: string; link: string; snippet: string }>
  }> = [
    {
      keywords: ['专利', 'patent', '检索', 'search', '发明', '技术'],
      results: [
        {
          title: '基于深度学习的专利文本分类方法',
          link: 'https://example.com/patent/001',
          snippet: '本发明公开了一种基于 Transformer 的专利文本自动分类方法，准确率达 96.5%。'
        },
        {
          title: 'Patent Search System Using Multi-Agent Architecture',
          link: 'https://example.com/patent/002',
          snippet: 'A novel architecture for distributed patent retrieval utilizing large language models.'
        },
        {
          title: '智能语义检索系统',
          link: 'https://example.com/patent/003',
          snippet: '通过向量数据库与语义理解模型，实现跨语言专利文献的高效检索。'
        }
      ]
    },
    {
      keywords: ['AI', '人工智能', '模型', 'model', '大语言模型', 'LLM'],
      results: [
        {
          title: 'Large Language Model for Patent Prior Art Search',
          link: 'https://example.com/patent/004',
          snippet: 'Employing GPT-class models to identify prior art with semantic similarity scoring.'
        },
        {
          title: '面向专利分析的知识图谱构建方法',
          link: 'https://example.com/patent/005',
          snippet: '利用 NLP 技术从专利文本中抽取实体关系，构建动态更新的领域知识图谱。'
        }
      ]
    }
  ]

  private readonly genericResponse =
    '【Mock 模式】这是一段模拟的搜索结果。当前外部 API 暂不可用（可能是网络故障、余额不足或配置错误）。\n\n' +
    '建议：\n' +
    '1. 检查 API 密钥和账户余额\n' +
    '2. 验证网络连通性\n' +
    '3. 查阅官方文档确认 base URL 和请求格式\n\n' +
    'Mock 数据（通用）：\n' +
    '标题：模拟专利文献 A\n' +
    '链接：https://example.com/mock/001\n' +
    '摘要：这是一段由 MockAdapter 生成的模拟摘要，用于在 API 不可用时保持前端/Worker 开发流程畅通。'

  async call(options: AIAdapterCallOptions): Promise<AIAdapterResult> {
    // 模拟网络延迟，帮助发现异步问题
    await this.delay(300 + Math.random() * 700)

    const promptLower = options.prompt.toLowerCase()
    const matched = this.mockResponses.find(m =>
      m.keywords.some(k => promptLower.includes(k.toLowerCase()))
    )

    if (matched) {
      const content = matched.results
        .map(
          r => `标题：${r.title}\n链接：${r.link}\n摘要：${r.snippet}`
        )
        .join('\n\n')
      return { success: true, content }
    }

    return { success: true, content: this.genericResponse }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
