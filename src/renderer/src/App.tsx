import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentSnapshot, DocumentResult } from '../../shared/documents'
import { MarkdownEditor, emptySelection, type EditorController } from './editor'
import { EditorToolbar } from './Toolbar'
import styles from './App.module.css'

export function App() {
  const [document, setDocument] = useState<DocumentSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'open' | 'save'>('save')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState(emptySelection)
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
      controller.current = null
      setReady(false)
      setSelection(emptySelection)
      syncError.current = ''
    } else clean = controller.current?.markSaved(next.savedContent) ?? true
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

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog')) return
      if (!event.ctrlKey || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (key !== 'o' && key !== 's') return
      event.preventDefault()
      if (key === 'o') void run('open')
      else if (controller.current) void run('save', event.shiftKey)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [run])

  const changed = useCallback((markdown: string, clean: boolean) => {
    const active = current.current
    if (!active) return
    const sequence = ++editSequence.current
    setDocument((previous) => previous ? { ...previous, dirty: !clean } : previous)
    // Orden explícito: cada versión completa espera la respuesta de la anterior.
    pending.current = pending.current.then(() => window.documents.update(active.id, clean ? active.savedContent : markdown)).then((result) => {
      if (sequence !== editSequence.current) return
      syncError.current = result.status === 'error' ? result.message : ''
      setError(syncError.current)
      if (syncError.current) setDocument((previous) => previous ? { ...previous, dirty: true } : previous)
    }).catch(() => {
      if (sequence !== editSequence.current) return
      syncError.current = 'No se pudo sincronizar la edición. No cerrar la ventana.'
      setError(syncError.current)
      setDocument((previous) => previous ? { ...previous, dirty: true } : previous)
    })
  }, [])

  const status = busy ? (operation === 'save' ? 'Guardando…' : 'Abriendo…') : document?.dirty ? 'Cambios sin guardar' : document?.hasFile ? 'Guardado' : 'Sin cambios'

  return <div className={styles.app}>
    <header className={styles.titlebar}>
      <span className={styles.filename}>{document?.name ?? 'hiloo'}</span>
      <span className={styles.status} role="status"><span className={styles.dot} data-dirty={document?.dirty || undefined} />{status}</span>
    </header>
    <EditorToolbar key={document?.id} busy={busy} ready={ready} selection={selection}
      onOpen={() => { void run('open') }} onSave={(copy) => { void run('save', copy) }}
      onFormat={(action, level) => controller.current?.format(action, level)} onFocusEditor={() => controller.current?.focus()}
      onInsertTable={(rows, columns) => controller.current?.insertTable(rows, columns) ?? false}
      onTable={(action) => controller.current?.table(action) ?? false}
      onLink={(value) => controller.current?.setLink(value) ?? false} onRemoveLink={() => controller.current?.removeLink() ?? false}
      onImage={(value) => controller.current?.setImage(value) ?? false} onRemoveImage={() => controller.current?.removeImage() ?? false} />
    {error ? <div role="alert" className={styles.error}>{error}<button aria-label="Cerrar aviso" onClick={() => setError('')}>Cerrar</button></div> : null}
    <main className={styles.workspace} aria-busy={busy}>
      {document ? <MarkdownEditor key={document.id} documentId={document.id} source={document.content} savedSource={document.savedContent} onReady={(next) => { controller.current = next; next.setEditable(!locked.current); setReady(true); next.focus() }} onChange={changed} onSelection={setSelection} onError={setError} /> : null}
    </main>
  </div>
}
