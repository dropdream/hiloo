import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentResult } from '../../shared/documents'
import { defaultPageSettings, pageMarginMm, type PageSettings } from '../../shared/printing'
import type { WindowTheme } from '../../shared/window'
import type { WorkspaceSnapshot } from '../../shared/workspace'
import type { NotebookIndexUsage } from '../../shared/notebook-index'
import { scopedPrintStyle } from '../../shared/settings'
import { MarkdownEditor } from './editor'
import { useDocumentSession } from './use-document-session'
import { useDocumentPrint } from './use-document-print'
import { EditorToolbar } from './Toolbar'
import { PageControls } from './PageControls'
import { PrintStyleDialog } from './PrintStyleDialog'
import { NotebookIndexDialog } from './NotebookIndexDialog'
import { Sidebar } from './Sidebar'
import { ZoomBar, clampZoom, zoomStep } from './ZoomBar'
import { useRecentList } from './use-recent-list'
import { Icon } from './Icon'
import styles from './App.module.css'

const Brain = lazy(() => import('./Brain').then((module) => ({ default: module.Brain })))
const PrintPreview = lazy(() => import('./PrintPreview').then((module) => ({ default: module.PrintPreview })))

const loadRecentWorkspaces = () => window.workspace.recent()
const subscribeRecentWorkspaces: typeof window.workspace.onRecentChange = (callback) =>
  window.workspace.onRecentChange(callback)
const loadRecentDocuments = () => window.documents.recent()
const subscribeRecentDocuments: typeof window.documents.onRecentChange = (callback) =>
  window.documents.onRecentChange(callback)

// Ancho de la hoja al 100 %, incluido su relleno lateral.
const documentWidthPx = 860
const sourceFontPx = 14

type WorkspaceAction =
  | { type: 'choose' | 'refresh' }
  | { type: 'open' | 'recent' | 'recent-document'; id: string }
  | { type: 'create'; parentId: string; name: string; kind: 'folder' | 'note' }
  | { type: 'index'; id: string; usage: NotebookIndexUsage }

