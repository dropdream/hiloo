import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import type { DocumentResult } from './documents'

export const maxPrintStyleBytes = 64 * 1024

function printStyleTree(css: string) {
  const tree = postcss.parse(css)
  tree.walkAtRules((rule) => {
    if (!['media', 'supports', 'container'].includes(rule.name.toLowerCase()) || !rule.nodes) {
      throw new Error('Usa solo reglas @media, @supports o @container dentro del documento.')
    }
  })
  tree.walkRules((rule) => {
    const selectors = selectorParser().astSync(rule.selector)
    selectors.walkNesting(() => { throw new Error('Los selectores con & no están admitidos en el CSS de impresión.') })
    selectors.each((selector) => {
      const first = selector.nodes.find((node) => node.type !== 'comment')
      if (first?.type === 'combinator' && first.value.trim() !== '>') {
        throw new Error('Los selectores deben permanecer dentro del documento.')
      }
    })
  })
  return tree
}

export function printStyleProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'El CSS de impresión no es válido.'
  if (value.includes('\0')) return 'El CSS de impresión contiene caracteres no admitidos.'
  if (new TextEncoder().encode(value).length > maxPrintStyleBytes) return 'El CSS de impresión supera el límite de 64 KB.'
  try { printStyleTree(value) } catch {
    return 'El CSS de impresión no es válido. Usa declaraciones y selectores del documento, sin & ni reglas globales.'
  }
  return null
}

// Las reglas anidadas quedan dentro del documento y solo se aplican al imprimir.
export function scopedPrintStyle(css: string): string {
  return `@media print { :root .hiloo-document.hiloo-document { ${printStyleTree(css).toString()}\n} }`
}

export interface SettingsBridge {
  printStyle(): Promise<string>
  setPrintStyle(css: string): Promise<DocumentResult>
}
