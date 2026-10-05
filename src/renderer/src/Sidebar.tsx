import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { RecentDocument } from '../../shared/documents'
import type { RecentWorkspace, WorkspaceNote, WorkspaceSnapshot } from '../../shared/workspace'
import type { RecentList } from './use-recent-list'
import { Icon } from './Icon'
import styles from './Sidebar.module.css'

interface Props {
  workspace: WorkspaceSnapshot | null
  busy: boolean
  brainOpen: boolean
  recentWorkspaces: RecentWorkspace[]
  recentLoading: boolean
  recentError: string
  onRetryRecent(): void
  onOpenRecent(id: string): Promise<boolean>
  recentDocuments: RecentList<RecentDocument>
  onOpenRecentDocument(id: string): Promise<boolean>
  onPrintStyle(): void
  onChoose(): void
  onRefresh(): void
  onOpen(id: string): void
  onCreate(parentId: string, name: string, kind: 'folder' | 'note'): Promise<boolean>
  onBrain(): void
  onClose(): void
}

interface RecentPanelProps {
  id: string
  entries: RecentWorkspace[] | RecentDocument[]
  loading: boolean
  error: string
  busy: boolean
  // Spanish nouns for messages and accessible names.
  plural: string
  singular: string
  emptyHint: string
  openFailure: string
  fallbackFocus: HTMLButtonElement | null
  onRetry(): void
  onOpen(id: string): Promise<boolean>
  onOpened(): void
}

function RecentPanel({ id, entries, loading, error, busy, plural, singular, emptyHint, openFailure, fallbackFocus, onRetry, onOpen, onOpened }: RecentPanelProps) {
  const selection = useRef<HTMLButtonElement | null>(null)
  const [openError, setOpenError] = useState('')
  const [restoreFocus, setRestoreFocus] = useState(false)
  useEffect(() => {
    if (!restoreFocus || busy) return
    selection.current?.focus()
    setRestoreFocus(false)
  }, [restoreFocus, busy])

  const open = async (entryId: string, trigger: HTMLButtonElement) => {
    selection.current = trigger
    setOpenError('')
    try {
      if (await onOpen(entryId)) onOpened()
      else setRestoreFocus(true)
    } catch (failure) {
      setOpenError(failure instanceof Error ? failure.message : openFailure)
      selection.current = fallbackFocus
      setRestoreFocus(true)
    }
  }

  return <>
    {openError ? <p className={styles.recentMessage} role="alert">{openError}</p> : null}
    <div id={id} className={styles.recentPanel} role="region" aria-label={`Lista de ${plural} recientes`} aria-busy={loading}>
      {loading ? <p className={styles.recentMessage} role="status">Cargando {plural} recientes…</p> : error ? <div className={styles.recentMessage}>
        <p role="alert">{error}</p><button type="button" className={styles.retryRecent} onClick={onRetry}>Reintentar</button>
      </div> : entries.length ? <ul className={styles.recentList}>
        {entries.map((item) => <li key={item.id}>
          <button type="button" className={styles.recentRow} disabled={busy || item.current} aria-label={`Abrir ${singular} reciente: ${item.path}`} aria-current={item.current ? 'true' : undefined} title={item.path} onClick={(event) => { void open(item.id, event.currentTarget) }}>
            <span className={styles.recentName}>{item.name}{item.current ? <span className={styles.recentCurrent}>Actual</span> : null}</span>
            <span className={styles.recentPath}>{item.path}</span>
          </button>
        </li>)}
      </ul> : <p className={styles.recentMessage}>Aún no hay {plural} recientes. {emptyHint}</p>}
    </div>
  </>
}

const searchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es')

interface NoteFolder {
  id: string
  name: string
  path: string
  folders: Map<string, NoteFolder>
  notes: WorkspaceNote[]
}

function buildTree(notes: WorkspaceNote[], folders: WorkspaceSnapshot['folders'], rootId: string, term: string): NoteFolder {
  const root: NoteFolder = { id: rootId, name: '', path: '', folders: new Map(), notes: [] }
  const folderIds = new Map(folders.map((folder) => [folder.relativePath.replaceAll('\\', '/'), folder.id]))
  const ensureFolder = (segments: string[]) => {
    let parent = root
    for (const name of segments) {
      let folder = parent.folders.get(name)
      if (!folder) {
        const path = parent.path ? `${parent.path}/${name}` : name
        folder = { id: folderIds.get(path) ?? '', name, path, folders: new Map(), notes: [] }
        parent.folders.set(name, folder)
      }
      parent = folder
    }
    return parent
  }
  for (const folder of folders) {
    if (!term || searchText(folder.relativePath).includes(term)) ensureFolder(folder.relativePath.split(/[\\/]/))
  }
  for (const note of notes) ensureFolder(note.relativePath.split(/[\\/]/).slice(0, -1)).notes.push(note)
  return root
}

