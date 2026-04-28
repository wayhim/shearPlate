import type { Language } from '../../../shared/types'

export type FileKind = 'image' | 'video' | 'audio' | 'archive' | 'spreadsheet' | 'code' | 'document' | 'file'

type FileTypePattern = {
  pattern: RegExp
  kind: FileKind
  typeLabel: string
}

const FILE_KIND_LABELS: Record<Language, Record<FileKind, string>> = {
  zh: {
    image: '图片',
    video: '视频',
    audio: '音频',
    archive: '压缩包',
    spreadsheet: '表格',
    code: '代码',
    document: '文档',
    file: '文件'
  },
  en: {
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
    archive: 'Archive',
    spreadsheet: 'Spreadsheet',
    code: 'Code',
    document: 'Document',
    file: 'File'
  }
}

const FILE_TYPE_PATTERNS: FileTypePattern[] = [
  { pattern: /\.(png)$/i, kind: 'image', typeLabel: 'PNG' },
  { pattern: /\.(jpg|jpeg)$/i, kind: 'image', typeLabel: 'JPEG' },
  { pattern: /\.(gif)$/i, kind: 'image', typeLabel: 'GIF' },
  { pattern: /\.(webp)$/i, kind: 'image', typeLabel: 'WEBP' },
  { pattern: /\.(heic)$/i, kind: 'image', typeLabel: 'HEIC' },
  { pattern: /\.(svg)$/i, kind: 'image', typeLabel: 'SVG' },
  { pattern: /\.(bmp)$/i, kind: 'image', typeLabel: 'BMP' },
  { pattern: /\.(tif|tiff)$/i, kind: 'image', typeLabel: 'TIFF' },
  { pattern: /\.(ico)$/i, kind: 'image', typeLabel: 'ICO' },
  { pattern: /\.(avif)$/i, kind: 'image', typeLabel: 'AVIF' },
  { pattern: /\.(mp4)$/i, kind: 'video', typeLabel: 'MP4' },
  { pattern: /\.(mov)$/i, kind: 'video', typeLabel: 'MOV' },
  { pattern: /\.(mkv)$/i, kind: 'video', typeLabel: 'MKV' },
  { pattern: /\.(avi)$/i, kind: 'video', typeLabel: 'AVI' },
  { pattern: /\.(webm)$/i, kind: 'video', typeLabel: 'WEBM' },
  { pattern: /\.(m4v)$/i, kind: 'video', typeLabel: 'M4V' },
  { pattern: /\.(mp3)$/i, kind: 'audio', typeLabel: 'MP3' },
  { pattern: /\.(wav)$/i, kind: 'audio', typeLabel: 'WAV' },
  { pattern: /\.(m4a)$/i, kind: 'audio', typeLabel: 'M4A' },
  { pattern: /\.(flac)$/i, kind: 'audio', typeLabel: 'FLAC' },
  { pattern: /\.(aac)$/i, kind: 'audio', typeLabel: 'AAC' },
  { pattern: /\.(ogg)$/i, kind: 'audio', typeLabel: 'OGG' },
  { pattern: /\.(opus)$/i, kind: 'audio', typeLabel: 'OPUS' },
  { pattern: /\.(tar\.gz|tgz)$/i, kind: 'archive', typeLabel: 'TAR.GZ' },
  { pattern: /\.(zip)$/i, kind: 'archive', typeLabel: 'ZIP' },
  { pattern: /\.(rar)$/i, kind: 'archive', typeLabel: 'RAR' },
  { pattern: /\.(7z)$/i, kind: 'archive', typeLabel: '7Z' },
  { pattern: /\.(tar)$/i, kind: 'archive', typeLabel: 'TAR' },
  { pattern: /\.(gz)$/i, kind: 'archive', typeLabel: 'GZ' },
  { pattern: /\.(bz2)$/i, kind: 'archive', typeLabel: 'BZ2' },
  { pattern: /\.(xz)$/i, kind: 'archive', typeLabel: 'XZ' },
  { pattern: /\.(xls)$/i, kind: 'spreadsheet', typeLabel: 'XLS' },
  { pattern: /\.(xlsx)$/i, kind: 'spreadsheet', typeLabel: 'XLSX' },
  { pattern: /\.(csv)$/i, kind: 'spreadsheet', typeLabel: 'CSV' },
  { pattern: /\.(tsv)$/i, kind: 'spreadsheet', typeLabel: 'TSV' },
  { pattern: /\.(ods)$/i, kind: 'spreadsheet', typeLabel: 'ODS' },
  { pattern: /\.(numbers)$/i, kind: 'spreadsheet', typeLabel: 'NUMBERS' },
  { pattern: /\.(json)$/i, kind: 'code', typeLabel: 'JSON' },
  { pattern: /\.(ts|tsx)$/i, kind: 'code', typeLabel: 'TS' },
  { pattern: /\.(js|jsx|mjs|cjs)$/i, kind: 'code', typeLabel: 'JS' },
  { pattern: /\.(py)$/i, kind: 'code', typeLabel: 'PY' },
  { pattern: /\.(go)$/i, kind: 'code', typeLabel: 'GO' },
  { pattern: /\.(java)$/i, kind: 'code', typeLabel: 'JAVA' },
  { pattern: /\.(cpp|cc|cxx)$/i, kind: 'code', typeLabel: 'CPP' },
  { pattern: /\.(c)$/i, kind: 'code', typeLabel: 'C' },
  { pattern: /\.(h|hpp)$/i, kind: 'code', typeLabel: 'H' },
  { pattern: /\.(rs)$/i, kind: 'code', typeLabel: 'RS' },
  { pattern: /\.(sh|bash|zsh)$/i, kind: 'code', typeLabel: 'SH' },
  { pattern: /\.(rb)$/i, kind: 'code', typeLabel: 'RB' },
  { pattern: /\.(php)$/i, kind: 'code', typeLabel: 'PHP' },
  { pattern: /\.(yml|yaml)$/i, kind: 'code', typeLabel: 'YAML' },
  { pattern: /\.(toml)$/i, kind: 'code', typeLabel: 'TOML' },
  { pattern: /\.(xml)$/i, kind: 'code', typeLabel: 'XML' },
  { pattern: /\.(html)$/i, kind: 'code', typeLabel: 'HTML' },
  { pattern: /\.(css|scss|less)$/i, kind: 'code', typeLabel: 'CSS' },
  { pattern: /\.(sql)$/i, kind: 'code', typeLabel: 'SQL' },
  { pattern: /\.(md)$/i, kind: 'code', typeLabel: 'MD' },
  { pattern: /\.(pdf)$/i, kind: 'document', typeLabel: 'PDF' },
  { pattern: /\.(doc)$/i, kind: 'document', typeLabel: 'DOC' },
  { pattern: /\.(docx)$/i, kind: 'document', typeLabel: 'DOCX' },
  { pattern: /\.(ppt)$/i, kind: 'document', typeLabel: 'PPT' },
  { pattern: /\.(pptx)$/i, kind: 'document', typeLabel: 'PPTX' },
  { pattern: /\.(txt)$/i, kind: 'document', typeLabel: 'TXT' },
  { pattern: /\.(rtf)$/i, kind: 'document', typeLabel: 'RTF' },
  { pattern: /\.(pages)$/i, kind: 'document', typeLabel: 'PAGES' },
  { pattern: /\.(key)$/i, kind: 'document', typeLabel: 'KEY' }
]

