import xlsx from 'xlsx'
import { ParseResult } from './pdf'

export async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const workbook = xlsx.read(buffer)
  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]
    return xlsx.utils.sheet_to_csv(workbook.Sheets[name])
  })
  const text = sheets.filter(s => s.trim()).join('\n\n').trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}

function detectQualityIssues(text: string): boolean {
  if (text.length < 100) return true
  const validChars = text.match(/[\u4e00-\u9fa5a-zA-Z0-9\s\p{P}]/gu) || []
  if (text.length > 0 && validChars.length / text.length < 0.7) return true
  return false
}