interface TreeProps {
  folder: NoteFolder
  collapsed: Set<string>
  currentNoteId: string | null
  selectedParentId: string
  busy: boolean
  onToggle(folder: NoteFolder): void
  onOpen(id: string): void
}

function NoteTree({ folder, collapsed, currentNoteId, selectedParentId, busy, onToggle, onOpen }: TreeProps) {
  return <ul className={styles.notes}>
    {[...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })).map((child) => {
      const expanded = !collapsed.has(child.path)
      return <li key={child.path}>
        <button type="button" className={styles.folderRow} disabled={busy} aria-label={`Carpeta: ${child.path}`} aria-expanded={expanded} data-selected={selectedParentId === child.id || undefined} title={child.path} onClick={() => onToggle(child)}>
          <Icon name="chevron" className={styles.disclosure} data-expanded={expanded} /><Icon name="open" /><span>{child.name}</span>
        </button>
        {expanded ? <NoteTree folder={child} collapsed={collapsed} currentNoteId={currentNoteId} selectedParentId={selectedParentId} busy={busy} onToggle={onToggle} onOpen={onOpen} /> : null}
      </li>
    })}
    {[...folder.notes].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })).map((note) => <li key={note.id}>
      <button type="button" className={styles.noteRow} disabled={busy} onClick={() => onOpen(note.id)} aria-label={`Abrir nota: ${note.relativePath}`} aria-current={currentNoteId === note.id ? 'page' : undefined} title={note.relativePath}>
        <span className={styles.disclosureSpace} /><Icon name="page" /><span>{note.name}</span>
      </button>
    </li>)}
  </ul>
}

