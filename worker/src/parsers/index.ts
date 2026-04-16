import { parsePdf } from './pdf'
import { parseDocx } from './docx'
import { parseXlsx } from './xlsx'
import { parseTxt } from './txt'
import { ParseResult } from './pdf'

export type FileType = 'pdf' | 'docx' | 'xlsx' | 'txt'

export { ParseResult } from './pdf'

export async function parseFile(buffer: Buffer, fileType: FileType): Promise<ParseResult> {
  switch (fileType) {
    case 'pdf':
      return parsePdf(buffer)
    case 'docx':
      return parseDocx(buffer)
    case 'xlsx':
      return parseXlsx(buffer)
    case 'txt':
      return parseTxt(buffer)
    default:
      throw new Error(`不支持的文件类型: ${fileType}`)
  }
}
