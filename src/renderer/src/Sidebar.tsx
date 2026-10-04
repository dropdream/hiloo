import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { RecentWorkspace, WorkspaceNote, WorkspaceSnapshot } from '../../shared/workspace'
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
  onChoose(): void
  onRefresh(): void
  onOpen(id: string): void
  onCreate(parentId: string, name: string, kind: 'folder' | 'note'): Promise<boolean>
  onBrain(): void
  onClose(): void
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

export function Sidebar({ workspace, busy, brainOpen, recentWorkspaces, recentLoading, recentError, onRetryRecent, onOpenRecent, onChoose, onRefresh, onOpen, onCreate, onBrain, onClose }: Props) {
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
  const recentSelection = useRef<HTMLButtonElement | null>(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recentOpenError, setRecentOpenError] = useState('')
  const [restoreRecentFocus, setRestoreRecentFocus] = useState(false)
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
  useEffect(() => {
    if (!restoreRecentFocus || busy) return
    if (recentOpen) recentSelection.current?.focus()
    setRestoreRecentFocus(false)
  }, [restoreRecentFocus, busy, recentOpen])

  const openRecent = async (id: string, trigger: HTMLButtonElement) => {
    recentSelection.current = trigger
    setRecentOpenError('')
    try {
      if (await onOpenRecent(id)) setRecentOpen(false)
      else setRestoreRecentFocus(true)
    } catch (failure) {
      setRecentOpenError(failure instanceof Error ? failure.message : 'No se pudo abrir este cuaderno. Comprueba que la carpeta exista y esté disponible.')
      recentSelection.current = recentTrigger.current
      setRestoreRecentFocus(true)
    }
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
      {recentOpen && recentOpenError ? <p className={styles.recentMessage} role="alert">{recentOpenError}</p> : null}
      {recentOpen ? <div id={recentId} className={styles.recentPanel} role="region" aria-label="Lista de cuadernos recientes" aria-busy={recentLoading}>
        {recentLoading ? <p className={styles.recentMessage} role="status">Cargando cuadernos recientes…</p> : recentError ? <div className={styles.recentMessage}>
          <p role="alert">{recentError}</p><button type="button" className={styles.retryRecent} onClick={onRetryRecent}>Reintentar</button>
        </div> : recentWorkspaces.length ? <ul className={styles.recentList}>
          {recentWorkspaces.map((item) => <li key={item.id}>
            <button type="button" className={styles.recentRow} disabled={blocked || item.current} aria-label={`Abrir cuaderno reciente: ${item.path}`} aria-current={item.current ? 'true' : undefined} title={item.path} onClick={(event) => { void openRecent(item.id, event.currentTarget) }}>
              <span className={styles.recentName}>{item.name}{item.current ? <span className={styles.recentCurrent}>Actual</span> : null}</span>
              <span className={styles.recentPath}>{item.path}</span>
            </button>
          </li>)}
        </ul> : <p className={styles.recentMessage}>Aún no hay cuadernos recientes. Abre un cuaderno para verlo aquí.</p>}
      </div> : null}
    </section>
    {workspace ? <>
      <div className={styles.folder}>
        <button type="button" className={styles.folderName} title={workspace.name} aria-label={`Carpeta raíz: ${workspace.name}`} disabled={blocked} onClick={() => selectFolder(workspace.id)}><Icon name="open" />{workspace.name}</button>
        <div className={styles.folderActions}>
          <button type="button" onClick={onChoose} disabled={busy}>Cambiar cuaderno</button>
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
