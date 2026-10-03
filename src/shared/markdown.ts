import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml'])
const supported = new Set(['root', 'paragraph', 'text', 'heading', 'strong', 'emphasis', 'blockquote', 'list', 'listItem', 'code', 'inlineCode', 'break', 'thematicBreak', 'link'])
const names: Record<string, string> = {
  html: 'HTML', image: 'imágenes', imageReference: 'imágenes por referencia',
  definition: 'referencias', linkReference: 'enlaces por referencia',
  table: 'tablas', delete: 'tachado', yaml: 'metadatos YAML', toml: 'metadatos TOML',
  footnoteDefinition: 'notas al pie', footnoteReference: 'notas al pie'
}

export function markdownProblem(markdown: string): string | null {
  const tree = parser.parse(markdown)
  let problem: string | null = null
  function visit(node: { type: string; children?: unknown[]; checked?: unknown; url?: string; meta?: string | null }): void {
    if (problem) return
    if (!supported.has(node.type)) problem = names[node.type] ?? node.type
    if (node.type === 'listItem' && node.checked != null) problem = 'listas de tareas'
    if (node.type === 'code' && node.meta) problem = 'atributos adicionales de código'
    if (node.type === 'link' && node.url && !safeLink(node.url)) problem = 'enlaces con un protocolo no admitido'
    node.children?.forEach((child) => visit(child as typeof node))
  }
  visit(tree)
  if (/^\s*(?:\$\$|:::)/m.test(markdown)) problem = 'fórmulas o directivas extendidas'
  return problem ? `Este documento contiene ${problem}, un formato que todavía no admite la edición visual. El archivo no se ha modificado. Abrir con otro editor para conservar ese contenido.` : null
}

export function safeLink(url: string): boolean {
  const normalized = url.trim().replace(/[\u0000-\u0020]/g, '')
  return !normalized.startsWith('//') && (!/^[a-z][a-z\d+.-]*:/i.test(normalized) || /^(https?:|mailto:)/i.test(normalized))
}

export function markdownSignature(markdown: string): string {
  return JSON.stringify(parser.parse(markdown), (key, value: unknown) =>
    key === 'position' || key === 'spread' || key === 'checked' ? undefined : value
  )
}