function getUnknownTypeLabel(language: Language): string {
  return language === 'zh' ? '文件' : 'File'
}

function getUnknownFileLabel(language: Language): string {
  return language === 'zh' ? '未知文件' : 'Unknown file'
}

export function getFileName(filePath: string | null): string {
  if (!filePath) return ''

  const normalizedPath = filePath.replace(/[\\/]+$/, '')
  if (!normalizedPath) return ''

  const pathSegments = normalizedPath.split(/[/\\]/)
  return pathSegments[pathSegments.length - 1] || ''
}

export function getFileDisplayName(filePath: string | null, language: Language): string {
  return getFileName(filePath) || getUnknownFileLabel(language)
}

function getMatchedFileType(filePath: string | null): FileTypePattern | null {
  const fileName = getFileName(filePath)
  if (!fileName) return null

  return FILE_TYPE_PATTERNS.find(({ pattern }) => pattern.test(fileName)) ?? null
}

export function getFileKind(filePath: string | null): FileKind {
  return getMatchedFileType(filePath)?.kind ?? 'file'
}

export function getFileKindLabel(filePath: string | null, language: Language): string {
  return FILE_KIND_LABELS[language][getFileKind(filePath)]
}

export function getFileTypeLabel(filePath: string | null, language: Language): string {
  const matchedType = getMatchedFileType(filePath)
  if (matchedType) return matchedType.typeLabel

  const fileName = getFileName(filePath)
  const extensionIndex = fileName.lastIndexOf('.')
  if (extensionIndex > 0 && extensionIndex < fileName.length - 1) {
    return fileName.slice(extensionIndex + 1).toUpperCase()
  }

  return getUnknownTypeLabel(language)
}

export function formatFileDisplayText(filePath: string | null, language: Language): string {
  const fileName = getFileDisplayName(filePath, language)
  const kindLabel = getFileKindLabel(filePath, language)
  const typeLabel = getFileTypeLabel(filePath, language)

  if (language === 'zh') {
    return `${kindLabel}（${typeLabel}）：${fileName}`
  }

  return `${kindLabel} (${typeLabel}): ${fileName}`
}
