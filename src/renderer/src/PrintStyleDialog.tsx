import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { printStyleProblem } from '../../shared/settings'
import styles from './PrintStyleDialog.module.css'

const example = `font-family: Georgia, serif;
font-size: 12pt;

h1 { font-size: 22pt; text-align: center; }
h2 { font-size: 16pt; border-bottom: 1px solid #888; }
p { text-align: justify; line-height: 1.6; }
blockquote { font-style: italic; }
`

interface Props {
  value: string
  onSave(css: string): Promise<string | null>
  onClose(): void
}

export function PrintStyleDialog({ value, onSave, onClose }: Props) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [css, setCss] = useState(value)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    input.current?.focus()
    return () => {
      element.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const problem = printStyleProblem(css)
    if (problem) {
      setError(problem)
      input.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    const failure = await onSave(css)
    setSaving(false)
    if (failure) {
      setError(failure)
      input.current?.focus()
    } else onClose()
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onClose()
      }}
    >
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <h2 id={`${id}-title`}>CSS de impresión</h2>
        <div id={`${id}-help`} className={styles.help}>
          <p>
            Define el formato de títulos, párrafos y texto al imprimir. Se aplica en la vista previa y en la impresión, no al editar ni al archivo Markdown.
          </p>
          <p>
            Las reglas se limitan al documento: usa selectores como <code>h1</code>, <code>p</code>, <code>blockquote</code>, <code>table</code> o{' '}
            <code>code</code>. Las declaraciones sin selector afectan a todo el documento.
          </p>
        </div>
        <label htmlFor={`${id}-css`}>Reglas CSS</label>
        <textarea
          ref={input}
          id={`${id}-css`}
          className={styles.editor}
          spellCheck={false}
          value={css}
          placeholder={example}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={saving}
          onChange={(event) => {
            setCss(event.target.value)
            setError('')
          }}
        />
        {error ? (
          <p role="alert" id={`${id}-error`} className={styles.error}>
            {error}
          </p>
        ) : null}
        <footer>
          <button
            type="button"
            className={styles.secondary}
            disabled={saving}
            onClick={() => {
              setCss(example)
              setError('')
              input.current?.focus()
            }}
          >
            Usar ejemplo
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={styles.primary} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
