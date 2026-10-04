import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import cytoscape, { type Core, type EventObject } from 'cytoscape'
import type { WorkspaceNote, WorkspaceSnapshot } from '../../shared/workspace'
import { Icon } from './Icon'
import styles from './Brain.module.css'

interface Props {
  workspace: WorkspaceSnapshot
  busy: boolean
  theme: 'day' | 'night'
  onOpen(id: string): void
  onClose(): void
}

interface NotePreview {
  note: WorkspaceNote
  loading: boolean
  content: string
  error: string
}

interface HoveredNote {
  id: string
  x: number
  y: number
}

const previewCharacters = 24000

function fitGraph(instance: Core) {
  if (instance.destroyed()) return
  instance.fit(undefined, 40)
  if (instance.zoom() > 1.3) instance.zoom(1.3)
  instance.center()
}

export function Brain({ workspace, busy, theme, onOpen, onClose }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const returnButton = useRef<HTMLButtonElement>(null)
  const previewClose = useRef<HTMLButtonElement>(null)
  const previewOrigin = useRef<HTMLElement | null>(null)
  const previewSequence = useRef(0)
  const graph = useRef<Core | null>(null)
  const hoveredId = useRef<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [graphError, setGraphError] = useState(false)
  const [hovered, setHovered] = useState<HoveredNote | null>(null)
  const [preview, setPreview] = useState<NotePreview | null>(null)
  const noteById = useMemo(() => new Map(workspace.notes.map((note) => [note.id, note])), [workspace.notes])
  const connections = useMemo(() => {
    const outgoing = new Map<string, WorkspaceNote[]>()
    for (const link of workspace.links) {
      const target = noteById.get(link.target)
      if (!target) continue
      const targets = outgoing.get(link.source)
      if (targets) targets.push(target)
      else outgoing.set(link.source, [target])
    }
    return outgoing
  }, [noteById, workspace.links])

  const showPreview = useCallback(async (id: string) => {
    const note = noteById.get(id)
    if (!note) return
    const sequence = ++previewSequence.current
    previewOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPreview({ note, loading: true, content: '', error: '' })
    try {
      const result = await window.workspace.preview(id)
      if (previewSequence.current !== sequence) return
      if (result.status === 'ok') setPreview({ note: result.note, loading: false, content: result.content, error: '' })
      else setPreview({ note, loading: false, content: '', error: result.message })
    } catch {
      if (previewSequence.current === sequence) setPreview({ note, loading: false, content: '', error: 'No se pudo leer esta nota. Vuelve a intentarlo.' })
    }
  }, [noteById])
  const actions = useRef({ busy, showPreview })
  useEffect(() => { actions.current = { busy, showPreview } }, [busy, showPreview])
  useEffect(() => { returnButton.current?.focus() }, [])
  useEffect(() => {
    setPreview(null)
    return () => { previewSequence.current++ }
  }, [workspace.id])
  useEffect(() => { previewClose.current?.focus() }, [preview?.note.id])

  const cancelHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
  }, [])
  const scheduleHideInfo = useCallback(() => {
    cancelHoverTimer()
    hoverTimer.current = setTimeout(() => {
      const instance = graph.current
      if (instance && !instance.destroyed()) instance.nodes().removeClass('hovered')
      hoveredId.current = null
      setHovered(null)
    }, 220)
  }, [cancelHoverTimer])
  const closePreview = () => {
    previewSequence.current++
    setPreview(null)
    const origin = previewOrigin.current
    if (origin?.isConnected && !origin.closest('[data-note-preview]')) origin.focus()
    else returnButton.current?.focus()
  }

  useEffect(() => {
    const element = container.current
    setHovered(null)
    hoveredId.current = null
    if (!element || !workspace.notes.length) return
    setGraphError(false)
    const computed = getComputedStyle(element)
    const color = (name: string) => computed.getPropertyValue(`--hiloo-${name}`).trim()
    let instance: Core | null = null
    let observer: ResizeObserver | null = null
    try {
      instance = cytoscape({
        container: element,
        elements: [
          ...workspace.notes.map((note) => ({ data: { id: note.id, label: note.name.replace(/\.(?:md|markdown)$/i, '') } })),
          ...workspace.links.map((link, index) => ({ data: { id: `connection-${index}`, source: link.source, target: link.target } }))
        ],
        style: [
          { selector: 'node', style: {
            width: 8, height: 8, 'background-color': color('accent'),
            label: 'data(label)', color: color('muted'), 'font-family': computed.fontFamily,
            'font-size': 9, 'text-opacity': 0.55, 'text-valign': 'bottom', 'text-margin-y': 5,
            'text-max-width': '100px', 'text-wrap': 'ellipsis', 'min-zoomed-font-size': 6,
            'border-width': 1, 'border-color': color('bar')
          } },
          { selector: 'node.current', style: { width: 10, height: 10, 'border-width': 1.5, 'border-color': color('text') } },
          { selector: 'node.hovered', style: { width: 16, height: 16, 'font-size': 11, 'text-opacity': 1, 'min-zoomed-font-size': 0, color: color('text'), 'border-width': 2, 'border-color': color('text'), 'z-index': 10 } },
          { selector: 'edge', style: {
            width: 0.8, 'line-color': color('muted'), 'target-arrow-color': color('muted'),
            'target-arrow-shape': 'triangle', 'arrow-scale': 0.55, 'curve-style': 'bezier', opacity: 0.35
          } }
        ],
        layout: { name: 'concentric', animate: false, padding: 40, minNodeSpacing: 38, concentric: (node) => node.degree(), levelWidth: () => 2 },
        minZoom: 0.001,
        maxZoom: 3,
        wheelSensitivity: 0.2,
        boxSelectionEnabled: false,
        autounselectify: true
      })
      graph.current = instance
      fitGraph(instance)
      const activeGraph = instance
      const updateInfoPosition = () => {
        if (activeGraph.destroyed() || !hoveredId.current) return
        const node = activeGraph.getElementById(hoveredId.current)
        if (node.empty()) return
        const position = node.renderedPosition()
        setHovered({ id: node.id(), x: Math.max(4, Math.min(activeGraph.width() - 28, position.x + 10)), y: Math.max(4, Math.min(activeGraph.height() - 48, position.y - 22)) })
      }
      instance.on('tap', 'node', (event: EventObject) => {
        if (!actions.current.busy) void actions.current.showPreview(event.target.id() as string)
      })
      instance.on('mouseover', 'node', (event: EventObject) => {
        cancelHoverTimer()
        activeGraph.nodes().removeClass('hovered')
        const node = event.target
        node.addClass('hovered')
        hoveredId.current = node.id() as string
        element.style.cursor = 'pointer'
        updateInfoPosition()
      })
      instance.on('mouseout', 'node', () => {
        element.style.cursor = ''
        scheduleHideInfo()
      })
      instance.on('pan zoom position', updateInfoPosition)
      observer = new ResizeObserver(() => {
        if (!activeGraph.destroyed()) {
          activeGraph.resize()
          updateInfoPosition()
        }
      })
      observer.observe(element)
    } catch {
      observer?.disconnect()
      instance?.destroy()
      graph.current = null
      setGraphError(true)
    }
    return () => {
      cancelHoverTimer()
      observer?.disconnect()
      instance?.destroy()
      element.style.cursor = ''
      if (graph.current === instance) graph.current = null
    }
  }, [workspace.id, workspace.notes, workspace.links, theme, cancelHoverTimer, scheduleHideInfo])

  useEffect(() => {
    const instance = graph.current
    if (!instance || instance.destroyed()) return
    instance.nodes().removeClass('current')
    if (workspace.currentNoteId) instance.getElementById(workspace.currentNoteId).addClass('current')
  }, [workspace.currentNoteId, workspace.id, workspace.notes, workspace.links, theme])

  const zoom = (factor: number) => {
    const instance = graph.current
    if (!instance || instance.destroyed()) return
    const level = Math.min(instance.maxZoom(), Math.max(instance.minZoom(), instance.zoom() * factor))
    instance.zoom({ level, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } })
  }
  const hoveredNote = hovered ? noteById.get(hovered.id) : null

  return <section className={styles.brain} aria-label="Conexiones del cuaderno" aria-busy={busy}>
    <header className={styles.header}>
      <div><h1><Icon name="brain" width="18" height="18" />Cerebro</h1><p>{workspace.name} · {workspace.notes.length} {workspace.notes.length === 1 ? 'nota' : 'notas'} · {workspace.links.length} {workspace.links.length === 1 ? 'conexión' : 'conexiones'}</p></div>
      <button ref={returnButton} type="button" onClick={onClose}>Volver al documento</button>
    </header>
    <p className={styles.intro}>Cada nodo es una nota del cuaderno. Las flechas reflejan los enlaces guardados en tus notas.</p>
    {workspace.warnings.length ? <details className={styles.warnings}><summary>Avisos del cuaderno ({workspace.warnings.length})</summary><ul>{workspace.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
    {workspace.notes.length ? <>
      <div className={styles.graphWorkspace} data-preview-open={Boolean(preview)}>
        <div className={styles.graphArea}>
          <div className={styles.canvas} ref={container} data-testid="brain-canvas" aria-hidden="true" />
          {graphError ? <p className={styles.graphError} role="status">No se pudo mostrar el grafo. Puedes explorar las notas y conexiones en la lista inferior.</p> : null}
          {hovered && hoveredNote ? <button type="button" className={styles.infoButton} style={{ left: hovered.x, top: hovered.y }} aria-label={`Información de nota: ${hoveredNote.relativePath}`} title={`Vista previa de ${hoveredNote.name}`} disabled={busy} onMouseEnter={cancelHoverTimer} onMouseLeave={scheduleHideInfo} onFocus={cancelHoverTimer} onBlur={scheduleHideInfo} onClick={() => { void showPreview(hovered.id) }}><Icon name="info" /></button> : null}
          <div className={styles.graphTools} role="group" aria-label="Controles del grafo">
            <button type="button" onClick={() => zoom(1.25)} disabled={graphError} aria-label="Acercar grafo" title="Acercar grafo"><Icon name="plus" /></button>
            <button type="button" onClick={() => zoom(0.8)} disabled={graphError} aria-label="Alejar grafo" title="Alejar grafo"><Icon name="minus" /></button>
            <button type="button" onClick={() => { if (graph.current) fitGraph(graph.current) }} disabled={graphError} aria-label="Ajustar grafo" title="Ajustar grafo"><Icon name="fit" /></button>
          </div>
          <p className={styles.graphHint}>Pulsa un nodo o su icono de información para ver una vista previa.</p>
        </div>
        {preview ? <section className={styles.preview} aria-label="Vista previa de nota" aria-busy={preview.loading} data-note-preview onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closePreview() } }}>
          <header className={styles.previewHeader}><div><span>Vista previa Markdown</span><h2>{preview.note.name}</h2></div><button ref={previewClose} type="button" onClick={closePreview} aria-label="Cerrar vista previa" title="Cerrar vista previa"><Icon name="close" /></button></header>
          <p className={styles.previewPath}>{preview.note.relativePath}</p>
          {preview.loading ? <p className={styles.previewMessage} aria-live="polite">Cargando nota…</p> : preview.error ? <p className={styles.previewMessage} role="alert">{preview.error}</p> : <>
            <pre className={styles.previewSource} tabIndex={0} aria-label="Contenido de la vista previa">{preview.content.slice(0, previewCharacters) || 'Esta nota está vacía.'}</pre>
            {preview.content.length > previewCharacters ? <p className={styles.previewMessage}>Se muestra un extracto. Abre la nota para leerla completa.</p> : null}
          </>}
          <footer className={styles.previewFooter}><span>Contenido guardado · solo lectura</span><button type="button" disabled={busy || preview.loading || Boolean(preview.error)} onClick={() => onOpen(preview.note.id)}>Abrir nota</button></footer>
        </section> : null}
      </div>
      <details className={styles.connections} open>
        <summary>Notas y conexiones</summary>
        <ul className={styles.notes}>
          {workspace.notes.map((note) => {
            const targets = connections.get(note.id) ?? []
            return <li key={note.id} className={styles.note}>
              <button type="button" disabled={busy} onClick={() => { void showPreview(note.id) }} aria-label={`Vista previa: ${note.relativePath}`} aria-current={workspace.currentNoteId === note.id ? 'page' : undefined}><Icon name="page" /><span>{note.relativePath}</span></button>
              {targets.length ? <div className={styles.targets}><span>Enlaza con</span><ul>{targets.map((target) => <li key={target.id}><button type="button" disabled={busy} onClick={() => { void showPreview(target.id) }} aria-label={`Vista previa de conexión de ${note.relativePath} a ${target.relativePath}`}>{target.relativePath}</button></li>)}</ul></div> : <span className={styles.noLinks}>Sin enlaces salientes</span>}
            </li>
          })}
        </ul>
      </details>
    </> : <div className={styles.empty}><Icon name="brain" width="28" height="28" /><h2>Las conexiones empiezan con una nota</h2><p>Añade archivos .md a este cuaderno y actualízalo para verlos aquí.</p></div>}
  </section>
}
