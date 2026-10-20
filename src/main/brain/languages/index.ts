import { stopwords as de } from './de'
import { stopwords as en } from './en'
import { stopwords as es } from './es'
import { stopwords as fr } from './fr'
import { stopwords as it } from './it'
import { stopwords as pt } from './pt'

import { stemmer as deStem } from '@orama/stemmers/german'
import { stemmer as enStem } from '@orama/stemmers/english'
import { stemmer as esStem } from '@orama/stemmers/spanish'
import { stemmer as frStem } from '@orama/stemmers/french'
import { stemmer as itStem } from '@orama/stemmers/italian'
import { stemmer as ptStem } from '@orama/stemmers/portuguese'
import type { BrainLanguage } from '../../../shared/brain'

export type LanguageCode = BrainLanguage
export const languageCodes: readonly LanguageCode[] = ['es', 'en', 'pt', 'fr', 'de', 'it']

const lists: Record<LanguageCode, string> = { es, en, pt, fr, de, it }
const sets = Object.fromEntries(
  languageCodes.map((code) => [code, new Set(lists[code].split(/\s+/).filter(Boolean))])
) as Record<LanguageCode, Set<string>>

const stemmers: Record<LanguageCode, (word: string) => string> = { es: esStem, en: enStem, pt: ptStem, fr: frStem, de: deStem, it: itStem }

export const isLanguage = (value: unknown): value is LanguageCode => languageCodes.includes(value as LanguageCode)

// Las listas no llevan tildes: se comparan con la palabra plegada.
export const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export const isStopword = (word: string, languages: readonly LanguageCode[]) =>
  languages.some((code) => sets[code].has(fold(word)))

// Raíces Snowball de la palabra plegada; se descartan las que no la acortan o quedan en menos de 4 letras.
export function stems(word: string, languages: readonly LanguageCode[]): string[] {
  const folded = fold(word)
  const found = new Set<string>()
  for (const code of languages) {
    const stem = stemmers[code](folded)
    if (stem !== folded && [...stem].length >= 4) found.add(stem)
  }
  // Un prefijo más corto ya cubre a los más largos.
  return [...found].filter((stem) => ![...found].some((other) => other !== stem && stem.startsWith(other)))
}

// Gana el idioma con más palabras vacías; un empate o menos de `min` aciertos no decide.
export function detectLanguage(text: string, min = 2): LanguageCode | null {
  const counts = new Map<LanguageCode, number>()
  for (const word of text.normalize('NFC').match(/[\p{L}\p{M}]+/gu) ?? []) {
    const folded = fold(word)
    for (const code of languageCodes) if (sets[code].has(folded)) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1])
  if (!first || first[1] < min || first[1] === second?.[1]) return null
  return first[0]
}

// Precedencia: idiomas de los cuadernos consultados, más el de la pregunta si se detecta.
// Sin ninguno, basta una palabra vacía en la pregunta; si tampoco, no se descarta nada.
export function searchLanguages(query: string, notebooks: readonly LanguageCode[]): LanguageCode[] {
  const languages = new Set(notebooks)
  const asked = detectLanguage(query) ?? (languages.size ? null : detectLanguage(query, 1))
  if (asked) languages.add(asked)
  return [...languages]
}
