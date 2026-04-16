import { PDFParse } from 'pdf-parse'

export interface ParseResult {
  text: string
  qualityWarning: boolean
}

export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const parser = new PDFParse({ data: buffer })
  const data = await parser.getText()
  const text = data.text.trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}

export function detectQualityIssues(text: string): boolean {
  if (text.length < 100) return true
  const validChars = text.match(/[\u4e00-\u9fa5a-zA-Z0-9\s\p{P}]/gu) || []
  if (text.length > 0 && validChars.length / text.length < 0.7) return true
  return false
}