// El límite incluye metadatos y caracteres escapados del JSON.
export function bounded(value: unknown, maxChars: number, hint: string): { text: string; overflow: boolean } {
  const result: unknown = Array.isArray(value) ? { items: value, truncated: false } : value
  const text = JSON.stringify(result)
  // Recortar resultados aquí invalidaría nextOffset.
  if (text.length <= maxChars) return { text, overflow: false }
  return { text: JSON.stringify({ error: `El resultado supera el presupuesto. ${hint}`, truncated: true }), overflow: true }
}
