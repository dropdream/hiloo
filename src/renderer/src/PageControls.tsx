import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { pageFormats, pageMarginMm, validatePageSettings, type PageSettings } from '../../shared/printing'
import type { WindowTheme } from '../../shared/window'
import { Icon } from './Icon'
import styles from './PageControls.module.css'

interface Props {
  mode: 'visual' | 'markdown'
  busy: boolean
  ready: boolean
  canPrint: boolean
  settings: PageSettings
  theme: WindowTheme
  paperTheme: WindowTheme
  onMode(mode: 'visual' | 'markdown'): void
  onSettings(settings: PageSettings): void
  onPrint(): void
  onTheme(theme: WindowTheme): void
  onPaperTheme(theme: WindowTheme): void
}

export function PageControls({ mode, busy, ready, canPrint, settings, theme, paperTheme, onMode, onSettings, onPrint, onTheme, onPaperTheme }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const formatButton = useRef<HTMLButtonElement>(null)
  const label = pageFormats.find((format) => format.id === settings.format)?.label ?? 'Personalizado'
  return (
    <div className={styles.controls}>
      <div className={styles.views} role="group" aria-label="Vista del documento">
        <button type="button" disabled={busy || !ready} aria-pressed={mode === 'markdown'} onClick={() => onMode('markdown')}>
          Markdown
        </button>
        <button type="button" disabled={busy || !ready} aria-pressed={mode === 'visual'} onClick={() => onMode('visual')}>
          Vista impresión
        </button>
      </div>
      <div className={styles.actions}>
        <button
          ref={formatButton}
          type="button"
          aria-label="Formato de página"
          aria-haspopup="dialog"
          disabled={busy || !ready}
          onClick={() => setDialogOpen(true)}
        >
          <Icon name="page" />
          <span>{label}</span>
          <span className={styles.measurement}>
            {settings.widthMm} × {settings.heightMm} mm
          </span>
        </button>
        <button type="button" aria-label="Imprimir" aria-keyshortcuts="Control+p" disabled={busy || !canPrint} onClick={onPrint}>
          <Icon name="print" />
          Imprimir
        </button>
      </div>
      {mode === 'visual' ? (
        <div className={styles.views} role="group" aria-label="Fondo de vista impresión">
          <button type="button" disabled={busy || !ready} aria-pressed={paperTheme === 'day'} onClick={() => onPaperTheme('day')}>
            Papel blanco
          </button>
          <button type="button" disabled={busy || !ready} aria-pressed={paperTheme === 'night'} onClick={() => onPaperTheme('night')}>
            Fondo noche
          </button>
        </div>
      ) : null}
      <div className={styles.views} role="group" aria-label="Tema del sistema">
        <button type="button" disabled={busy} aria-pressed={theme === 'day'} onClick={() => onTheme('day')}>
          Día
        </button>
        <button type="button" disabled={busy} aria-pressed={theme === 'night'} onClick={() => onTheme('night')}>
          Noche
        </button>
      </div>
      {dialogOpen ? (
        <PageFormatDialog
          settings={settings}
          onApply={onSettings}
          onClose={() => {
            setDialogOpen(false)
            formatButton.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}

function PageFormatDialog({ settings, onApply, onClose }: { settings: PageSettings; onApply(settings: PageSettings): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [format, setFormat] = useState(settings.format)
  const [width, setWidth] = useState(String(settings.widthMm))
  const [height, setHeight] = useState(String(settings.heightMm))
  const [error, setError] = useState('')
  const preset = pageFormats.find((value) => value.id === format)
  const selected: PageSettings = { format, widthMm: preset?.widthMm ?? Number(width), heightMm: preset?.heightMm ?? Number(height) }
  const valid = validatePageSettings(selected)

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) {
      setError('Usa medidas entre 50 y 1000 mm, con un máximo de un decimal.')
      return
    }
    onApply(selected)
    dismiss()
  }

  const dismiss = () => {
    dialog.current?.close()
    onClose()
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      onCancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
    >
      <form onSubmit={submit} noValidate>
        <h2 id={`${id}-title`}>Formato de página</h2>
        <p id={`${id}-help`}>Elige el tamaño del papel para imprimir este documento.</p>
        <div className={styles.paperPreview} aria-hidden="true">
          <div style={{ aspectRatio: valid ? `${selected.widthMm} / ${selected.heightMm}` : '210 / 297' }}>
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <label htmlFor={`${id}-format`}>
          Tamaño de papel
          <select
            id={`${id}-format`}
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as PageSettings['format'])
              setError('')
            }}
          >
            {pageFormats.map((value) => (
              <option key={value.id} value={value.id}>
                {value.label}
              </option>
            ))}
            <option value="custom">Personalizado</option>
          </select>
        </label>
        {format === 'custom' ? (
          <div className={styles.dimensions}>
            <label htmlFor={`${id}-width`}>
              Ancho (mm)
              <input
                id={`${id}-width`}
                type="number"
                min="50"
                max="1000"
                step="0.1"
                required
                value={width}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setWidth(event.target.value)
                  setError('')
                }}
              />
            </label>
            <label htmlFor={`${id}-height`}>
              Alto (mm)
              <input
                id={`${id}-height`}
                type="number"
                min="50"
                max="1000"
                step="0.1"
                required
                value={height}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setHeight(event.target.value)
                  setError('')
                }}
              />
            </label>
          </div>
        ) : null}
        <p className={styles.summary}>
          {valid ? `${selected.widthMm} × ${selected.heightMm} mm · ` : ''}Márgenes de {pageMarginMm} mm
        </p>
        {error ? (
          <p role="alert" id={`${id}-error`} className={styles.error}>
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" onClick={dismiss}>
            Cancelar
          </button>
          <button className={styles.primary} type="submit">
            Aplicar
          </button>
        </footer>
      </form>
    </dialog>
  )
}
