export type PageFormat = 'letter' | 'oficio' | 'legal' | 'a4' | 'a5' | 'custom'

export interface PageSettings {
  format: PageFormat
  widthMm: number
  heightMm: number
}

export const pageFormats = [
  { id: 'letter', label: 'Carta', widthMm: 215.9, heightMm: 279.4 },
  { id: 'oficio', label: 'Oficio', widthMm: 216, heightMm: 330 },
  { id: 'legal', label: 'Legal', widthMm: 215.9, heightMm: 355.6 },
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210 }
] as const

export const defaultPageSettings: PageSettings = { format: 'a4', widthMm: 210, heightMm: 297 }
export const pageMarginMm = 15
export const minPageDimensionMm = 50
export const maxPageDimensionMm = 1000

export function validatePageSettings(value: unknown): value is PageSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as Record<string, unknown>
  if (Object.keys(settings).length !== 3 || !Object.keys(settings).every((key) => ['format', 'widthMm', 'heightMm'].includes(key))) return false
  const validDimension = (dimension: unknown): dimension is number => typeof dimension === 'number'
    && Number.isFinite(dimension) && dimension >= minPageDimensionMm && dimension <= maxPageDimensionMm
    && Math.abs(dimension * 10 - Math.round(dimension * 10)) < 0.000001
  if (!validDimension(settings.widthMm) || !validDimension(settings.heightMm)) return false
  if (settings.format === 'custom') return true
  const preset = pageFormats.find((format) => format.id === settings.format)
  return Boolean(preset && settings.widthMm === preset.widthMm && settings.heightMm === preset.heightMm)
}