export function Sidebar({ workspace, busy, brainOpen, recentWorkspaces, recentLoading, recentError, onRetryRecent, onOpenRecent, recentDocuments, onOpenRecentDocument, onPrintStyle, onChoose, onRefresh, onOpen, onCreate, onBrain, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [creationKind, setCreationKind] = useState<'folder' | 'note' | null>(null)
  const [creationName, setCreationName] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [creationError, setCreationError] = useState('')
  const [creating, setCreating] = useState(false)
  const submitting = useRef(false)
  const creationTrigger = useRef<HTMLButtonElement | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const formId = useId()
  const recentId = useId()
  const recentTrigger = useRef<HTMLButtonElement>(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const menuId = useId()
  const [menu, setMenu] = useState<'documents' | 'settings' | null>(null)
  const documentsTrigger = useRef<HTMLButtonElement>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const selectedParentId = workspace?.folders.some((folder) => folder.id === selectedFolderId) ? selectedFolderId! : workspace?.id ?? ''
  const parentId = workspace?.folders.some((folder) => folder.id === destinationId) ? destinationId : workspace?.id ?? ''
  const blocked = busy || creating
  const notes = useMemo(() => {
    const term = searchText(query.trim())
    return workspace?.notes.filter((note) => searchText(`${note.name} ${note.relativePath}`).includes(term)) ?? []
  }, [workspace, query])
  const tree = useMemo(() => buildTree(notes, workspace?.folders ?? [], workspace?.id ?? '', searchText(query.trim())), [notes, workspace, query])
  useEffect(() => { if (creationKind) nameInput.current?.focus() }, [creationKind])
  useEffect(() => { if (creationError && !creating && !busy) nameInput.current?.focus() }, [creationError, creating, busy])
  const closeMenu = () => {
    const trigger = menu === 'documents' ? documentsTrigger.current : settingsTrigger.current
    setMenu(null)
    trigger?.focus()
  }

  const selectFolder = (id: string) => {
    setSelectedFolderId(id)
    if (creationKind) setDestinationId(id)
  }
  const toggleFolder = (folder: NoteFolder) => {
    selectFolder(folder.id || workspace?.id || '')
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(folder.path)) next.delete(folder.path)
      else next.add(folder.path)
      return next
    })
  }
  const startCreation = (kind: 'folder' | 'note', trigger: HTMLButtonElement) => {
    creationTrigger.current = trigger
    setCreationKind(kind)
    setCreationName('')
    setCreationError('')
    setDestinationId(selectedParentId)
  }
  const cancelCreation = () => {
    setCreationKind(null)
    setCreationError('')
    creationTrigger.current?.focus()
  }
  const createEntry = async (event: FormEvent) => {
    event.preventDefault()
    if (!workspace || !creationKind || blocked || submitting.current) return
    const name = creationName.trim()
    if (!name) { setCreationError('Escribe un nombre.'); nameInput.current?.focus(); return }
    submitting.current = true
    setCreating(true)
    setCreationError('')
    try {
      if (await onCreate(parentId, name, creationKind)) {
        const parentPath = workspace.folders.find((folder) => folder.id === parentId)?.relativePath.replaceAll('\\', '/') ?? ''
        const newPath = creationKind === 'folder' ? (parentPath ? `${parentPath}/${name}` : name) : parentPath
        setCollapsed((previous) => {
          const next = new Set(previous)
          const segments = newPath.split('/')
          for (let count = 1; count <= segments.length; count++) next.delete(segments.slice(0, count).join('/'))
          return next
        })
        setQuery('')
        setCreationKind(null)
        if (creationKind === 'folder') requestAnimationFrame(() => creationTrigger.current?.focus())
      }
    } catch (failure) { setCreationError(failure instanceof Error ? failure.message : 'No se pudo crear. Vuelve a intentarlo.') }
    finally { submitting.current = false; setCreating(false) }
  }

  return <aside id="notes-sidebar" className={styles.sidebar} aria-label="Notas del cuaderno" aria-busy={busy}>
    <header className={styles.header}>
      <h2>Cuaderno</h2>
      <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Cerrar panel de notas" title="Cerrar panel de notas"><Icon name="close" /></button>
    </header>
    <section className={styles.menu} onKeyDown={(event) => {
      if (event.key === 'Escape' && menu) {
        event.preventDefault()
        event.stopPropagation()
        closeMenu()
      }
    }}>
      <div className={styles.menuBar} role="group" aria-label="Menú del panel">
        <button ref={documentsTrigger} type="button" aria-expanded={menu === 'documents'} aria-controls={`${menuId}-documents`} onClick={() => setMenu((value) => value === 'documents' ? null : 'documents')}>
          <Icon name="history" /><span>Documentos recientes</span><Icon name="chevron" className={styles.recentChevron} data-expanded={menu === 'documents'} />
        </button>
        <button ref={settingsTrigger} type="button" aria-expanded={menu === 'settings'} aria-controls={`${menuId}-settings`} onClick={() => setMenu((value) => value === 'settings' ? null : 'settings')}>
          <Icon name="settings" /><span>Configuraciones</span><Icon name="chevron" className={styles.recentChevron} data-expanded={menu === 'settings'} />
        </button>
      </div>
      {menu === 'documents' ? <RecentPanel id={`${menuId}-documents`} entries={recentDocuments.items} loading={recentDocuments.loading} error={recentDocuments.error} busy={busy} plural="documentos" singular="documento"
        emptyHint="Abre o guarda un documento para verlo aquí." openFailure="No se pudo abrir este documento. Comprueba que el archivo exista y esté disponible."
        fallbackFocus={documentsTrigger.current} onRetry={recentDocuments.reload} onOpen={onOpenRecentDocument} onOpened={() => setMenu(null)} /> : null}
      {menu === 'settings' ? <div id={`${menuId}-settings`} className={styles.recentPanel} role="region" aria-label="Configuraciones">
        <ul className={styles.recentList}>
          <li><button type="button" className={styles.recentRow} disabled={busy} onClick={onPrintStyle}>
            <span className={styles.recentName}><Icon name="print" />CSS de impresión</span>
            <span className={styles.settingHint}>Formato de títulos, párrafos y texto al imprimir</span>
          </button></li>
        </ul>
      </div> : null}
    </section>
    <section className={styles.recent} onKeyDown={(event) => {
      if (event.key === 'Escape' && recentOpen) {
        event.preventDefault()
        event.stopPropagation()
        setRecentOpen(false)
        recentTrigger.current?.focus()
      }
    }}>
      <button ref={recentTrigger} type="button" className={styles.recentToggle} aria-expanded={recentOpen} aria-controls={recentId} onClick={() => setRecentOpen((value) => !value)}>
        <Icon name="history" /><span>Cuadernos recientes</span><Icon name="chevron" className={styles.recentChevron} data-expanded={recentOpen} />
      </button>
      {recentOpen ? <RecentPanel id={recentId} entries={recentWorkspaces} loading={recentLoading} error={recentError} busy={blocked} plural="cuadernos" singular="cuaderno"
        emptyHint="Abre un cuaderno para verlo aquí." openFailure="No se pudo abrir este cuaderno. Comprueba que la carpeta exista y esté disponible."
        fallbackFocus={recentTrigger.current} onRetry={onRetryRecent} onOpen={onOpenRecent} onOpened={() => setRecentOpen(false)} /> : null}
    </section>
    {workspace ? <>
      <div className={styles.folder}>
        <button type="button" className={styles.folderName} title={workspace.name} aria-label={`Carpeta raíz: ${workspace.name}`} disabled={blocked} onClick={() => selectFolder(workspace.id)}><Icon name="open" />{workspace.name}</button>
        <div className={styles.folderActions}>
          <button type="button" data-choose-notebook="" onClick={onChoose} disabled={busy}>Cambiar cuaderno</button>
          <button type="button" className={styles.iconButton} onClick={onRefresh} disabled={busy} aria-label="Actualizar cuaderno" title="Actualizar cuaderno"><Icon name="refresh" /></button>
        </div>
      </div>
      <button type="button" className={styles.brain} onClick={onBrain} disabled={busy} aria-label="Cerebro" aria-pressed={brainOpen}><Icon name="brain" /><span>Cerebro</span><span className={styles.linkCount} aria-hidden="true">{workspace.links.length}</span></button>
      <div className={styles.createActions}>
        <button type="button" disabled={blocked} onClick={(event) => startCreation('folder', event.currentTarget)}><Icon name="folderPlus" />Nueva carpeta</button>
        <button type="button" disabled={blocked} onClick={(event) => startCreation('note', event.currentTarget)}><Icon name="notePlus" />Nueva nota .md</button>
      </div>
      {creationKind ? <form className={styles.createForm} aria-label={creationKind === 'folder' ? 'Crear carpeta' : 'Crear nota'} onSubmit={(event) => { void createEntry(event) }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!blocked) cancelCreation() } }}>
        <fieldset disabled={blocked}>
          <legend>{creationKind === 'folder' ? 'Crear carpeta' : 'Crear nota'}</legend>
          <label htmlFor={`${formId}-name`}>Nombre</label>
          <input ref={nameInput} id={`${formId}-name`} type="text" autoComplete="off" value={creationName} aria-invalid={Boolean(creationError)} aria-describedby={creationError ? `${formId}-error` : creationKind === 'note' ? `${formId}-hint` : undefined} onChange={(event) => { setCreationName(event.target.value); setCreationError('') }} />
          {creationKind === 'note' ? <p id={`${formId}-hint`} className={styles.formHint}>Se añadirá .md si falta.</p> : null}
          <label htmlFor={`${formId}-destination`}>Carpeta de destino</label>
          <select id={`${formId}-destination`} value={parentId} onChange={(event) => setDestinationId(event.target.value)}>
            <option value={workspace.id}>{workspace.name} (raíz)</option>
            {[...workspace.folders].sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'es', { numeric: true })).map((folder) => <option key={folder.id} value={folder.id}>{folder.relativePath}</option>)}
          </select>
          {creationError ? <p id={`${formId}-error`} className={styles.formError} role="alert">{creationError}</p> : null}
          <div className={styles.formActions}><button type="button" onClick={cancelCreation}>Cancelar</button><button type="submit">{creating ? 'Creando…' : 'Crear'}</button></div>
        </fieldset>
      </form> : null}
      <label className={styles.search}>
        <Icon name="search" />
        <input type="search" aria-label="Buscar notas" placeholder="Buscar notas…" value={query} onChange={(event) => { setQuery(event.target.value); setCollapsed(new Set()) }} />
      </label>
      <p className={styles.count} aria-live="polite">{query.trim() ? `${notes.length} de ${workspace.notes.length}` : workspace.notes.length} {workspace.notes.length === 1 ? 'nota' : 'notas'}</p>
      <nav className={styles.noteArea} aria-label="Árbol de archivos">
        {notes.length || tree.folders.size ? <NoteTree folder={tree} collapsed={collapsed} currentNoteId={workspace.currentNoteId} selectedParentId={selectedParentId} busy={blocked} onToggle={toggleFolder} onOpen={onOpen} /> : <p className={styles.empty}>{query.trim() ? 'No hay archivos ni carpetas que coincidan con la búsqueda.' : 'Este cuaderno está vacío. Crea una carpeta o una nota para empezar.'}</p>}
      </nav>
      {workspace.warnings.length ? <details className={styles.warnings}><summary>Avisos del cuaderno ({workspace.warnings.length})</summary><ul>{workspace.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
    </> : <div className={styles.welcome}>
      <Icon name="open" width="28" height="28" />
      <p>Abre una carpeta como cuaderno para explorar sus notas Markdown y sus conexiones.</p>
      <button type="button" onClick={onChoose} disabled={busy}>Abrir cuaderno</button>
    </div>}
  </aside>
}
