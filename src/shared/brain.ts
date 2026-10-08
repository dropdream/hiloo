// Markdown conserva el contenido; el catálogo guarda identidades y relaciones manuales.
export type BrainNodeKind = 'notebook' | 'folder' | 'note'
export type BrainNotebookStatus = 'pending' | 'ready' | 'partial' | 'unavailable'

export interface BrainNotebook {
  id: string
  name: string
  root: string
  indexedAt: string | null
  status: BrainNotebookStatus
  nodeCount: number
  chunkCount: number
}

export interface BrainCatalogRequest {
  limit?: number
  offset?: number
  maxChars?: number
}

export interface BrainCatalogResult {
  items: BrainNotebook[]
  truncated: boolean
  nextOffset: number | null
}

export interface BrainSearchRequest {
  query: string
  notebookId?: string
  ancestorId?: string
  limit?: number
  maxChars?: number
}

export interface BrainSearchHit {
  chunkId: string
  nodeId: string
  notebookId: string
  title: string
  relativePath: string
  heading: string
  excerpt: string
  sourceHash: string
  indexedAt: string
}

export interface BrainSearchResult {
  items: BrainSearchHit[]
  truncated: boolean
  indexedAt: string | null
}

export interface BrainReadRequest {
  chunkIds: string[]
  maxChars?: number
  expectedHashes?: Record<string, string>
}

export interface BrainReadItem {
  chunkId: string
  nodeId: string
  status: 'ok' | 'stale' | 'unavailable'
  relativePath: string
  heading: string
  sourceHash: string
  content?: string
  // Posiciones UTF-16 del texto decodificado, sin BOM.
  startOffset?: number
  endOffset?: number
  nextChunkId?: string | null
}

export interface BrainReadResult {
  items: BrainReadItem[]
  truncated: boolean
}

export interface BrainRelatedRequest {
  nodeId: string
  direction?: 'in' | 'out' | 'both'
  type?: 'hierarchy' | 'link' | 'manual'
  limit?: number
  offset?: number
  maxChars?: number
}

export interface BrainRelatedItem {
  nodeId: string
  notebookId: string
  kind: BrainNodeKind
  title: string
  relativePath: string
  type: 'hierarchy' | 'link' | 'manual'
  direction: 'in' | 'out'
  fragment: string | null
  linkId?: string
  label?: string
}

export interface BrainLinkRequest {
  sourceId: string
  targetId: string
  label?: string
}

export interface BrainLinkResult {
  id: string
  sourceId: string
  targetId: string
  label: string
}

export interface BrainRelatedResult {
  items: BrainRelatedItem[]
  truncated: boolean
  nextOffset: number | null
}

export interface BrainSyncResult {
  notebookId: string
  status: BrainNotebookStatus
  indexedAt: string | null
  changedFiles: number
  removedNodes: number
  warnings: string[]
}

export interface BrainStatus {
  schemaVersion: number
  notebookCount: number
  nodeCount: number
  chunkCount: number
  linkCount: number
  pendingJobs: number
}

export interface BrainBridge {
  catalog(request?: BrainCatalogRequest): Promise<BrainCatalogResult>
  search(request: BrainSearchRequest): Promise<BrainSearchResult>
  read(request: BrainReadRequest): Promise<BrainReadResult>
  related(request: BrainRelatedRequest): Promise<BrainRelatedResult>
  link(request: BrainLinkRequest): Promise<BrainLinkResult>
  unlink(linkId: string): Promise<void>
  sync(notebookId: string): Promise<BrainSyncResult>
  status(): Promise<BrainStatus>
}
