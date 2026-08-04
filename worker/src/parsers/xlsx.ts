import xlsx from 'xlsx'
import { ParseResult } from './pdf'

// H7：xlsx 解析防护上限——防止 zip-bomb / 超大工作簿拖垮 worker 内存与 CPU
const MAX_SHEETS = 50
const MAX_CELLS_TOTAL = 200_000
const MAX_SHEET_ROWS = 100_000

export async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const workbook = xlsx.read(buffer)

  if (workbook.SheetNames.length > MAX_SHEETS) {
    throw new Error(`Excel 工作表数量超过限制（最多 ${MAX_SHEETS} 个）`)
  }

  // 预扫描每个 sheet 的行列规模，超限直接拒绝（在 sheet_to_csv 前拦截，避免先撑爆内存）
  let totalCells = 0
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet || !sheet['!ref']) continue
    const range = xlsx.utils.decode_range(sheet['!ref'])
    const rows = range.e.r - range.s.r + 1
    const cols = range.e.c - range.s.c + 1
    if (rows > MAX_SHEET_ROWS) {
      throw new Error(`Excel 工作表 "${name}" 行数超过限制（最多 ${MAX_SHEET_ROWS} 行）`)
    }
    totalCells += rows * cols
    if (totalCells > MAX_CELLS_TOTAL) {
      throw new Error(`Excel 总单元格数超过限制（最多 ${MAX_CELLS_TOTAL} 个）`)
    }
  }

  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]
    return xlsx.utils.sheet_to_csv(sheet)
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