export function App() {
  const [pageSettings, setPageSettings] = useState<PageSettings>(defaultPageSettings)
  const [theme, setTheme] = useState<WindowTheme>('night')
  const [paperTheme, setPaperTheme] = useState<WindowTheme>('day')
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const recentWorkspaces = useRecentList(
    loadRecentWorkspaces,
    subscribeRecentWorkspaces,
    'No se pudieron cargar los cuadernos recientes. Vuelve a intentarlo.'
  )
  const recentDocuments = useRecentList(
    loadRecentDocuments,
    subscribeRecentDocuments,
    'No se pudieron cargar los documentos recientes. Vuelve a intentarlo.'
  )
  const [zoom, setZoom] = useState(100)
  const [fitZoom, setFitZoom] = useState(false)
  const workspaceArea = useRef<HTMLElement>(null)
  const [printStyle, setPrintStyle] = useState('')
  const [printStyleOpen, setPrintStyleOpen] = useState(false)
  const [indexPrompt, setIndexPrompt] = useState<{ id: string; name: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [brainOpen, setBrainOpen] = useState(false)
  const [focusDocument, setFocusDocument] = useState(false)
  // Otro control enfocado cancela el retorno pendiente al documento.
  const focusOrigin = useRef<Element | null>(null)
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 700)
  const sidebarButton = useRef<HTMLButtonElement>(null)
  const sidebarPanel = useRef<HTMLDivElement>(null)
  const onNewDocument = useCallback(() => setBrainOpen(false), [])
  const session = useDocumentSession(onNewDocument)
  const {
    document,
    busy,
    operation,
    ready,
    error,
    setError,
    selection,
    setSelection,
    mode,
    setMode,
    modeRef,
    source,
    sourceInput,
    controller,
    locked,
    beginOperation,
    endOperation,
    drainUpdates,
    run,
    prepareVisual,
    changed,
    editorReady,
    changeSource
  } = session
  const { printPreview, printing, print, closePrintPreview, confirmPrint } = useDocumentPrint(session, pageSettings)

  useEffect(() => {
    // Enfoca después de que React retire el fondo inerte del panel.
    if (!focusDocument || busy || brainOpen || indexPrompt || (sidebarOpen && narrow) || (mode === 'visual' && !ready))
      return
    const active = globalThis.document.activeElement
    const movedOn =
      active &&
      active !== globalThis.document.body &&
      active !== focusOrigin.current &&
      !workspaceArea.current?.contains(active)
    if (!movedOn) {
      if (mode === 'markdown') sourceInput.current?.focus()
      else controller.current?.focus()
    }
    setFocusDocument(false)
  }, [focusDocument, busy, brainOpen, indexPrompt, sidebarOpen, narrow, mode, ready, document?.id])

  useEffect(() => {
    let active = true
    let received = false
    const unsubscribe = window.workspace.onChange((next) => {
      received = true
      if (active) setWorkspace(next)
    })
    void window.workspace
      .current()
      .then((next) => {
        if (active && !received) setWorkspace(next)
      })
      .catch(() => {
        if (active) setError('No se pudo cargar el cuaderno. Vuelve a abrirlo.')
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let active = true
    void window.settings
      .printStyle()
      .then((css) => {
        if (active) setPrintStyle(css)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const savePrintStyle = async (css: string): Promise<string | null> => {
    try {
      const result = await window.settings.setPrintStyle(css)
      if (result.status === 'error') return result.message
      setPrintStyle(css)
      return null
    } catch {
      return 'No se pudo guardar el CSS de impresión. Vuelve a intentarlo.'
    }
  }

  const changeZoom = useCallback((next: number) => {
    setFitZoom(false)
    setZoom(clampZoom(next))
  }, [])

  useEffect(() => {
    const area = workspaceArea.current
    if (!fitZoom || !area) return
    // La hoja ya se adapta al ancho disponible; ajustar no la reduce.
    const fit = () => setZoom(clampZoom(Math.max(100, Math.floor((area.clientWidth / documentWidthPx) * 100))))
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
      setZoom((value) =>
        clampZoom(
          event.deltaY < 0 ? Math.floor(value / zoomStep + 1) * zoomStep : Math.ceil(value / zoomStep - 1) * zoomStep
        )
      )
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
      const target =
        panel?.querySelector<HTMLInputElement>('input') ??
        panel?.querySelector<HTMLButtonElement>('button:not(:disabled)')
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
        const controls = Array.from(
          sidebarPanel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]'
          ) ?? []
        ).filter((element) => element.offsetParent !== null)
        const first = controls[0]
        const last = controls.at(-1)
        const active = globalThis.document.activeElement
        if (
          first &&
          last &&
          (!sidebarPanel.current?.contains(active) || (event.shiftKey ? active === first : active === last))
        ) {
          event.preventDefault()
          const target = event.shiftKey ? last : first
          target.focus()
        }
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [sidebarOpen, narrow])

  const runWorkspace = useCallback(
    async (request: WorkspaceAction): Promise<boolean> => {
      if (!beginOperation('open')) return false
      const action = request.type
      focusOrigin.current = globalThis.document.activeElement
      try {
        const failure = await drainUpdates()
        if (failure) throw new Error(failure)
        let result: DocumentResult
        switch (request.type) {
          case 'index':
            result = await window.workspace.createIndex(request.id, request.usage)
            break
          case 'open':
            result = await window.workspace.open(request.id)
            break
          case 'recent':
            result = await window.workspace.openRecent(request.id)
            break
          case 'recent-document':
            result = await window.documents.openRecent(request.id)
            break
          case 'create':
            result = await window.workspace.create(request.parentId, request.name, request.kind)
            break
          case 'choose':
            result = await window.workspace.choose()
            break
          case 'refresh':
            result = await window.workspace.refresh()
            break
        }
        if (result.status === 'error') {
          if (action === 'create' || action === 'recent' || action === 'recent-document' || action === 'index')
            throw new Error(result.message)
          setError(result.message)
          if (window.innerWidth <= 700) setSidebarOpen(false)
        }
        if (result.status !== 'ok') return false
        const opensNote =
          action === 'open' ||
          action === 'recent-document' ||
          action === 'index' ||
          (request.type === 'create' && request.kind === 'note')
        if (action === 'choose' || action === 'recent' || opensNote) setBrainOpen(false)
        if (action === 'choose' || action === 'recent') {
          // Solo la elección explícita de un cuaderno ofrece crear su índice.
          const chosen = await window.workspace.current().catch(() => null)
          if (chosen && !chosen.hasIndex) setIndexPrompt({ id: chosen.id, name: chosen.name })
        }
        if (opensNote) {
          if (window.innerWidth <= 700) setSidebarOpen(false)
          setFocusDocument(true)
        }
        return true
      } catch (failure) {
        if (action === 'create' || action === 'recent' || action === 'recent-document' || action === 'index')
          throw failure
        setError(failure instanceof Error ? failure.message : 'No se pudo abrir el cuaderno.')
        if (window.innerWidth <= 700) setSidebarOpen(false)
        return false
      } finally {
        endOperation()
      }
    },
    [beginOperation, drainUpdates, endOperation]
  )

  const createIndex = useCallback(
    async (usage: NotebookIndexUsage): Promise<string | null> => {
      if (!indexPrompt) return 'El cuaderno ya no está disponible. Vuelve a abrirlo.'
      try {
        return (await runWorkspace({ type: 'index', id: indexPrompt.id, usage }))
          ? null
          : 'No se creó el índice. Revisa los cambios pendientes y vuelve a intentarlo.'
      } catch (failure) {
        return failure instanceof Error ? failure.message : 'No se pudo crear el índice. Vuelve a intentarlo.'
      }
    },
    [indexPrompt, runWorkspace]
  )

  const closeIndexPrompt = useCallback(() => setIndexPrompt(null), [])
  const indexFallbackFocus = useCallback(() => {
    // Al cambiar de cuaderno, el panel reemplaza el control que abrió el diálogo.
    const target =
      sidebarPanel.current?.querySelector<HTMLButtonElement>('[data-choose-notebook]:not(:disabled)') ??
      sidebarButton.current
    target?.focus()
  }, [])

  const openBrain = async () => {
    if (await runWorkspace({ type: 'refresh' })) {
      setBrainOpen(true)
      if (window.innerWidth <= 700) setSidebarOpen(false)
    }
  }

  const changeMode = (next: 'visual' | 'markdown') => {
    if (!locked.current) setBrainOpen(false)
    if (locked.current || next === modeRef.current) return
    if (next === 'visual' && !prepareVisual()) return
    modeRef.current = next
    setMode(next)
    setError('')
    requestAnimationFrame(() => (next === 'markdown' ? sourceInput.current?.focus() : controller.current?.focus()))
  }

  const changeTheme = async (next: WindowTheme) => {
    if (next === theme || !beginOperation('theme', false)) return
    try {
      await window.appearance.setTheme(next)
      globalThis.document.documentElement.dataset.theme = next
      setTheme(next)
    } catch {
      setError('No se pudo cambiar el tema. Inténtalo de nuevo.')
    } finally {
      endOperation()
    }
  }

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog')) return
      if (!event.ctrlKey || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (['+', '=', '-', '0'].includes(key)) {
        event.preventDefault()
        setFitZoom(false)
        setZoom((value) =>
          key === '0'
            ? 100
            : clampZoom(
                key === '-' ? Math.ceil(value / zoomStep - 1) * zoomStep : Math.floor(value / zoomStep + 1) * zoomStep
              )
        )
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

  const status = busy
    ? operation === 'theme'
      ? 'Cambiando tema…'
      : operation === 'print'
        ? 'Preparando impresión…'
        : operation === 'save'
          ? 'Guardando…'
          : 'Abriendo…'
    : document?.dirty
      ? 'Cambios sin guardar'
      : document?.hasFile
        ? 'Guardado'
        : 'Sin cambios'

  return (
    <div className={styles.app}>
      {printPreview ? (
        <Suspense fallback={null}>
          <PrintPreview
            pdf={printPreview.result.pdf}
            printing={printing}
            onPrint={() => void confirmPrint()}
            onClose={closePrintPreview}
          />
        </Suspense>
      ) : null}
      <header className={styles.titlebar}>
        <button
          ref={sidebarButton}
          type="button"
          className={styles.sidebarToggle}
          aria-label={sidebarOpen ? 'Ocultar cuaderno' : 'Mostrar cuaderno'}
          title={sidebarOpen ? 'Ocultar cuaderno' : 'Mostrar cuaderno'}
          aria-expanded={sidebarOpen}
          aria-controls="notes-sidebar"
          onClick={() => setSidebarOpen((value) => !value)}
        >
          <Icon name="sidebar" />
        </button>
        <span className={styles.filename}>{document?.name ?? 'hiloo'}</span>
        <span className={styles.status} role="status">
          <span className={styles.dot} data-dirty={document?.dirty || undefined} />
          {status}
        </span>
      </header>
      <style>{`@page {
        size: ${pageSettings.widthMm}mm ${pageSettings.heightMm}mm;
        margin: ${pageMarginMm}mm;
        background: #fff;
      } :root { --hiloo-print-height: ${pageSettings.heightMm - 2 * pageMarginMm}mm; }`}</style>
      {printStyle.trim() ? <style data-print-style="">{scopedPrintStyle(printStyle)}</style> : null}
      {indexPrompt ? (
        <NotebookIndexDialog
          key={indexPrompt.id}
          name={indexPrompt.name}
          onChoose={createIndex}
          onDismiss={closeIndexPrompt}
          onFallbackFocus={indexFallbackFocus}
        />
      ) : null}
      {printStyleOpen ? (
        <PrintStyleDialog value={printStyle} onSave={savePrintStyle} onClose={() => setPrintStyleOpen(false)} />
      ) : null}
      <div className={styles.body}>
        {sidebarOpen ? (
          <>
            <button
              type="button"
              className={styles.scrim}
              aria-label="Cerrar panel del cuaderno"
              onClick={closeSidebar}
            />
            <div
              ref={sidebarPanel}
              className={styles.sidebar}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeSidebar()
                }
              }}
            >
              <Sidebar
                key={workspace?.id ?? 'empty'}
                workspace={workspace}
                busy={busy}
                brainOpen={brainOpen}
                recentWorkspaces={recentWorkspaces.items}
                recentLoading={recentWorkspaces.loading}
                recentError={recentWorkspaces.error}
                onRetryRecent={recentWorkspaces.reload}
                onOpenRecent={(id) => runWorkspace({ type: 'recent', id })}
                recentDocuments={recentDocuments}
                onOpenRecentDocument={(id) => runWorkspace({ type: 'recent-document', id })}
                onPrintStyle={() => setPrintStyleOpen(true)}
                onChoose={() => void runWorkspace({ type: 'choose' })}
                onRefresh={() => void runWorkspace({ type: 'refresh' })}
                onOpen={(id) => void runWorkspace({ type: 'open', id })}
                onCreate={(parentId, name, kind) => runWorkspace({ type: 'create', parentId, name, kind })}
                onBrain={() => void openBrain()}
                onClose={closeSidebar}
              />
            </div>
          </>
        ) : null}
        <div className={styles.content} inert={sidebarOpen && narrow}>
          <div className={styles.documentControls} hidden={brainOpen}>
            <PageControls
              mode={mode}
              busy={busy}
              ready={Boolean(document)}
              canPrint={ready || (mode === 'markdown' && Boolean(controller.current))}
              settings={pageSettings}
              theme={theme}
              paperTheme={paperTheme}
              onPaperTheme={(next) => {
                if (!locked.current) setPaperTheme(next)
              }}
              onTheme={(next) => void changeTheme(next)}
              onMode={changeMode}
              onSettings={setPageSettings}
              onPrint={() => void print()}
            />
            <EditorToolbar
              key={document?.id}
              workspace={workspace}
              busy={busy}
              ready={ready && mode === 'visual'}
              canSave={ready || mode === 'markdown'}
              selection={selection}
              onOpen={() => void run('open')}
              onSave={(copy) => void run('save', copy)}
              onFormat={(action, level) => controller.current?.format(action, level)}
              onFocusEditor={() => controller.current?.focus()}
              onInsertTable={(rows, columns) => controller.current?.insertTable(rows, columns) ?? false}
              onTable={(action) => controller.current?.table(action) ?? false}
              onLink={(value) => controller.current?.setLink(value) ?? false}
              onRemoveLink={() => controller.current?.removeLink() ?? false}
              onImage={(value) => controller.current?.setImage(value) ?? false}
              onRemoveImage={() => controller.current?.removeImage() ?? false}
            />
          </div>
          {error ? (
            <div role="alert" className={styles.error}>
              {error}
              <button aria-label="Cerrar aviso" onClick={() => setError('')}>
                Cerrar
              </button>
            </div>
          ) : null}
          {brainOpen && workspace ? (
            <div className={styles.brain}>
              <Suspense fallback={<p className={styles.loading}>Preparando Cerebro…</p>}>
                <Brain
                  workspace={workspace}
                  theme={theme}
                  busy={busy}
                  onOpen={(id) => void runWorkspace({ type: 'open', id })}
                  onClose={() => {
                    focusOrigin.current = globalThis.document.activeElement
                    setBrainOpen(false)
                    setFocusDocument(true)
                  }}
                />
              </Suspense>
            </div>
          ) : null}
          <main
            ref={workspaceArea}
            className={styles.workspace}
            data-view={mode}
            data-paper-theme={paperTheme}
            data-brain-hidden={brainOpen || undefined}
            aria-busy={busy}
          >
            {document ? (
              <>
                <div
                  className={styles.visual}
                  data-paper-theme={paperTheme}
                  data-hidden={mode === 'markdown' || undefined}
                >
                  <div className={styles.zoom} style={{ zoom: zoom / 100 }}>
                    <MarkdownEditor
                      key={document.id}
                      documentId={document.id}
                      source={document.content}
                      savedSource={document.savedContent}
                      onReady={editorReady}
                      onChange={changed}
                      onSelection={setSelection}
                      onError={setError}
                    />
                  </div>
                </div>
                <textarea
                  key={document.id}
                  ref={sourceInput}
                  hidden={mode !== 'markdown'}
                  className={styles.source}
                  style={{ fontSize: `${(sourceFontPx * zoom) / 100}px` }}
                  aria-label="Código Markdown"
                  spellCheck={false}
                  readOnly={busy}
                  value={source}
                  onChange={(event) => changeSource(event.target.value)}
                />
              </>
            ) : null}
          </main>
          {document && !brainOpen ? (
            <ZoomBar
              zoom={zoom}
              fit={fitZoom}
              disabled={!ready && mode === 'visual'}
              onZoom={changeZoom}
              onFit={() => setFitZoom(true)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
