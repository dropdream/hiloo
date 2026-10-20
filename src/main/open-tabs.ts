import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

export interface OpenTabsState {
  paths: string[]
  active: number
}

const maxTabs = 50
const maxFileBytes = 256 * 1024

// Pestañas guardadas entre sesiones; los documentos sin archivo no se conservan.
export class OpenTabsStore {
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<OpenTabsState | null> {
    try {
      const stat = await fs.stat(this.filePath)
      if (!stat.isFile() || stat.size > maxFileBytes) return null
      const stored: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      if (!stored || typeof stored !== 'object') return null
      const { paths, active } = stored as Partial<OpenTabsState>
      if (!Array.isArray(paths)) return null
      const valid = paths
        .filter((path): path is string => typeof path === 'string' && path.length <= 32767 && !path.includes('\0') && isAbsolute(path))
        .slice(0, maxTabs)
      return { paths: valid, active: Number.isSafeInteger(active) && active! >= 0 && active! < valid.length ? active! : 0 }
    } catch {
      return null
    }
  }

  // Las escrituras van en cola para que la última siempre gane.
  save(state: OpenTabsState): Promise<void> {
    this.writing = this.writing.then(async () => {
      const temporary = `${this.filePath}.${randomUUID()}.tmp`
      try {
        await fs.mkdir(dirname(this.filePath), { recursive: true })
        await fs.writeFile(temporary, JSON.stringify(state), { flag: 'wx' })
        await fs.rename(temporary, this.filePath)
      } catch {
        // Un fallo al recordar pestañas no interrumpe la edición.
      } finally {
        await fs.unlink(temporary).catch(() => {})
      }
    })
    return this.writing
  }
}
