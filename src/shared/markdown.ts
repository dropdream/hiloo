import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml'])
const supported = new Set([
  'root',
  'paragraph',
  'text',
  'heading',
  'strong',
  'emphasis',
  'blockquote',
  'list',
  'listItem',
  'code',
  'inlineCode',
  'break',
  'thematicBreak',
  'link',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'delete'
])
const names: Record<string, string> = {
  html: 'HTML',
  imageReference: 'imágenes por referencia',
  definition: 'referencias',
  linkReference: 'enlaces por referencia',
  yaml: 'metadatos YAML',
  toml: 'metadatos TOML',
  footnoteDefinition: 'notas al pie',
  footnoteReference: 'notas al pie'
}

export function markdownProblem(markdown: string): string | null {
  if (markdown.includes('\0')) return 'El documento contiene NUL y no puede guardarse como Markdown. Corrige la edición antes de guardar.'
  const tree = parser.parse(markdown)
  let problem: string | null = null
  function visit(node: {
    type: string
    children?: unknown[]
    checked?: unknown
    url?: string
    meta?: string | null
    position?: { start: { offset?: number }; end: { offset?: number } }
  }): void {
    if (problem) return
    if (node.type === 'paragraph' && node.position) {
      const start = node.position.start.offset ?? 0
      let source = markdown.slice(start, node.position.end.offset)
      const maskCode = (child: typeof node) => {
        if (child.type === 'inlineCode' && child.position) {
          const from = (child.position.start.offset ?? start) - start
          const to = (child.position.end.offset ?? start) - start
          source = source.slice(0, from) + source.slice(from, to).replace(/[^\r\n]/g, 'x') + source.slice(to)
        }
        child.children?.forEach((descendant) => maskCode(descendant as typeof node))
      }
      node.children?.forEach((child) => maskCode(child as typeof node))
      if (/^\s*(?:\$\$|:::)/m.test(source)) problem = 'fórmulas o directivas extendidas'
    }
    if (!supported.has(node.type)) problem = names[node.type] ?? node.type
    if (node.type === 'code' && node.meta) problem = 'atributos adicionales de código'
    if (node.type === 'link' && node.url && !safeLink(node.url)) problem = 'enlaces con un protocolo no admitido'
    if (node.type === 'image' && (!node.url || !safeImage(node.url))) problem = 'imágenes con un origen no admitido'
    node.children?.forEach((child) => visit(child as typeof node))
  }
  visit(tree)
  return problem
    ? `Este documento contiene ${problem}, un formato que todavía no admite la edición visual. ` +
      'El archivo no se ha modificado. Abrir con otro editor para conservar ese contenido.'
    : null
}

export function safeLink(url: string): boolean {
  const normalized = url.trim().replace(/[\u0000-\u0020]/g, '')
  return !normalized.startsWith('//') && (!/^[a-z][a-z\d+.-]*:/i.test(normalized) || /^(https?:|mailto:)/i.test(normalized))
}

export function markdownSignature(markdown: string): string {
  return JSON.stringify(parser.parse(markdown), (key, value: unknown) => (key === 'position' || key === 'spread' ? undefined : value))
}

// Solo se admiten imágenes web o relativas al documento.
export function safeImage(source: string): boolean {
  const value = source.trim()
  if (!value || /[\u0000-\u001f\u007f\\]/.test(value)) return false
  if (/^https?:\/\//i.test(value)) {
    try {
      return Boolean(new URL(value).hostname)
    } catch {
      return false
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) return false
  try {
    const path = decodeURIComponent(value.split(/[?#]/, 1)[0])
    return Boolean(path) && !path.startsWith('/') && !/[\u0000-\u001f\u007f\\:]/.test(path)
  } catch {
    return false
  }
}
