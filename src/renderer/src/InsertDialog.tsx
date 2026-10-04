import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { safeImage, safeLink } from '../../shared/markdown'
import type { WorkspaceSnapshot } from '../../shared/workspace'
import type { SelectionState, TableAction } from './editor'
import styles from './InsertDialog.module.css'

export type InsertKind = 'link' | 'image' | 'table'

interface Props {
  kind: InsertKind
  selection: SelectionState
  workspace: WorkspaceSnapshot | null
  disabled: boolean
  onClose(): void
  onInsertTable(rows: number, columns: number): boolean
  onTable(action: TableAction): boolean
  onLink(value: { href: string; title: string; text: string; fallbackText?: string }): boolean
  onRemoveLink(): boolean
  onImage(value: { src: string; alt: string; title: string }): boolean
  onRemoveImage(): boolean
}

const tableGroups: { label: string; actions: [TableAction, string][] }[] = [
  { label: 'Filas', actions: [['row-before', 'Insertar fila antes'], ['row-after', 'Insertar fila después'], ['delete-row', 'Eliminar fila']] },
  { label: 'Columnas', actions: [['column-before', 'Insertar columna antes'], ['column-after', 'Insertar columna después'], ['delete-column', 'Eliminar columna']] },
  { label: 'Alineación de columna', actions: [['align-left', 'Alinear a la izquierda'], ['align-center', 'Centrar'], ['align-right', 'Alinear a la derecha']] }
]

const searchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es')

