import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { maxDocumentBytes, type DocumentSnapshot, type DocumentResult } from '../../shared/documents'
import { defaultPageSettings, pageMarginMm, type PageSettings } from '../../shared/printing'
import type { WindowTheme } from '../../shared/window'
import type { RecentWorkspace, WorkspaceSnapshot } from '../../shared/workspace'
import { MarkdownEditor, emptySelection, type EditorController } from './editor'
import { EditorToolbar } from './Toolbar'
import { PageControls } from './PageControls'
import { Sidebar } from './Sidebar'
import { Icon } from './Icon'
import styles from './App.module.css'

const Brain = lazy(() => import('./Brain').then((module) => ({ default: module.Brain })))

// Textareas expose LF, while the main process preserves a file's CRLF on save.
function sameSource(left: string, right: string): boolean {
  return left === right || left.replace(/\r\n/g, '\n') === right.replace(/\r\n/g, '\n')
}

export function App() {
  const [document, setDocument] = useState<DocumentSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'open' | 'save' | 'print' | 'theme'>('save')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState(emptySelection)
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual')
  const [source, setSource] = useState('')
  const [pageSettings, setPageSettings] = useState<PageSettings>(defaultPageSettings)
  const [theme, setTheme] = useState<WindowTheme>('night')
  const [paperTheme, setPaperTheme] = useState<WindowTheme>('day')
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [recentError, setRecentError] = useState('')
  const recentRequest = useRef(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [brainOpen, setBrainOpen] = useState(false)
  const [focusDocument, setFocusDocument] = useState(false)
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 700)
  const sidebarButton = useRef<HTMLButtonElement>(null)
  const sidebarPanel = useRef<HTMLDivElement>(null)
  const sourceInput = useRef<HTMLTextAreaElement>(null)
  const modeRef = useRef(mode)
  const sourceRef = useRef('')
  const controller = useRef<EditorController | null>(null)
  const current = useRef<DocumentSnapshot | null>(null)
  const locked = useRef(false)
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const syncError = useRef('')
  const editSequence = useRef(0)

  const drainUpdates = useCallback(async () => {
    let last: Promise<unknown>
    do { last = pending.current; await last } while (last !== pending.current)
    return syncError.current || null
  }, [])

  const applyDocument = useCallback((next: DocumentSnapshot) => {
    let clean = true
    if (next.id !== current.current?.id) {
      setBrainOpen(false)
      controller.current = null
      setReady(false)
      setSelection(emptySelection)
      syncError.current = ''
      sourceRef.current = next.content
      setSource(next.content)
    } else {
      clean = modeRef.current === 'markdown' ? sameSource(sourceRef.current, next.savedContent) : controller.current?.markSaved(next.savedContent) ?? true
      if (modeRef.current === 'markdown' && clean && !next.dirty) {
        sourceRef.current = next.savedContent
        setSource(next.savedContent)
      }
    }
    current.current = next
    setDocument({ ...next, dirty: next.dirty || !clean })
    setError(next.updateError || syncError.current)
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = window.documents.onDocument(applyDocument)
    const unsubscribeBusy = window.documents.onBusy((value) => { locked.current = value; controller.current?.setEditable(!value); setBusy(value) })
    const unsubscribeError = window.documents.onError(setError)
    const unsubscribeFlush = window.documents.onFlush(async () => {
      locked.current = true
      controller.current?.setEditable(false)
      setBusy(true)
      return drainUpdates()
    })
    void window.documents.current().then((next) => { if (active) applyDocument(next) }).catch(() => setError('No se pudo cargar el documento. Reiniciar hiloo.'))
    return () => { active = false; unsubscribe(); unsubscribeBusy(); unsubscribeError(); unsubscribeFlush() }
  }, [applyDocument, drainUpdates])

  useEffect(() => { controller.current?.setEditable(!busy) }, [busy, ready])

  useEffect(() => {
    // Focus only after React removes the drawer's inert background. A frame
    // scheduled from the IPC response can run before that DOM commit.
    if (!focusDocument || busy || brainOpen || (sidebarOpen && narrow) || (mode === 'visual' && !ready)) return
    if (mode === 'markdown') sourceInput.current?.focus()
    else controller.current?.focus()
    setFocusDocument(false)
  }, [focusDocument, busy, brainOpen, sidebarOpen, narrow, mode, ready, document?.id])

  useEffect(() => {
    let active = true
    let received = false
    const unsubscribe = window.workspace.onChange((next) => {
      received = true
      if (active) setWorkspace(next)
    })
    void window.workspace.current().then((next) => {
      if (active && !received) setWorkspace(next)
    }).catch(() => { if (active) setError('No se pudo cargar el cuaderno. Vuelve a abrirlo.') })
    return () => { active = false; unsubscribe() }
  }, [])

  const loadRecentWorkspaces = useCallback(async () => {
    const request = ++recentRequest.current
    setRecentLoading(true)
    setRecentError('')
    try {
      const items = await window.workspace.recent()
      if (request === recentRequest.current) setRecentWorkspaces(items)
    } catch {
      if (request === recentRequest.current) setRecentError('No se pudieron cargar los cuadernos recientes. Vuelve a intentarlo.')
    } finally {
      if (request === recentRequest.current) setRecentLoading(false)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.workspace.onRecentChange((items) => {
      recentRequest.current++
      setRecentWorkspaces(items)
      setRecentLoading(false)
      setRecentError('')
    })
    void loadRecentWorkspaces()
    return () => { recentRequest.current++; unsubscribe() }
  }, [loadRecentWorkspaces])

  const closeSidebar = () => {
    setSidebarOpen(false)
    sidebarButton.current?.focus()
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!sidebarOpen) return
    const frame = requestAnimationFrame(() => {
      const panel = sidebarPanel.current
      const target = panel?.querySelector<HTMLInputElement>('input') ?? panel?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [sidebarOpen, workspace?.id])

  useEffect(() => {
    if (!sidebarOpen || !narrow) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSidebarOpen(false)
        sidebarButton.current?.focus()
      } else if (event.key === 'Tab') {
        const controls = Array.from(sidebarPanel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? []).filter((element) => element.offsetParent !== null)
        const first = controls[0]
        const last = controls.at(-1)
        const active = globalThis.document.activeElement
        if (first && last && (!sidebarPanel.current?.contains(active) || (event.shiftKey ? active === first : active === last))) {
          event.preventDefault()
          const target = event.shiftKey ? last : first
          target.focus()
        }
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [sidebarOpen, narrow])

  const runWorkspace = useCallback(async (action: 'choose' | 'refresh' | 'open' | 'create' | 'recent', noteId?: string, creation?: { name: string; kind: 'folder' | 'note' }): Promise<boolean> => {
    if (locked.current) return false
    locked.current = true
    setOperation('open')
    setBusy(true)
    controller.current?.setEditable(false)
    setError('')
    try {
      const failure = await drainUpdates()
      if (failure) throw new Error(failure)
      const result = action === 'open'
        ? await window.workspace.open(noteId ?? '')
        : action === 'recent'
          ? await window.workspace.openRecent(noteId ?? '')
          : action === 'create'
            ? await window.workspace.create(noteId ?? '', creation?.name ?? '', creation?.kind ?? 'note')
            : await window.workspace[action]()
      if (result.status === 'error') {
        if (action === 'create' || action === 'recent') throw new Error(result.message)
        setError(result.message)
        if (window.innerWidth <= 700) setSidebarOpen(false)
      }
      if (result.status !== 'ok') return false
      const opensNote = action === 'open' || (action === 'create' && creation?.kind === 'note')
      if (action === 'choose' || action === 'recent' || opensNote) setBrainOpen(false)
      if (opensNote) {
        if (window.innerWidth <= 700) setSidebarOpen(false)
        setFocusDocument(true)
      }
      return true
    } catch (failure) {
      if (action === 'create' || action === 'recent') throw failure
      setError(failure instanceof Error ? failure.message : 'No se pudo abrir el cuaderno.')
      if (window.innerWidth <= 700) setSidebarOpen(false)
      return false
    } finally {
      locked.current = false
      setBusy(false)
      controller.current?.setEditable(true)
    }
  }, [drainUpdates])

  const openBrain = async () => {
    if (await runWorkspace('refresh')) {
      setBrainOpen(true)
      if (window.innerWidth <= 700) setSidebarOpen(false)
    }
  }

  const run = useCallback(async (action: 'open' | 'save', copy = false) => {
    if (locked.current) return
    locked.current = true
    setOperation(action)
    setBusy(true)
    controller.current?.setEditable(false)
    setError('')
    try {
      const failure = await drainUpdates()
      if (failure) throw new Error(failure)
      const result: DocumentResult = action === 'open' ? await window.documents.open() : await window.documents.save(copy)
      if (result.status === 'error') setError(result.message)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo completar la operación.') }
    finally { locked.current = false; setBusy(false); controller.current?.setEditable(true) }
  }, [drainUpdates])

  const prepareVisual = useCallback(() => {
    if (!controller.current) { setError('La vista impresión no está disponible. El código permanece en Markdown; guarda tus cambios y vuelve a abrir el documento.'); return false }
    const problem = controller.current.replaceSource(sourceRef.current)
    if (problem) { setError(problem); return false }
    if (current.current) controller.current.markSaved(current.current.savedContent)
    setReady(true)
    controller.current.setEditable(!locked.current)
    return true
  }, [])

  const changeMode = (next: 'visual' | 'markdown') => {
    if (!locked.current) setBrainOpen(false)
    if (locked.current || next === modeRef.current) return
    if (next === 'visual' && !prepareVisual()) return
    modeRef.current = next
    setMode(next)
    setError('')
    requestAnimationFrame(() => next === 'markdown' ? sourceInput.current?.focus() : controller.current?.focus())
  }

  const changeTheme = async (next: WindowTheme) => {
    if (locked.current || next === theme) return
    locked.current = true
    setOperation('theme')
    setBusy(true)
    controller.current?.setEditable(false)
    try {
      await window.appearance.setTheme(next)
      globalThis.document.documentElement.dataset.theme = next
      setTheme(next)
    } catch { setError('No se pudo cambiar el tema. Inténtalo de nuevo.') }
    finally { locked.current = false; setBusy(false); controller.current?.setEditable(true) }
  }

  const print = useCallback(async () => {
    if (locked.current || !prepareVisual() || !controller.current) return
    locked.current = true
    setOperation('print')
    setBusy(true)
    controller.current.setEditable(false)
    setError('')
    try {
      const failure = await drainUpdates()
      if (failure) throw new Error(failure)
      // Relative image paths first resolve through IPC, then finish loading.
      const deadline = Date.now() + 10000
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Las fuentes todavía no terminan de cargar. Vuelve a imprimir.')), 10000)
        void globalThis.document.fonts.ready.then(() => { clearTimeout(timer); resolve() }, () => { clearTimeout(timer); reject(new Error('No se pudieron preparar las fuentes para imprimir.')) })
      })
      while (globalThis.document.querySelector('.document-image[data-loading="true"]')) {
        if (Date.now() >= deadline) throw new Error('Hay imágenes que todavía no terminan de cargar. Espera y vuelve a imprimir.')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const result = await window.documents.print(pageSettings)
      if (result.status === 'error') setError(result.message)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo imprimir el documento.') }
    finally { locked.current = false; setBusy(false); controller.current?.setEditable(true) }
  }, [drainUpdates, pageSettings, prepareVisual])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog')) return
      if (!event.ctrlKey || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (key !== 'o' && key !== 's' && key !== 'p') return
      event.preventDefault()
      if (key === 'o') void run('open')
      else if (key === 'p') void print()
      else if (controller.current || modeRef.current === 'markdown') void run('save', event.shiftKey)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [run, print])

  const changed = useCallback((markdown: string, clean: boolean) => {
    const active = current.current
    if (!active) return
    const content = clean ? active.savedContent : markdown
    sourceRef.current = content
    setSource(content)
    setError('')
    const sequence = ++editSequence.current
    setDocument((previous) => previous ? { ...previous, content, dirty: !clean } : previous)
    // Orden explícito: cada versión completa espera la respuesta de la anterior.
    pending.current = pending.current.then(() => window.documents.update(active.id, clean ? active.savedContent : markdown)).then((result) => {
      if (sequence !== editSequence.current) return
      const previousSyncError = syncError.current
      syncError.current = result.status === 'error' ? result.message : ''
      if (syncError.current) setError(syncError.current)
      else setError((previous) => previous === previousSyncError ? '' : previous)
      if (syncError.current) setDocument((previous) => previous ? { ...previous, dirty: true } : previous)
    }).catch(() => {
      if (sequence !== editSequence.current) return
      syncError.current = 'No se pudo sincronizar la edición. No cerrar la ventana.'
      setError(syncError.current)
      setDocument((previous) => previous ? { ...previous, dirty: true } : previous)
    })
  }, [])

  const status = busy ? (operation === 'theme' ? 'Cambiando tema…' : operation === 'print' ? 'Preparando impresión…' : operation === 'save' ? 'Guardando…' : 'Abriendo…') : document?.dirty ? 'Cambios sin guardar' : document?.hasFile ? 'Guardado' : 'Sin cambios'

  return <div className={styles.app}>
    <header className={styles.titlebar}>
      <button ref={sidebarButton} type="button" className={styles.sidebarToggle} aria-label={sidebarOpen ? 'Ocultar cuaderno' : 'Mostrar cuaderno'} title={sidebarOpen ? 'Ocultar cuaderno' : 'Mostrar cuaderno'} aria-expanded={sidebarOpen} aria-controls="notes-sidebar" onClick={() => setSidebarOpen((value) => !value)}><Icon name="sidebar" /></button>
      <span className={styles.filename}>{document?.name ?? 'hiloo'}</span>
      <span className={styles.status} role="status"><span className={styles.dot} data-dirty={document?.dirty || undefined} />{status}</span>
    </header>
    <style>{`@page { size: ${pageSettings.widthMm}mm ${pageSettings.heightMm}mm; margin: ${pageMarginMm}mm; background: #fff; } :root { --hiloo-print-height: ${pageSettings.heightMm - 2 * pageMarginMm}mm; }`}</style>
    <div className={styles.body}>
      {sidebarOpen ? <>
        <button type="button" className={styles.scrim} aria-label="Cerrar panel del cuaderno" onClick={closeSidebar} />
        <div ref={sidebarPanel} className={styles.sidebar} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeSidebar() } }}>
          <Sidebar key={workspace?.id ?? 'empty'} workspace={workspace} busy={busy} brainOpen={brainOpen} recentWorkspaces={recentWorkspaces} recentLoading={recentLoading} recentError={recentError} onRetryRecent={() => { void loadRecentWorkspaces() }} onOpenRecent={(id) => runWorkspace('recent', id)} onChoose={() => { void runWorkspace('choose') }} onRefresh={() => { void runWorkspace('refresh') }} onOpen={(id) => { void runWorkspace('open', id) }} onCreate={(parentId, name, kind) => runWorkspace('create', parentId, { name, kind })} onBrain={() => { void openBrain() }} onClose={closeSidebar} />
        </div>
      </> : null}
      <div className={styles.content} inert={sidebarOpen && narrow}>
        <div className={styles.documentControls} hidden={brainOpen}>
          <PageControls mode={mode} busy={busy} ready={Boolean(document)} canPrint={ready || (mode === 'markdown' && Boolean(controller.current))} settings={pageSettings} theme={theme} paperTheme={paperTheme} onPaperTheme={(next) => { if (!locked.current) setPaperTheme(next) }} onTheme={(next) => { void changeTheme(next) }} onMode={changeMode} onSettings={setPageSettings} onPrint={() => { void print() }} />
          <EditorToolbar key={document?.id} workspace={workspace} busy={busy} ready={ready && mode === 'visual'} canSave={ready || mode === 'markdown'} selection={selection}
            onOpen={() => { void run('open') }} onSave={(copy) => { void run('save', copy) }}
            onFormat={(action, level) => controller.current?.format(action, level)} onFocusEditor={() => controller.current?.focus()}
            onInsertTable={(rows, columns) => controller.current?.insertTable(rows, columns) ?? false}
            onTable={(action) => controller.current?.table(action) ?? false}
            onLink={(value) => controller.current?.setLink(value) ?? false} onRemoveLink={() => controller.current?.removeLink() ?? false}
            onImage={(value) => controller.current?.setImage(value) ?? false} onRemoveImage={() => controller.current?.removeImage() ?? false} />
        </div>
        {error ? <div role="alert" className={styles.error}>{error}<button aria-label="Cerrar aviso" onClick={() => setError('')}>Cerrar</button></div> : null}
        {brainOpen && workspace ? <div className={styles.brain}><Suspense fallback={<p className={styles.loading}>Preparando Cerebro…</p>}><Brain workspace={workspace} theme={theme} busy={busy} onOpen={(id) => { void runWorkspace('open', id) }} onClose={() => { setBrainOpen(false); setFocusDocument(true) }} /></Suspense></div> : null}
        <main className={styles.workspace} data-view={mode} data-paper-theme={paperTheme} data-brain-hidden={brainOpen || undefined} aria-busy={busy}>
          {document ? <>
            <div className={styles.visual} data-paper-theme={paperTheme} data-hidden={mode === 'markdown' || undefined}>
              <MarkdownEditor key={document.id} documentId={document.id} source={document.content} savedSource={document.savedContent} onReady={(next) => { controller.current = next; next.setEditable(!locked.current); setReady(next.visualReady()); if (modeRef.current === 'visual') next.focus(); else sourceInput.current?.focus() }} onChange={changed} onSelection={setSelection} onError={setError} />
            </div>
            <textarea key={document.id} ref={sourceInput} hidden={mode !== 'markdown'} className={styles.source} aria-label="Código Markdown" spellCheck={false} readOnly={busy} value={source} onChange={(event) => {
              if (locked.current) return
              const value = event.target.value
              if (new TextEncoder().encode(value).length > maxDocumentBytes) { setError('El documento supera el límite de 2 MB. La última edición no se aplicó.'); return }
              changed(value, sameSource(value, current.current?.savedContent ?? ''))
            }} />
          </> : null}
        </main>
      </div>
    </div>
  </div>
}
