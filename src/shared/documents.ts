import type { PageSettings } from './printing'

export const maxDocumentBytes = 2 * 1024 * 1024

export interface DocumentSnapshot {
  id: string
  name: string
  content: string
  savedContent: string
  revision: number
  savedRevision: number
  updateError: string | null
  dirty: boolean
  hasFile: boolean
}

export type DocumentResult = { status: 'ok' } | { status: 'cancelled' } | { status: 'error'; message: string }

export interface DocumentPrintSnapshot {
  documentId: string
  revision: number
}

export type DocumentPreviewResult = ({ status: 'ok'; pdf: Uint8Array } & DocumentPrintSnapshot)
  | Exclude<DocumentResult, { status: 'ok' }>

export interface DocumentBridge {
  current(): Promise<DocumentSnapshot>
  open(): Promise<DocumentResult>
  save(asCopy?: boolean): Promise<DocumentResult>
  printPreview(settings: PageSettings): Promise<DocumentPreviewResult>
  print(settings: PageSettings, snapshot?: DocumentPrintSnapshot): Promise<DocumentResult>
  update(id: string, content: string): Promise<DocumentResult>
  imageSource(id: string, source: string): Promise<string | null>
  onDocument(callback: (document: DocumentSnapshot) => void): () => void
  onBusy(callback: (busy: boolean) => void): () => void
  onError(callback: (message: string) => void): () => void
  onFlush(callback: () => Promise<string | null>): () => void
}
