import { fold, isStopword, stems, type LanguageCode } from './languages'

export interface FtsQuery {
  expression: string
  terms: string[]
}

// Cada término va entre comillas: operadores, NEAR, columnas o comodines del usuario quedan como texto.
// Solo se descartan las palabras vacías de los idiomas activos, para no perder términos de otro idioma.
export function ftsQuery(query: string, languages: readonly LanguageCode[]): FtsQuery {
  const words = (query.normalize('NFC').match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []).map((word) => word.toLowerCase())
  const keywords = words.filter((word) => !isStopword(word, languages))
  const seen = new Set<string>()
  const terms: string[] = []
  for (const word of keywords.length ? keywords : words) {
    if (seen.has(fold(word))) continue
    seen.add(fold(word))
    terms.push(word)
    if (terms.length === 16) break
  }
  // Repetir un término duplica su peso BM25; un identificador como load_manifests es casi siempre la clave.
  const matches = terms.flatMap((term) => Array(term.includes('_') ? 2 : 1).fill(termMatch(term, languages)))
  return { expression: matches.join(' OR '), terms }
}

// El índice no guarda raíces: se busca la forma exacta (que puntúa más) y la raíz Snowball como prefijo.
// Sin raíz útil, las palabras de 6 o más letras pierden sus 2 últimas letras.
export function termMatch(term: string, languages: readonly LanguageCode[]): string {
  if (!/^\p{L}+$/u.test(term)) return `"${term}"`
  const letters = [...term]
  const prefixes = stems(term, languages)
  if (!prefixes.length && letters.length >= 6) prefixes.push(letters.slice(0, Math.max(5, letters.length - 2)).join(''))
  if (!prefixes.length) return `"${term}"`
  return `("${term}" OR ${prefixes.map((prefix) => `"${prefix}"*`).join(' OR ')})`
}
