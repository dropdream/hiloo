import type { DocumentResult } from './documents'

export const maxPrintStyleBytes = 64 * 1024

export function printStyleProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'El CSS de impresión no es válido.'
  if (value.includes('\0')) return 'El CSS de impresión contiene caracteres no admitidos.'
  if (new TextEncoder().encode(value).length > maxPrintStyleBytes) return 'El CSS de impresión supera el límite de 64 KB.'
  return null
}

// Nesting scopes custom rules to the document and outranks the default print rules.
export function scopedPrintStyle(css: string): string {
  return `@media print { :root .hiloo-document.hiloo-document { ${css}\n} }`
}

export interface SettingsBridge {
  printStyle(): Promise<string>
  setPrintStyle(css: string): Promise<DocumentResult>
}