export function InsertDialog({ kind, selection, workspace, disabled, onClose, ...actions }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const noteSearch = useRef<HTMLInputElement>(null)
  const id = useId()
  const [url, setUrl] = useState(kind === 'link' ? selection.link?.href ?? '' : selection.image?.src ?? '')
  const [text, setText] = useState(kind === 'link' ? selection.link?.text ?? '' : selection.image?.alt ?? '')
  const [title, setTitle] = useState(kind === 'link' ? selection.link?.title ?? '' : selection.image?.title ?? '')
  const [rows, setRows] = useState('3')
  const [columns, setColumns] = useState('3')
  const [error, setError] = useState('')
  const [linkMode, setLinkMode] = useState<'note' | 'manual'>(() => kind === 'link' && workspace && !selection.link ? 'note' : 'manual')
  const [query, setQuery] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState('')
  const [resolving, setResolving] = useState(false)
  const requestSequence = useRef(0)
  const pending = useRef(false)
  const currentContext = useRef({ disabled, workspace, onLink: actions.onLink })
  const blocked = disabled || resolving
  const pickerActive = kind === 'link' && linkMode === 'note'
  const availableNotes = useMemo(() => workspace?.notes.filter((note) => note.id !== workspace.currentNoteId) ?? [], [workspace])
  const visibleNotes = useMemo(() => {
    const term = searchText(query.trim())
    return availableNotes.filter((note) => searchText(`${note.name} ${note.relativePath}`).includes(term))
  }, [availableNotes, query])
  const chosenNote = availableNotes.find((note) => note.id === selectedNoteId)
  const editing = kind === 'table' ? selection.table : Boolean(kind === 'link' ? selection.link : selection.image)
  const noun = kind === 'link' ? 'enlace' : kind === 'image' ? 'imagen' : 'tabla'

  useEffect(() => { currentContext.current = { disabled, workspace, onLink: actions.onLink } }, [disabled, workspace, actions.onLink])
  useEffect(() => {
    requestSequence.current++
    pending.current = false
    setResolving(false)
    setSelectedNoteId('')
    setError('')
  }, [workspace?.id, workspace?.currentNoteId])

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { requestSequence.current++; pending.current = false; element.close() }
  }, [])

  useEffect(() => {
    if (pickerActive && workspace?.currentNoteId) noteSearch.current?.focus()
  }, [pickerActive, workspace?.currentNoteId])

  const dismiss = () => {
    requestSequence.current++
    pending.current = false
    dialog.current?.close()
    onClose()
  }

  const apply = (action: () => boolean) => {
    if (disabled) return
    if (action()) dismiss()
    else setError('No se pudo aplicar el cambio en esta selección. Cierra el diálogo y selecciona el contenido que quieres editar.')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled || pending.current) return
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
    if (pickerActive) {
      if (!workspace?.currentNoteId) { setError('Guarda esta nota en el cuaderno antes de enlazar otra nota.'); return }
      if (!chosenNote) { setError('Selecciona la nota que quieres enlazar.'); return }
      const sourceId = workspace.currentNoteId
      const workspaceId = workspace.id
      const targetId = chosenNote.id
      const sequence = ++requestSequence.current
      pending.current = true
      setResolving(true)
      try {
        const result = await window.workspace.linkTo(targetId)
        if (sequence !== requestSequence.current) return
        const active = currentContext.current
        if (active.disabled || active.workspace?.id !== workspaceId || active.workspace.currentNoteId !== sourceId || !active.workspace.notes.some((note) => note.id === targetId)) {
          setSelectedNoteId('')
          setError('El cuaderno o la nota actual cambió. Selecciona la nota de nuevo.')
          return
        }
        if (result.status === 'error') { setError(result.message); return }
        if (!safeLink(result.href)) { setError('No se pudo preparar un enlace válido para esta nota.'); return }
        if (active.onLink({ href: result.href, text, title, fallbackText: result.note.name.replace(/\.(?:md|markdown)$/i, '') })) dismiss()
        else setError('No se pudo aplicar el cambio en esta selección. Cierra el diálogo y selecciona el contenido que quieres editar.')
      } catch {
        if (sequence === requestSequence.current) setError('No se pudo preparar el enlace. Vuelve a intentarlo.')
      } finally {
        if (sequence === requestSequence.current) { pending.current = false; setResolving(false) }
      }
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
    <form onSubmit={(event) => { void submit(event) }} aria-busy={resolving}>
      <h2 id={`${id}-heading`}>{editing ? 'Editar' : 'Insertar'} {noun}</h2>
      <p className={styles.help} id={`${id}-help`}>{kind === 'table'
        ? editing ? 'Los cambios se aplican a la celda, fila o columna seleccionada.' : 'La primera fila será la cabecera. Puedes añadir o quitar filas y columnas después.'
        : kind === 'link' ? 'Busca una nota y selecciónala para enlazarla, o usa una dirección web. Guarda los cambios para ver la conexión en Cerebro.' : 'Usa una URL o una ruta como imagenes/foto.png, relativa al archivo Markdown guardado.'}</p>

      {kind === 'link' ? <fieldset className={styles.linkModes} disabled={blocked}>
        <legend>Destino del enlace</legend>
        <label><input type="radio" name={`${id}-mode`} value="note" checked={linkMode === 'note'} onChange={() => { setLinkMode('note'); setError('') }} />Nota del cuaderno</label>
        <label><input type="radio" name={`${id}-mode`} value="manual" checked={linkMode === 'manual'} onChange={() => { setLinkMode('manual'); setError('') }} />Dirección web o manual</label>
      </fieldset> : null}

      {kind === 'table' ? editing ? <div className={styles.tableTools}>
        {tableGroups.map((group) => <fieldset key={group.label} disabled={blocked}><legend>{group.label}</legend><div className={styles.actionGrid}>
          {group.actions.map(([action, label]) => <button key={action} type="button" onClick={() => apply(() => actions.onTable(action))}>{label}</button>)}
        </div></fieldset>)}
      </div> : <div className={styles.dimensions}>
        <label htmlFor={`${id}-rows`}>Filas<input id={`${id}-rows`} type="number" min="1" max="20" required value={rows} onChange={(event) => setRows(event.target.value)} disabled={disabled} /></label>
        <label htmlFor={`${id}-columns`}>Columnas<input id={`${id}-columns`} type="number" min="1" max="10" required value={columns} onChange={(event) => setColumns(event.target.value)} disabled={disabled} /></label>
      </div> : <div className={styles.fields}>
        {pickerActive ? <div className={styles.notePicker}>
          {!workspace ? <p className={styles.pickerHelp}>Abre un cuaderno para elegir una de sus notas. También puedes usar una dirección web o manual.</p> : !workspace.currentNoteId ? <p className={styles.pickerHelp}>Guarda esta nota en el cuaderno antes de enlazar otra nota. También puedes usar una dirección web o manual.</p> : <>
            <label htmlFor={`${id}-search`}>Buscar nota para enlazar<input ref={noteSearch} id={`${id}-search`} type="search" value={query} placeholder="Nombre o carpeta…" autoComplete="off" disabled={blocked} onChange={(event) => setQuery(event.target.value)} /></label>
            <fieldset className={styles.noteOptions} disabled={blocked}>
              <legend>Notas del cuaderno</legend>
              {visibleNotes.length ? visibleNotes.map((note) => <label className={styles.noteOption} key={note.id}>
                <input type="radio" name={`${id}-note`} value={note.id} checked={selectedNoteId === note.id} aria-label={`Enlazar nota: ${note.relativePath}`} onChange={() => { setSelectedNoteId(note.id); setError('') }} />
                <span><span className={styles.noteName}>{note.name}</span><span className={styles.notePath}>{note.relativePath}</span></span>
              </label>) : <p className={styles.pickerHelp}>{availableNotes.length ? 'No hay notas que coincidan con la búsqueda.' : 'Este cuaderno aún no tiene otras notas para enlazar.'}</p>}
            </fieldset>
            {chosenNote ? <p className={styles.chosenNote}>Seleccionada: {chosenNote.relativePath}</p> : null}
          </>}
        </div> : <label htmlFor={`${id}-url`}>{kind === 'link' ? 'Dirección' : 'Origen'}<input id={`${id}-url`} type="text" required value={url} placeholder={kind === 'link' ? 'https://ejemplo.com' : 'https://… o imagenes/foto.png'} spellCheck={false} autoComplete="off" onChange={(event) => { setUrl(event.target.value); setError('') }} disabled={blocked} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} /></label>}
        <label htmlFor={`${id}-text`}>{kind === 'link' ? 'Texto' : 'Texto alternativo'}<input id={`${id}-text`} type="text" value={text} placeholder={kind === 'link' ? pickerActive ? 'Opcional · conserva el texto seleccionado' : 'Texto seleccionado o dirección' : 'Describe el contenido de la imagen'} onChange={(event) => setText(event.target.value)} disabled={blocked} /></label>
        <label htmlFor={`${id}-title`}>Título<input id={`${id}-title`} type="text" value={title} placeholder="Opcional" onChange={(event) => setTitle(event.target.value)} disabled={blocked} /></label>
      </div>}

      {error ? <p className={styles.error} role="alert" id={`${id}-error`}>{error}</p> : null}
      <footer className={styles.footer}>
        {editing ? <button className={styles.remove} type="button" disabled={blocked} onClick={() => apply(() => kind === 'link' ? actions.onRemoveLink() : kind === 'image' ? actions.onRemoveImage() : actions.onTable('delete-table'))}>{kind === 'table' ? 'Eliminar tabla' : `Quitar ${noun}`}</button> : null}
        <div className={styles.finish}>
          <button type="button" onClick={dismiss}>{kind === 'table' && editing ? 'Cerrar' : 'Cancelar'}</button>
          {kind !== 'table' || !editing ? <button className={styles.primary} type="submit" disabled={blocked || (pickerActive && (!workspace?.currentNoteId || !chosenNote))}>{resolving ? <><span className={styles.spinner} aria-hidden="true" />Preparando…</> : editing ? 'Aplicar' : 'Insertar'}</button> : null}
        </div>
      </footer>
    </form>
  </dialog>
}
