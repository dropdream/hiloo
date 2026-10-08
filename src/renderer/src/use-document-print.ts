import { useCallback, useRef, useState } from 'react'
import type { DocumentPreviewResult } from '../../shared/documents'
import type { PageSettings } from '../../shared/printing'
import type { useDocumentSession } from './use-document-session'

export function useDocumentPrint(session: ReturnType<typeof useDocumentSession>, pageSettings: PageSettings) {
  const { locked, printSession, controller, setError, beginOperation, endOperation, drainUpdates, prepareVisual } =
    session
  const [printPreview, setPrintPreview] = useState<{
    result: Extract<DocumentPreviewResult, { status: 'ok' }>
    settings: PageSettings
  } | null>(null)
  const [printing, setPrinting] = useState(false)
  const printFocus = useRef<HTMLElement | null>(null)

  const print = useCallback(async () => {
    if (locked.current || !prepareVisual() || !controller.current) return
    printSession.current = true
    beginOperation('print')
    printFocus.current =
      globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null
    let previewOpened = false
    try {
      const failure = await drainUpdates()
      if (failure) throw new Error(failure)
      // Las imágenes relativas resuelven su ruta por IPC antes de cargar.
      const deadline = Date.now() + 10000
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Las fuentes todavía no terminan de cargar. Vuelve a imprimir.')),
          10000
        )
        void globalThis.document.fonts.ready.then(
          () => {
            clearTimeout(timer)
            resolve()
          },
          () => {
            clearTimeout(timer)
            reject(new Error('No se pudieron preparar las fuentes para imprimir.'))
          }
        )
      })
      while (
        globalThis.document.querySelector(
          '.document-image[data-loading="true"], .document-mermaid[data-loading="true"]'
        )
      ) {
        if (Date.now() >= deadline)
          throw new Error('Hay imágenes o diagramas que todavía no terminan de cargar. Espera y vuelve a imprimir.')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const result = await window.documents.printPreview(pageSettings)
      if (result.status === 'error') setError(result.message)
      else if (result.status === 'ok') {
        previewOpened = true
        setPrintPreview({ result, settings: pageSettings })
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo imprimir el documento.')
    } finally {
      if (!previewOpened) {
        printSession.current = false
        endOperation()
      }
    }
  }, [beginOperation, endOperation, drainUpdates, pageSettings, prepareVisual])

  const closePrintPreview = () => {
    setPrintPreview(null)
    printSession.current = false
    endOperation()
    requestAnimationFrame(() =>
      printFocus.current?.isConnected ? printFocus.current.focus() : controller.current?.focus()
    )
  }

  const confirmPrint = async () => {
    if (!printPreview || printing) return
    setPrinting(true)
    try {
      const { result, settings } = printPreview
      const printed = await window.documents.print(settings, {
        documentId: result.documentId,
        revision: result.revision
      })
      if (printed.status === 'error') setError(printed.message)
    } catch {
      setError('No se pudo imprimir el documento.')
    } finally {
      setPrinting(false)
      closePrintPreview()
    }
  }

  return { printPreview, printing, print, closePrintPreview, confirmPrint }
}
