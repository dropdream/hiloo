import { useEffect, useId, useRef, useState } from 'react'
import type { NotebookIndexUsage } from '../../shared/notebook-index'
import styles from './NotebookIndexDialog.module.css'

const options: { usage: NotebookIndexUsage; label: string; description: string }[] = [
  { usage: 'ia', label: 'IA', description: 'Instrucciones para agentes de IA y un mapa enlazado de las notas existentes.' },
  { usage: 'humano', label: 'Humano', description: 'Introducción y secciones para que las escribas, más la lista de notas.' },
  { usage: 'ambos', label: 'Ambos', description: 'Instrucciones para IA, secciones pendientes para ti o tu IA y el mapa de notas.' }
]

interface Props {
  name: string
  /** Resolves with an error message, or null once the index was created and opened; the dialog then closes itself. */
  onChoose(usage: NotebookIndexUsage): Promise<string | null>
  onDismiss(): void
  /** Focus target when the element that opened the dialog is no longer available. */
  onFallbackFocus(): void
}

export function NotebookIndexDialog({ name, onChoose, onDismiss, onFallbackFocus }: Props) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(true)
  const opener = useRef<HTMLElement | null>(null)
  const fallback = useRef(onFallbackFocus)
  const [pending, setPending] = useState<NotebookIndexUsage | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { fallback.current = onFallbackFocus }, [onFallbackFocus])

  useEffect(() => {
    const element = dialog.current!
    // Development StrictMode remounts the effect; keep the element focused before the first opening.
    opener.current ??= document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    element.showModal()
    first.current?.focus()
    return () => {
      element.close()
      if (!restoreFocus.current) return
      const target = opener.current
      if (target?.isConnected && !target.closest('[inert]') && !(target as HTMLButtonElement).disabled) target.focus()
      else fallback.current()
    }
  }, [])

  const choose = async (usage: NotebookIndexUsage, trigger: HTMLButtonElement) => {
    if (pending) return
    setPending(usage)
    setError('')
    let failure: string | null
    try { failure = await onChoose(usage) } catch { failure = 'No se pudo crear el índice. Vuelve a intentarlo.' }
    if (failure === null) {
      // The new index opens in the editor, which takes the focus.
      restoreFocus.current = false
      onDismiss()
      return
    }
    setPending(null)
    setError(failure)
    requestAnimationFrame(() => trigger.focus())
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} aria-busy={pending ? true : undefined} onCancel={(event) => { event.preventDefault(); if (!pending) onDismiss() }}>
    <h2 id={`${id}-title`}>¿Qué uso le darás al cuaderno?</h2>
    <p id={`${id}-help`} className={styles.help}>hiloo creará <code>indice.md</code> en la raíz de <strong>{name}</strong> con un contenido adaptado al uso que elijas. No se modifica ninguna nota existente.</p>
    <div className={styles.options} role="group" aria-label="Uso del cuaderno">
      {options.map((option, index) => <button key={option.usage} ref={index === 0 ? first : undefined} type="button" className={styles.option} disabled={Boolean(pending)} aria-label={option.label} aria-describedby={`${id}-${option.usage}`} onClick={(event) => { void choose(option.usage, event.currentTarget) }}>
        <span className={styles.label}>{pending === option.usage ? <><span className={styles.spinner} aria-hidden="true" />Creando índice…</> : option.label}</span>
        <span id={`${id}-${option.usage}`} className={styles.description}>{option.description}</span>
      </button>)}
    </div>
    <p role="status" className={styles.status}>{pending ? 'Creando índice…' : ''}</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <footer className={styles.footer}>
      <button type="button" disabled={Boolean(pending)} onClick={onDismiss}>Ahora no</button>
    </footer>
  </dialog>
}
