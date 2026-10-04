import { createHash } from 'node:crypto'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

const parser = unified().use(remarkParse).use(remarkGfm)
export const parserVersion = 1
export const chunkVersion = 1
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

interface Node {
  type: string
  depth?: number
  value?: string
  url?: string
  identifier?: string
  children?: Node[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

export interface ParsedChunk { heading: string; start: number; end: number; body: string; hash: string }
export interface ParsedDocument { title: string; chunks: ParsedChunk[]; urls: string[]; partial: boolean }

const nodeText = (node: Node): string => node.value ?? node.children?.map(nodeText).join('') ?? ''

export function parseDocument(source: string, fallbackTitle: string): ParsedDocument {
  const tree = parser.parse(source) as Node
  const chunks: ParsedChunk[] = []
  const headings: string[] = []
  let title = fallbackTitle
  let heading = ''
  let start = 0
  const append = (end: number) => {
    while (start < end) {
      let stop = Math.min(end, start + 2400)
      if (stop < end) {
        const newline = source.lastIndexOf('\n', stop)
        if (newline > start + 1200) stop = newline + 1
        if (/^[\uDC00-\uDFFF]$/.test(source[stop] ?? '')) stop--
      }
      const body = source.slice(start, stop)
      if (body.trim()) chunks.push({ heading, start, end: stop, body, hash: hash(body) })
      start = stop
    }
  }
  for (const block of tree.children ?? []) {
    const offset = block.position?.start.offset ?? 0
    if (block.type === 'heading') {
      append(offset)
      const depth = block.depth ?? 1
      headings.length = depth - 1
      headings[depth - 1] = nodeText(block).slice(0, 300)
      heading = headings.filter(Boolean).join(' / ')
      if (depth === 1 && title === fallbackTitle) title = nodeText(block).slice(0, 300) || fallbackTitle
    } else if ((block.position?.end.offset ?? offset) - start > 2400 && offset > start) {
      append(offset)
    }
  }
  append(source.length)
  const definitions = new Map<string, string>()
  const references: string[] = []
  const urls: string[] = []
  const pending = [tree]
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === 'link' && node.url) urls.push(node.url)
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url)
    if (node.type === 'linkReference' && node.identifier) references.push(node.identifier)
    if (node.children) pending.push(...node.children.slice().reverse())
  }
  urls.push(...references.flatMap((id) => definitions.has(id) ? [definitions.get(id)!] : []))
  return { title, chunks, urls: [...new Set(urls)].slice(0, 256), partial: urls.length > 256 }
}
