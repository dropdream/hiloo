import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute } from 'node:path'
import type { RecentWorkspace } from '../shared/workspace'
import { pathKey } from './workspace'

type StoredWorkspace = Omit<RecentWorkspace, 'current'>

const maxRecentWorkspaces = 10
const maxHistoryBytes = 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validEntry(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<StoredWorkspace>
  return typeof entry.id === 'string' && uuid.test(entry.id)
    && typeof entry.name === 'string'
    && typeof entry.path === 'string' && entry.path.length <= 32767 && !entry.path.includes('\0') && isAbsolute(entry.path)
    && typeof entry.lastOpenedAt === 'string' && Number.isFinite(Date.parse(entry.lastOpenedAt))
}

export class RecentWorkspaces {
  private entries: StoredWorkspace[] = []
  private loaded: Promise<void> | null = null

  constructor(private readonly filePath: string) {}

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const file = await fs.open(this.filePath, 'r')
        let contents: string
        try {
          const stat = await file.stat()
          if (!stat.isFile() || stat.size > maxHistoryBytes) return
          const buffer = Buffer.alloc(stat.size + 1)
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
          if (bytesRead !== stat.size) return
          contents = buffer.subarray(0, bytesRead).toString('utf8')
        } finally { await file.close() }
        const stored: unknown = JSON.parse(contents)
        if (!Array.isArray(stored)) return
        const paths = new Set<string>()
        const ids = new Set<string>()
        // The stored order records actual opens even if the system clock moves backwards.
        this.entries = stored.filter(validEntry)
          .filter((entry) => {
            const key = pathKey(entry.path)
            if (paths.has(key) || ids.has(entry.id)) return false
            paths.add(key)
            ids.add(entry.id)
            return true
          }).slice(0, maxRecentWorkspaces)
          .map(({ id, path, lastOpenedAt }) => ({ id, path, lastOpenedAt, name: basename(path) || path }))
      } catch { /* A missing or damaged history must not prevent opening a notebook. */ }
    })()
    return this.loaded
  }

  async list(currentRoot: string | null): Promise<RecentWorkspace[]> {
    await this.load()
    return this.entries.map((entry) => ({ ...entry, current: currentRoot !== null && pathKey(entry.path) === pathKey(currentRoot) }))
  }

  async find(id: unknown): Promise<StoredWorkspace | undefined> {
    if (typeof id !== 'string' || !uuid.test(id)) return undefined
    await this.load()
    return this.entries.find((entry) => entry.id === id)
  }

  async remember(root: string): Promise<void> {
    await this.load()
    const key = pathKey(root)
    const existing = this.entries.find((entry) => pathKey(entry.path) === key)
    this.entries = [{ id: existing?.id ?? randomUUID(), name: basename(root) || root, path: root, lastOpenedAt: new Date().toISOString() },
      ...this.entries.filter((entry) => pathKey(entry.path) !== key)].slice(0, maxRecentWorkspaces)
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(this.entries), { flag: 'wx' })
      await fs.rename(temporary, this.filePath)
    } finally {
      await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    }
  }
}
