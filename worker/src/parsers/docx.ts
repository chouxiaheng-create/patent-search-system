import mammoth from 'mammoth'
import { ParseResult } from './pdf'

export async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ buffer })
  const text = result.value.trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}

function detectQualityIssues(text: string): boolean {
  if (text.length < 100) return true
  const validChars = text.match(/[\u4e00-\u9fa5a-zA-Z0-9\s\p{P}]/gu) || []
  if (text.length > 0 && validChars.length / text.length < 0.7) return true
  return false
}