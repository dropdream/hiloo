import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { safeImage, safeLink } from '../../shared/markdown'
import type { SelectionState, TableAction } from './editor'
import styles from './InsertDialog.module.css'

export type InsertKind = 'link' | 'image' | 'table'

interface Props {
  kind: InsertKind
  selection: SelectionState
  disabled: boolean
  onClose(): void
  onInsertTable(rows: number, columns: number): boolean
  onTable(action: TableAction): boolean
  onLink(value: { href: string; title: string; text: string }): boolean
  onRemoveLink(): boolean
  onImage(value: { src: string; alt: string; title: string }): boolean
  onRemoveImage(): boolean
}

const tableGroups: { label: string; actions: [TableAction, string][] }[] = [
  { label: 'Filas', actions: [['row-before', 'Insertar fila antes'], ['row-after', 'Insertar fila después'], ['delete-row', 'Eliminar fila']] },
  { label: 'Columnas', actions: [['column-before', 'Insertar columna antes'], ['column-after', 'Insertar columna después'], ['delete-column', 'Eliminar columna']] },
  { label: 'Alineación de columna', actions: [['align-left', 'Alinear a la izquierda'], ['align-center', 'Centrar'], ['align-right', 'Alinear a la derecha']] }
]

export function InsertDialog({ kind, selection, disabled, onClose, ...actions }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [url, setUrl] = useState(kind === 'link' ? selection.link?.href ?? '' : selection.image?.src ?? '')
  const [text, setText] = useState(kind === 'link' ? selection.link?.text ?? '' : selection.image?.alt ?? '')
  const [title, setTitle] = useState(kind === 'link' ? selection.link?.title ?? '' : selection.image?.title ?? '')
  const [rows, setRows] = useState('3')
  const [columns, setColumns] = useState('3')
  const [error, setError] = useState('')
  const editing = kind === 'table' ? selection.table : Boolean(kind === 'link' ? selection.link : selection.image)
  const noun = kind === 'link' ? 'enlace' : kind === 'image' ? 'imagen' : 'tabla'

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  const dismiss = () => {
    dialog.current?.close()
    onClose()
  }

  const apply = (action: () => boolean) => {
    if (disabled) return
    if (action()) dismiss()
    else setError('No se pudo aplicar el cambio en esta selección. Cierra el diálogo y selecciona el contenido que quieres editar.')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (kind === 'table') {
      const height = Number(rows), width = Number(columns)
      if (!Number.isInteger(height) || !Number.isInteger(width) || height < 1 || height > 20 || width < 1 || width > 10) {
        setError('Usa de 1 a 20 filas, incluida la cabecera, y de 1 a 10 columnas.')
        return
      }
      apply(() => actions.onInsertTable(height, width))
      return
    }
    const address = url.trim()
    if (!address || !(kind === 'link' ? safeLink(address) : safeImage(address))) {
      setError(kind === 'link' ? 'Escribe una dirección http, https, mailto o una ruta relativa válida.' : 'Escribe una dirección http o https, o una ruta de imagen relativa válida.')
      return
    }
    if (kind === 'link') apply(() => actions.onLink({ href: address, text, title }))
    else apply(() => actions.onImage({ src: address, alt: text, title }))
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-heading`} aria-describedby={`${id}-help`} onCancel={(event) => { event.preventDefault(); dismiss() }}>
    <form onSubmit={submit}>
      <h2 id={`${id}-heading`}>{editing ? 'Editar' : 'Insertar'} {noun}</h2>
      <p className={styles.help} id={`${id}-help`}>{kind === 'table'
        ? editing ? 'Los cambios se aplican a la celda, fila o columna seleccionada.' : 'La primera fila será la cabecera. Puedes añadir o quitar filas y columnas después.'
        : kind === 'link' ? 'Enlaza el texto seleccionado o escribe un texto nuevo.' : 'Usa una URL o una ruta como imagenes/foto.png, relativa al archivo Markdown guardado.'}</p>

      {kind === 'table' ? editing ? <div className={styles.tableTools}>
        {tableGroups.map((group) => <fieldset key={group.label} disabled={disabled}><legend>{group.label}</legend><div className={styles.actionGrid}>
          {group.actions.map(([action, label]) => <button key={action} type="button" onClick={() => apply(() => actions.onTable(action))}>{label}</button>)}
        </div></fieldset>)}
      </div> : <div className={styles.dimensions}>
        <label htmlFor={`${id}-rows`}>Filas<input id={`${id}-rows`} type="number" min="1" max="20" required value={rows} onChange={(event) => setRows(event.target.value)} disabled={disabled} /></label>
        <label htmlFor={`${id}-columns`}>Columnas<input id={`${id}-columns`} type="number" min="1" max="10" required value={columns} onChange={(event) => setColumns(event.target.value)} disabled={disabled} /></label>
      </div> : <div className={styles.fields}>
        <label htmlFor={`${id}-url`}>{kind === 'link' ? 'Dirección' : 'Origen'}<input id={`${id}-url`} type="text" required value={url} placeholder={kind === 'link' ? 'https://ejemplo.com' : 'https://… o imagenes/foto.png'} spellCheck={false} autoComplete="off" onChange={(event) => { setUrl(event.target.value); setError('') }} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} /></label>
        <label htmlFor={`${id}-text`}>{kind === 'link' ? 'Texto' : 'Texto alternativo'}<input id={`${id}-text`} type="text" value={text} placeholder={kind === 'link' ? 'Texto seleccionado o dirección' : 'Describe el contenido de la imagen'} onChange={(event) => setText(event.target.value)} disabled={disabled} /></label>
        <label htmlFor={`${id}-title`}>Título<input id={`${id}-title`} type="text" value={title} placeholder="Opcional" onChange={(event) => setTitle(event.target.value)} disabled={disabled} /></label>
      </div>}

      {error ? <p className={styles.error} role="alert" id={`${id}-error`}>{error}</p> : null}
      <footer className={styles.footer}>
        {editing ? <button className={styles.remove} type="button" disabled={disabled} onClick={() => apply(() => kind === 'link' ? actions.onRemoveLink() : kind === 'image' ? actions.onRemoveImage() : actions.onTable('delete-table'))}>{kind === 'table' ? 'Eliminar tabla' : `Quitar ${noun}`}</button> : null}
        <div className={styles.finish}>
          <button type="button" onClick={dismiss}>{kind === 'table' && editing ? 'Cerrar' : 'Cancelar'}</button>
          {kind !== 'table' || !editing ? <button className={styles.primary} type="submit" disabled={disabled}>{editing ? 'Aplicar' : 'Insertar'}</button> : null}
        </div>
      </footer>
    </form>
  </dialog>
}
