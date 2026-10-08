import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { safeImage } from '../shared/markdown'
import type { DocumentSession } from './document-io'

const maxImageBytes = 10 * 1024 * 1024

function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.toString('ascii', 0, 2) === 'BM') return 'image/bmp'
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12)))
    return 'image/avif'
  return null
}

export function createImageHandler(currentDocument: () => DocumentSession) {
  return async (id: unknown, source: unknown) => {
    if (id !== currentDocument().id || typeof source !== 'string' || source.length > 8192 || !safeImage(source))
      return null
    const origin = source.trim()
    if (/^https?:\/\//i.test(origin)) return origin
    const documentPath = currentDocument().path
    if (!documentPath) return null
    try {
      const path = decodeURIComponent(origin.split(/[?#]/, 1)[0])
      const root = await fs.realpath(dirname(documentPath))
      const target = await fs.realpath(resolve(root, path))
      const fromRoot = relative(root, target)
      // Resolver enlaces simbólicos evita salir de la carpeta del documento.
      if (!fromRoot || isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return null
      const file = await fs.open(target, 'r')
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > maxImageBytes) return null
        const bytes = Buffer.alloc(Math.min(stat.size + 1, maxImageBytes + 1))
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
        if (bytesRead > maxImageBytes || bytesRead !== stat.size) return null
        const content = bytes.subarray(0, bytesRead)
        const mime = imageMime(content)
        if (!mime || id !== currentDocument().id || documentPath !== currentDocument().path) return null
        return `data:${mime};base64,${content.toString('base64')}`
      } finally {
        await file.close()
      }
    } catch {
      return null
    }
  }
}
