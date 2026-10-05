export type NotebookIndexUsage = 'ia' | 'humano' | 'ambos'

export const notebookIndexUsages: readonly NotebookIndexUsage[] = ['ia', 'humano', 'ambos']

/** Root file created by hiloo. Any of the names below means the notebook already has an index. */
export const notebookIndexFile = 'indice.md'
export const notebookIndexNames: readonly string[] = ['indice.md', 'índice.md', 'index.md']

export const maxIndexedNotes = 200

export interface NotebookIndexInput {
  name: string
  usage: NotebookIndexUsage
  /** ISO date, yyyy-mm-dd. */
  date: string
  /** Relative paths of the notebook notes, with forward slashes. */
  notes: readonly string[]
}

export function isNotebookIndexUsage(value: unknown): value is NotebookIndexUsage {
  return typeof value === 'string' && (notebookIndexUsages as readonly string[]).includes(value)
}

export function isNotebookIndexName(name: string): boolean {
  const normalized = name.normalize('NFC').toLowerCase()
  return notebookIndexNames.includes(normalized)
}

/** Backslash-escapes characters that could start inline Markdown syntax, entities or a heading closing sequence. */
export function escapeMarkdownText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\\`*_[\]<>&~!|#]/g, '\\$&')
}

/** Encodes each segment so spaces, parentheses and reserved characters stay inside the link destination. */
export function encodeNotePath(relativePath: string): string {
  return relativePath.split('/').map((segment) => encodeURIComponent(segment).replace(/[()]/g, (character) => character === '(' ? '%28' : '%29')).join('/')
}

function noteMap(notes: readonly string[]): string[] {
  if (!notes.length) return ['*Aún no hay notas en este cuaderno.*']
  const lines = notes.slice(0, maxIndexedNotes).map((path) => `- [${escapeMarkdownText(path.replace(/\.(?:md|markdown)$/i, ''))}](${encodeNotePath(path)})`)
  if (notes.length > maxIndexedNotes) lines.push('', `*La lista es parcial: se muestran ${maxIndexedNotes} de ${notes.length} notas. Completa el mapa al revisar el cuaderno.*`)
  return lines
}

function aiRules(both: boolean): string[] {
  const rules = [
    'Lee este índice antes de buscar, crear o modificar notas.',
    'El cuaderno es una carpeta de notas Markdown (`.md`); sus subcarpetas agrupan temas relacionados.',
    'Dedica cada nota a un solo tema, con un título descriptivo.',
    'Conecta las notas con enlaces Markdown relativos estándar, como `[Texto](carpeta/nota.md)`, y codifica los espacios como `%20`. Así las conexiones aparecen en Cerebro.',
    'No borres ni sobrescribas notas salvo que la persona lo pida.',
    'Al crear o renombrar una nota, actualiza el mapa de notas de este índice.',
    'Escribe las notas en español salvo que se indique otro idioma.',
    'Usa Markdown compatible con hiloo: párrafos, encabezados, listas, citas, énfasis, enlaces, bloques de código, tablas y tachado. Evita HTML, metadatos YAML, enlaces por referencia y notas al pie.',
    'Si dispones de la skill hiloo-notes o de la CLI de Cerebro de hiloo, empieza por consultar su catálogo (`catalog`) para identificar este cuaderno y usa `search` antes de explorar archivos o guardar notas nuevas. Después de guardar, sincroniza el cuaderno con `sync`.'
  ]
  if (both) rules.push('Las secciones marcadas como pendientes pueden completarse por la persona o por una IA a petición suya.')
  return ['## Instrucciones para IA', '', ...rules.map((rule, index) => `${index + 1}. ${rule}`)]
}

function humanSections(both: boolean): string[] {
  return [
    '## Introducción', '',
    '*Escribe aquí de qué trata este cuaderno, para quién es y qué quieres lograr.*', '',
    '## Secciones', '',
    both
      ? 'Define las secciones de este documento según lo que necesites. Tú o tu IA pueden completar los apartados pendientes, cambiarlos o añadir otros.'
      : 'Define las secciones de este documento según lo que necesites. Puedes cambiar, quitar o añadir apartados a partir de estos ejemplos.',
    '',
    '### Objetivos', '',
    '*Pendiente: describe qué quieres conseguir con este cuaderno.*', '',
    '### Contexto', '',
    '*Pendiente: resume los antecedentes, las personas involucradas o las fuentes principales.*', '',
    '### Próximos pasos', '',
    '*Pendiente: anota las tareas o decisiones siguientes.*'
  ]
}

export function buildNotebookIndex({ name, usage, date, notes }: NotebookIndexInput): string {
  const title = escapeMarkdownText(name.trim() || 'Cuaderno')
  const created = `*Creado con hiloo el ${date}.*`
  const lines = usage === 'ia'
    ? [
        `# Índice — ${title}`, '',
        `Punto de entrada del cuaderno **${title}** para agentes de IA. ${created}`, '',
        ...aiRules(false), '',
        '## Mapa de notas', '', ...noteMap(notes)
      ]
    : usage === 'humano'
      ? [
          `# ${title}`, '', created, '',
          ...humanSections(false), '',
          '## Notas', '', ...noteMap(notes)
        ]
      : [
          `# ${title}`, '', created, '',
          ...aiRules(true), '',
          ...humanSections(true), '',
          '## Mapa de notas', '', ...noteMap(notes)
        ]
  return `${lines.join('\n')}\n`
}
