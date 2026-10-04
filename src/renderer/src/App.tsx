import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { maxDocumentBytes, type DocumentSnapshot, type DocumentResult, type DocumentPreviewResult } from '../../shared/documents'
import { defaultPageSettings, pageMarginMm, type PageSettings } from '../../shared/printing'
import type { WindowTheme } from '../../shared/window'
import type { WorkspaceSnapshot } from '../../shared/workspace'
import { scopedPrintStyle } from '../../shared/settings'
import { MarkdownEditor, emptySelection, type EditorController } from './editor'
import { EditorToolbar } from './Toolbar'
import { PageControls } from './PageControls'
import { PrintStyleDialog } from './PrintStyleDialog'
import { Sidebar } from './Sidebar'
import { ZoomBar, clampZoom, zoomStep } from './ZoomBar'
import { useRecentList } from './use-recent-list'
import { Icon } from './Icon'
import styles from './App.module.css'

const Brain = lazy(() => import('./Brain').then((module) => ({ default: module.Brain })))
const PrintPreview = lazy(() => import('./PrintPreview').then((module) => ({ default: module.PrintPreview })))

// Stable references for useRecentList.
const loadRecentWorkspaces = () => window.workspace.recent()
const subscribeRecentWorkspaces: typeof window.workspace.onRecentChange = (callback) => window.workspace.onRecentChange(callback)
const loadRecentDocuments = () => window.documents.recent()
const subscribeRecentDocuments: typeof window.documents.onRecentChange = (callback) => window.documents.onRecentChange(callback)

// Width of the visual sheet at 100 %, including its side padding.
const documentWidthPx = 860
const sourceFontPx = 14

// Textareas expose LF, while the main process preserves a file's CRLF on save.
function sameSource(left: string, right: string): boolean {
  return left === right || left.replace(/\r\n/g, '\n') === right.replace(/\r\n/g, '\n')
}

