import { useCallback, useEffect, useRef, useState } from 'react'
import { maxDocumentBytes, type DocumentSnapshot, type DocumentResult } from '../../shared/documents'
import { emptySelection, type EditorController } from './editor'

// El textarea usa LF; el proceso principal conserva CRLF al guardar.
function sameSource(left: string, right: string): boolean {
  return left === right || left.replace(/\r\n/g, '\n') === right.replace(/\r\n/g, '\n')
}

export function useDocumentSession(onNewDocument: () => void) {
  const [document, setDocument] = useState<DocumentSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'open' | 'save' | 'print' | 'theme'>('save')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState(emptySelection)
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual')
  const [source, setSource] = useState('')
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

  const setEditingLocked = useCallback((value: boolean) => {
    locked.current = value
    controller.current?.setEditable(!value)
    setBusy(value)
  }, [])

  const beginOperation = useCallback(
    (action: typeof operation, clearError = true) => {
      if (locked.current) return false
      setOperation(action)
      setEditingLocked(true)
      if (clearError) setError('')
      return true
    },
    [setEditingLocked]
  )

  const endOperation = useCallback(() => setEditingLocked(false), [setEditingLocked])

  const drainUpdates = useCallback(async () => {
    let last: Promise<unknown>
    do {
      last = pending.current
      await last
    } while (last !== pending.current)
    return syncError.current || null
  }, [])

  const applyDocument = useCallback(
    (next: DocumentSnapshot) => {
      let clean = true
      if (next.id !== current.current?.id) {
        onNewDocument()
        controller.current = null
        setReady(false)
        setSelection(emptySelection)
        syncError.current = ''
        sourceRef.current = next.content
        setSource(next.content)
      } else {
        clean =
          modeRef.current === 'markdown'
            ? sameSource(sourceRef.current, next.savedContent)
            : (controller.current?.markSaved(next.savedContent) ?? true)
        if (modeRef.current === 'markdown' && clean && !next.dirty) {
          sourceRef.current = next.savedContent
          setSource(next.savedContent)
        }
      }
      current.current = next
      setDocument({ ...next, dirty: next.dirty || !clean })
      setError(next.updateError || syncError.current)
    },
    [onNewDocument]
  )

  useEffect(() => {
    let active = true
    const unsubscribe = window.documents.onDocument(applyDocument)
    const unsubscribeBusy = window.documents.onBusy((value) => void setEditingLocked(value || printSession.current))
    const unsubscribeError = window.documents.onError(setError)
    const unsubscribeFlush = window.documents.onFlush(async () => {
      setEditingLocked(true)
      return drainUpdates()
    })
    void window.documents
      .current()
      .then((next) => {
        if (active) applyDocument(next)
      })
      .catch(() => setError('No se pudo cargar el documento. Reiniciar hiloo.'))
    return () => {
      active = false
      unsubscribe()
      unsubscribeBusy()
      unsubscribeError()
      unsubscribeFlush()
    }
  }, [applyDocument, drainUpdates, setEditingLocked])

  useEffect(() => void controller.current?.setEditable(!busy), [busy, ready])

  const run = useCallback(
    async (action: 'open' | 'save', copy = false) => {
      if (!beginOperation(action)) return
      try {
        const failure = await drainUpdates()
        if (failure) throw new Error(failure)
        const result: DocumentResult =
          action === 'open' ? await window.documents.open() : await window.documents.save(copy)
        if (result.status === 'error') setError(result.message)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'No se pudo completar la operación.')
      } finally {
        endOperation()
      }
    },
    [beginOperation, drainUpdates, endOperation]
  )

  const prepareVisual = useCallback(() => {
    if (!controller.current) {
      setError(
        'La vista impresión no está disponible. El código permanece en Markdown; guarda tus cambios y vuelve a abrir el documento.'
      )
      return false
    }
    const problem = controller.current.replaceSource(sourceRef.current)
    if (problem) {
      setError(problem)
      return false
    }
    if (current.current) controller.current.markSaved(current.current.savedContent)
    setReady(true)
    controller.current.setEditable(!locked.current)
    return true
  }, [])

  const changed = useCallback((markdown: string, clean: boolean) => {
    const active = current.current
    if (!active) return
    const content = clean ? active.savedContent : markdown
    sourceRef.current = content
    setSource(content)
    setError('')
    const sequence = ++editSequence.current
    setDocument((previous) => (previous ? { ...previous, content, dirty: !clean } : previous))
    // Cada edición espera la respuesta de la anterior.
    pending.current = pending.current
      .then(() => window.documents.update(active.id, clean ? active.savedContent : markdown))
      .then((result) => {
        if (sequence !== editSequence.current) return
        const previousSyncError = syncError.current
        syncError.current = result.status === 'error' ? result.message : ''
        if (syncError.current) setError(syncError.current)
        else setError((previous) => (previous === previousSyncError ? '' : previous))
        if (syncError.current) setDocument((previous) => (previous ? { ...previous, dirty: true } : previous))
      })
      .catch(() => {
        if (sequence !== editSequence.current) return
        syncError.current = 'No se pudo sincronizar la edición. No cerrar la ventana.'
        setError(syncError.current)
        setDocument((previous) => (previous ? { ...previous, dirty: true } : previous))
      })
  }, [])

  const editorReady = useCallback((next: EditorController) => {
    controller.current = next
    next.setEditable(!locked.current)
    setReady(next.visualReady())
    if (modeRef.current === 'visual') next.focus()
    else sourceInput.current?.focus()
  }, [])

  const changeSource = (value: string) => {
    if (locked.current) return
    if (new TextEncoder().encode(value).length > maxDocumentBytes) {
      setError('El documento supera el límite de 2 MB. La última edición no se aplicó.')
      return
    }
    changed(value, sameSource(value, current.current?.savedContent ?? ''))
  }

  return {
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
    printSession,
    beginOperation,
    endOperation,
    drainUpdates,
    run,
    prepareVisual,
    changed,
    editorReady,
    changeSource
  }
}
