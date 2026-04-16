import { ParseResult, detectQualityIssues } from './pdf'

export async function parseTxt(buffer: Buffer): Promise<ParseResult> {
  const text = buffer.toString('utf-8').trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}