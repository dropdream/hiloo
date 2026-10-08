import { constants, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { maxDocumentBytes } from '../shared/documents'
import { markdownProblem } from '../shared/markdown'
import { validateWorkspaceNote, type WorkspaceSession } from './workspace'

export interface DocumentSession {
  id: string
  path: string | null
  original: Buffer | null
  source: string
  content: string
  bom: boolean
  crlf: boolean
  revision: number
  savedRevision: number
  updateError: string | null
}

export function validatePath(path: string): void {
  if (!['.md', '.markdown'].includes(extname(path).toLowerCase())) throw new Error('Elegir un archivo .md o .markdown.')
}

export async function read(path: string): Promise<Buffer | null> {
  try {
    const stat = await fs.lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Elegir un archivo Markdown normal, sin enlaces simbólicos.')
    if (stat.size > maxDocumentBytes) throw new Error('El archivo supera el límite de 2 MB de esta entrega.')
    const file = await fs.open(path, 'r')
    try {
      const current = await file.stat()
      if (!current.isFile() || current.size > maxDocumentBytes)
        throw new Error('El archivo supera el límite de 2 MB de esta entrega.')
      const buffer = Buffer.alloc(Math.min(current.size + 1, maxDocumentBytes + 1))
      const result = await file.read(buffer, 0, buffer.length, 0)
      if (result.bytesRead > maxDocumentBytes) throw new Error('El archivo supera el límite de 2 MB de esta entrega.')
      if (result.bytesRead !== current.size) throw new Error('El archivo cambió durante la lectura. Volver a intentar.')
      return buffer.subarray(0, result.bytesRead)
    } finally {
      await file.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export const matches = (a: Buffer | null, b: Buffer | null) => (a === null ? b === null : b !== null && a.equals(b))
export const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

export async function writeDocument(
  target: string,
  writing: DocumentSession,
  expected: Buffer | null,
  owner: WorkspaceSession | null,
  assertWritable: () => void
): Promise<Buffer> {
  const problem = markdownProblem(writing.content)
  if (problem) throw new Error(problem)
  const text = writing.crlf ? writing.content.replace(/\r?\n/g, '\r\n') : writing.content
  const bytes =
    writing.content === writing.source && writing.original
      ? writing.original
      : Buffer.from(`${writing.bom ? '\uFEFF' : ''}${text}`, 'utf8')
  if (bytes.length > maxDocumentBytes) throw new Error('El documento supera el límite de 2 MB de esta entrega.')
  const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    const file = await fs.open(temp, 'wx')
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    // Comprobación final antes de reemplazar el archivo.
    if (owner) await validateWorkspaceNote(owner, target)
    if (!matches(await read(target), expected))
      throw new Error(
        'El archivo cambió fuera de hiloo. No se sobrescribió. Usar Guardar como para conservar la edición en otra ubicación.'
      )
    assertWritable()
    if (expected === null) {
      await fs.copyFile(temp, target, constants.COPYFILE_EXCL)
    } else {
      await fs.rename(temp, target)
    }
  } finally {
    await fs.unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
  return bytes
}
