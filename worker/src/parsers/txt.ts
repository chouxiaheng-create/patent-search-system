import { ParseResult, detectQualityIssues } from './pdf'
import jschardet from 'jschardet'

/**
 * 自动检测编码并解码 Buffer → 字符串。
 * 中文 Windows 环境下 .txt 文件默认 GBK/GB2312 编码，
 * 不能假设一切输入都是 UTF-8。
 *
 * 策略：先用 jschardet 检测，然后用检测到的编码解码；
 * 如果检测结果置信度 < 0.7 或解码失败，回退 UTF-8。
 */
function decodeBuffer(buffer: Buffer): string {
  // 检测编码
  const detected = jschardet.detect(buffer)
  const encoding = detected.encoding || 'utf-8'
  const confidence = detected.confidence || 0

  // 高置信度检测结果 → 直接用
  if (confidence >= 0.7 && encoding.toLowerCase() !== 'utf-8') {
    try {
      return buffer.toString(encoding as BufferEncoding)
    } catch {
      // 编码名不被 Node.js 识别 → 回退 UTF-8
      console.warn(`[txt] 编码 "${encoding}" 不被支持，回退 UTF-8`)
    }
  }

  // 低置信度 或 UTF-8 检测结果 → 先试 UTF-8，失败再试 GBK
  try {
    const text = buffer.toString('utf-8')
    // 验证：如果包含大量替换字符 (ufffd)，说明 UTF-8 解码失败
    const replacementCount = (text.match(/�/g) || []).length
    if (replacementCount > text.length * 0.01) {
      throw new Error('UTF-8 解码出现大量替换字符')
    }
    return text
  } catch {
    // UTF-8 失败 → 尝试常见的中文编码
    for (const fallback of ['gbk', 'gb2312', 'gb18030']) {
      try {
        return buffer.toString(fallback as BufferEncoding)
      } catch {
        continue
      }
    }
    // 所有编码都失败 → 返回 UTF-8 解码结果（含替换字符）
    return buffer.toString('utf-8')
  }
}

export async function parseTxt(buffer: Buffer): Promise<ParseResult> {
  const text = decodeBuffer(buffer).trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}
