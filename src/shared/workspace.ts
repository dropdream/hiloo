import type { DocumentResult } from './documents'

export interface WorkspaceNote {
  id: string
  name: string
  relativePath: string
}

export interface WorkspaceFolder {
  id: string
  name: string
  relativePath: string
}

export interface WorkspaceLink {
  source: string
  target: string
}

export interface WorkspaceSnapshot {
  id: string
  name: string
  notes: WorkspaceNote[]
  folders: WorkspaceFolder[]
  links: WorkspaceLink[]
  currentNoteId: string | null
  warnings: string[]
}

export type WorkspacePreviewResult =
  | { status: 'ok'; note: WorkspaceNote; content: string }
  | { status: 'error'; message: string }

export type WorkspaceLinkResult =
  | { status: 'ok'; href: string; note: WorkspaceNote }
  | { status: 'error'; message: string }

export interface WorkspaceBridge {
  current(): Promise<WorkspaceSnapshot | null>
  choose(): Promise<DocumentResult>
  refresh(): Promise<DocumentResult>
  open(noteId: string): Promise<DocumentResult>
  preview(noteId: string): Promise<WorkspacePreviewResult>
  linkTo(noteId: string): Promise<WorkspaceLinkResult>
  create(parentId: string, name: string, kind: 'folder' | 'note'): Promise<DocumentResult>
  onChange(callback: (workspace: WorkspaceSnapshot | null) => void): () => void
}