export function App() {
  const [document, setDocument] = useState<DocumentSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [printPreview, setPrintPreview] = useState<{ result: Extract<DocumentPreviewResult, { status: 'ok' }>; settings: PageSettings } | null>(null)
  const [printing, setPrinting] = useState(false)
  const printFocus = useRef<HTMLElement | null>(null)
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
  const recentWorkspaces = useRecentList(loadRecentWorkspaces, subscribeRecentWorkspaces, 'No se pudieron cargar los cuadernos recientes. Vuelve a intentarlo.')
  const recentDocuments = useRecentList(loadRecentDocuments, subscribeRecentDocuments, 'No se pudieron cargar los documentos recientes. Vuelve a intentarlo.')
  const [zoom, setZoom] = useState(100)
  const [fitZoom, setFitZoom] = useState(false)
  const workspaceArea = useRef<HTMLElement>(null)
  const [printStyle, setPrintStyle] = useState('')
  const [printStyleOpen, setPrintStyleOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [brainOpen, setBrainOpen] = useState(false)
  const [focusDocument, setFocusDocument] = useState(false)
  // Element focused when a document-focus request began; another focused control means the user moved on.
  const focusOrigin = useRef<Element | null>(null)
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 700)
  const sidebarButton = useRef<HTMLButtonElement>(null)
  const sidebarPanel = useRef<HTMLDivElement>(null)
  const sourceInput = useRef<HTMLTextAreaElement>(null)
  const modeRef = useRef(mode)
  const sourceRef = useRef('')
  const controller = useRef<EditorController | null>(null)
  const current = useRef<DocumentSnapshot | null>(null)
  const locked = useRef(false)
  const printSession = useRef(false)
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
    const unsubscribeBusy = window.documents.onBusy((value) => {
      const active = value || printSession.current
      locked.current = active
      controller.current?.setEditable(!active)
      setBusy(active)
    })
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
    const active = globalThis.document.activeElement
    const movedOn = active && active !== globalThis.document.body && active !== focusOrigin.current && !workspaceArea.current?.contains(active)
    if (!movedOn) {
      if (mode === 'markdown') sourceInput.current?.focus()
      else controller.current?.focus()
    }
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

  useEffect(() => {
    let active = true
    void window.settings.printStyle().then((css) => { if (active) setPrintStyle(css) }).catch(() => {})
    return () => { active = false }
  }, [])

  const savePrintStyle = async (css: string): Promise<string | null> => {
    try {
      const result = await window.settings.setPrintStyle(css)
      if (result.status === 'error') return result.message
      setPrintStyle(css)
      return null
    } catch { return 'No se pudo guardar el CSS de impresión. Vuelve a intentarlo.' }
  }

  const changeZoom = useCallback((next: number) => {
    setFitZoom(false)
    setZoom(clampZoom(next))
  }, [])

  useEffect(() => {
    const area = workspaceArea.current
    if (!fitZoom || !area) return
    // The sheet already reflows below its full width, so fitting never shrinks it.
    const fit = () => setZoom(clampZoom(Math.max(100, Math.floor(area.clientWidth / documentWidthPx * 100))))
    const observer = new ResizeObserver(fit)
    observer.observe(area)
    fit()
    return () => observer.disconnect()
  }, [fitZoom])

  useEffect(() => {
    const area = workspaceArea.current
    if (!area) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return
      event.preventDefault()
      setFitZoom(false)
      setZoom((value) => clampZoom(event.deltaY < 0 ? Math.floor(value / zoomStep + 1) * zoomStep : Math.ceil(value / zoomStep - 1) * zoomStep))
    }
    area.addEventListener('wheel', wheel, { passive: false })
    return () => area.removeEventListener('wheel', wheel)
  }, [])

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
      if (event.target instanceof Element && event.target.closest('dialog')) return
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

  const runWorkspace = useCallback(async (action: 'choose' | 'refresh' | 'open' | 'create' | 'recent' | 'recent-document', noteId?: string, creation?: { name: string; kind: 'folder' | 'note' }): Promise<boolean> => {
    if (locked.current) return false
    locked.current = true
    focusOrigin.current = globalThis.document.activeElement
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
          : action === 'recent-document'
            ? await window.documents.openRecent(noteId ?? '')
          : action === 'create'
            ? await window.workspace.create(noteId ?? '', creation?.name ?? '', creation?.kind ?? 'note')
            : await window.workspace[action]()
      if (result.status === 'error') {
        if (action === 'create' || action === 'recent' || action === 'recent-document') throw new Error(result.message)
        setError(result.message)
        if (window.innerWidth <= 700) setSidebarOpen(false)
      }
      if (result.status !== 'ok') return false
      const opensNote = action === 'open' || action === 'recent-document' || (action === 'create' && creation?.kind === 'note')
      if (action === 'choose' || action === 'recent' || opensNote) setBrainOpen(false)
      if (opensNote) {
        if (window.innerWidth <= 700) setSidebarOpen(false)
        setFocusDocument(true)
      }
      return true
    } catch (failure) {
      if (action === 'create' || action === 'recent' || action === 'recent-document') throw failure
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
    printSession.current = true
    locked.current = true
    setOperation('print')
    setBusy(true)
    controller.current.setEditable(false)
    setError('')
    printFocus.current = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null
    let previewOpened = false
    try {
      const failure = await drainUpdates()
      if (failure) throw new Error(failure)
      // Relative image paths first resolve through IPC, then finish loading.
      const deadline = Date.now() + 10000
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Las fuentes todavía no terminan de cargar. Vuelve a imprimir.')), 10000)
        void globalThis.document.fonts.ready.then(() => { clearTimeout(timer); resolve() }, () => { clearTimeout(timer); reject(new Error('No se pudieron preparar las fuentes para imprimir.')) })
      })
      while (globalThis.document.querySelector('.document-image[data-loading="true"], .document-mermaid[data-loading="true"]')) {
        if (Date.now() >= deadline) throw new Error('Hay imágenes o diagramas que todavía no terminan de cargar. Espera y vuelve a imprimir.')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const result = await window.documents.printPreview(pageSettings)
      if (result.status === 'error') setError(result.message)
      else if (result.status === 'ok') {
        previewOpened = true
        setPrintPreview({ result, settings: pageSettings })
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo imprimir el documento.') }
    finally { if (!previewOpened) { printSession.current = false; locked.current = false; setBusy(false); controller.current?.setEditable(true) } }
  }, [drainUpdates, pageSettings, prepareVisual])

  const closePrintPreview = () => {
    setPrintPreview(null)
    printSession.current = false
    locked.current = false
    setBusy(false)
    controller.current?.setEditable(true)
    requestAnimationFrame(() => printFocus.current?.isConnected ? printFocus.current.focus() : controller.current?.focus())
  }

  const confirmPrint = async () => {
    if (!printPreview || printing) return
    setPrinting(true)
    try {
      const { result, settings } = printPreview
      const printed = await window.documents.print(settings, { documentId: result.documentId, revision: result.revision })
      if (printed.status === 'error') setError(printed.message)
    } catch { setError('No se pudo imprimir el documento.') }
    finally { setPrinting(false); closePrintPreview() }
  }

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog')) return
      if (!event.ctrlKey || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (['+', '=', '-', '0'].includes(key)) {
        event.preventDefault()
        setFitZoom(false)
        setZoom((value) => key === '0' ? 100 : clampZoom(key === '-' ? Math.ceil(value / zoomStep - 1) * zoomStep : Math.floor(value / zoomStep + 1) * zoomStep))
        return
      }
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
    {printPreview ? <Suspense fallback={null}><PrintPreview pdf={printPreview.result.pdf} printing={printing} onPrint={() => { void confirmPrint() }} onClose={closePrintPreview} /></Suspense> : null}
    <header className={styles.titlebar}>
      <button ref={sidebarButton} type="button" className={styles.sidebarToggle} aria-label={sidebarOpen ? 'Ocultar cuaderno' : 'Mostrar cuaderno'} title={sidebarOpen ? 'Ocultar cuaderno' : 'Mostrar cuaderno'} aria-expanded={sidebarOpen} aria-controls="notes-sidebar" onClick={() => setSidebarOpen((value) => !value)}><Icon name="sidebar" /></button>
      <span className={styles.filename}>{document?.name ?? 'hiloo'}</span>
      <span className={styles.status} role="status"><span className={styles.dot} data-dirty={document?.dirty || undefined} />{status}</span>
    </header>
    <style>{`@page { size: ${pageSettings.widthMm}mm ${pageSettings.heightMm}mm; margin: ${pageMarginMm}mm; background: #fff; } :root { --hiloo-print-height: ${pageSettings.heightMm - 2 * pageMarginMm}mm; }`}</style>
    {printStyle.trim() ? <style data-print-style="">{scopedPrintStyle(printStyle)}</style> : null}
    {printStyleOpen ? <PrintStyleDialog value={printStyle} onSave={savePrintStyle} onClose={() => setPrintStyleOpen(false)} /> : null}
    <div className={styles.body}>
      {sidebarOpen ? <>
        <button type="button" className={styles.scrim} aria-label="Cerrar panel del cuaderno" onClick={closeSidebar} />
        <div ref={sidebarPanel} className={styles.sidebar} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeSidebar() } }}>
          <Sidebar key={workspace?.id ?? 'empty'} workspace={workspace} busy={busy} brainOpen={brainOpen} recentWorkspaces={recentWorkspaces.items} recentLoading={recentWorkspaces.loading} recentError={recentWorkspaces.error} onRetryRecent={recentWorkspaces.reload} onOpenRecent={(id) => runWorkspace('recent', id)} recentDocuments={recentDocuments} onOpenRecentDocument={(id) => runWorkspace('recent-document', id)} onPrintStyle={() => setPrintStyleOpen(true)} onChoose={() => { void runWorkspace('choose') }} onRefresh={() => { void runWorkspace('refresh') }} onOpen={(id) => { void runWorkspace('open', id) }} onCreate={(parentId, name, kind) => runWorkspace('create', parentId, { name, kind })} onBrain={() => { void openBrain() }} onClose={closeSidebar} />
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
        {brainOpen && workspace ? <div className={styles.brain}><Suspense fallback={<p className={styles.loading}>Preparando Cerebro…</p>}><Brain workspace={workspace} theme={theme} busy={busy} onOpen={(id) => { void runWorkspace('open', id) }} onClose={() => { focusOrigin.current = globalThis.document.activeElement; setBrainOpen(false); setFocusDocument(true) }} /></Suspense></div> : null}
        <main ref={workspaceArea} className={styles.workspace} data-view={mode} data-paper-theme={paperTheme} data-brain-hidden={brainOpen || undefined} aria-busy={busy}>
          {document ? <>
            <div className={styles.visual} data-paper-theme={paperTheme} data-hidden={mode === 'markdown' || undefined}>
              <div className={styles.zoom} style={{ zoom: zoom / 100 }}><MarkdownEditor key={document.id} documentId={document.id} source={document.content} savedSource={document.savedContent} onReady={(next) => { controller.current = next; next.setEditable(!locked.current); setReady(next.visualReady()); if (modeRef.current === 'visual') next.focus(); else sourceInput.current?.focus() }} onChange={changed} onSelection={setSelection} onError={setError} /></div>
            </div>
            <textarea key={document.id} ref={sourceInput} hidden={mode !== 'markdown'} className={styles.source} style={{ fontSize: `${sourceFontPx * zoom / 100}px` }} aria-label="Código Markdown" spellCheck={false} readOnly={busy} value={source} onChange={(event) => {
              if (locked.current) return
              const value = event.target.value
              if (new TextEncoder().encode(value).length > maxDocumentBytes) { setError('El documento supera el límite de 2 MB. La última edición no se aplicó.'); return }
              changed(value, sameSource(value, current.current?.savedContent ?? ''))
            }} />
          </> : null}
        </main>
        {document && !brainOpen ? <ZoomBar zoom={zoom} fit={fitZoom} disabled={!ready && mode === 'visual'} onZoom={changeZoom} onFit={() => setFitZoom(true)} /> : null}
      </div>
    </div>
  </div>
}
