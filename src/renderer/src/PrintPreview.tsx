import { useEffect, useId, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFWorker, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import styles from './PrintPreview.module.css'

interface Props {
  pdf: Uint8Array
  printing: boolean
  onPrint(): void
  onClose(): void
}

export function PrintPreview({ pdf, printing, onPrint, onClose }: Props) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [width, setWidth] = useState(600)
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry.contentRect.width)))
    observer.observe(viewport.current!)
    return () => {
      observer.disconnect()
      element.close()
    }
  }, [])

  useEffect(() => {
    let active = true
    let worker: Worker | undefined
    let pdfWorker: PDFWorker | undefined
    let task: ReturnType<(typeof import('pdfjs-dist'))['getDocument']> | undefined
    void import('pdfjs-dist')
      .then(async (pdfjs) => {
        if (!active) return
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        // El puerto explícito permite usar el hilo empaquetado desde file://.
        worker = new Worker(new URL(workerUrl, location.href), { type: 'module' })
        worker.onerror = (event) => {
          event.preventDefault()
          if (active) {
            setError('No se pudo iniciar la vista previa. Cancela y vuelve a imprimir.')
            setRendering(false)
          }
        }
        pdfWorker = pdfjs.PDFWorker.create({ port: worker })
        task = pdfjs.getDocument({ data: pdf.slice(), worker: pdfWorker, disableFontFace: true, useWasm: false })
        const loaded = await task.promise
        if (active) setDocument(loaded)
      })
      .catch(() => {
        if (active) {
          setError('No se pudo cargar la vista previa. Cancela y vuelve a imprimir.')
          setRendering(false)
        }
      })
    return () => {
      active = false
      void task?.destroy().catch(() => {})
      pdfWorker?.destroy()
      worker?.terminate()
    }
  }, [pdf])

  useEffect(() => {
    if (!document) return
    let active = true
    let task: RenderTask | undefined
    setRendering(true)
    setError('')
    void document
      .getPage(page)
      .then(async (loaded) => {
        if (!active || !canvas.current) return
        const base = loaded.getViewport({ scale: 1 })
        const scale = Math.min(width / base.width, 1.5)
        const density = Math.min(window.devicePixelRatio || 1, 2)
        const display = loaded.getViewport({ scale })
        const pixels = loaded.getViewport({ scale: scale * Math.min(density, Math.sqrt(8000000 / (display.width * display.height))) })
        const target = canvas.current
        target.width = Math.ceil(pixels.width)
        target.height = Math.ceil(pixels.height)
        target.style.width = `${display.width}px`
        target.style.height = `${display.height}px`
        task = loaded.render({ canvas: target, viewport: pixels })
        await task.promise
        if (active) setRendering(false)
      })
      .catch(() => {
        if (active) {
          setError('No se pudo dibujar esta página. Cancela y vuelve a imprimir.')
          setRendering(false)
        }
      })
    return () => {
      active = false
      task?.cancel()
    }
  }, [document, page, width])

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        if (!printing) onClose()
      }}
    >
      <header>
        <h2 id={`${id}-title`}>Vista previa de impresión</h2>
        <p>Revisa las páginas antes de elegir la impresora.</p>
      </header>
      <nav aria-label="Páginas de vista previa">
        <button type="button" disabled={!document || page === 1 || printing} onClick={() => setPage((value) => value - 1)}>
          Anterior
        </button>
        <span role="status" aria-live="polite">
          {document ? `Página ${page} de ${document.numPages}` : 'Preparando páginas…'}
        </span>
        <button type="button" disabled={!document || page === document.numPages || printing} onClick={() => setPage((value) => value + 1)}>
          Siguiente
        </button>
      </nav>
      <div ref={viewport} className={styles.viewport} aria-busy={rendering}>
        {error ? <p role="alert">{error}</p> : null}
        <canvas ref={canvas} hidden={!document || Boolean(error)} aria-label={`Vista previa de página ${page}`} />
      </div>
      <footer>
        <button type="button" disabled={printing} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className={styles.primary} disabled={rendering || Boolean(error) || !document || printing} onClick={onPrint}>
          {printing ? 'Imprimiendo…' : 'Imprimir'}
        </button>
      </footer>
    </dialog>
  )
}
