import { useEffect, useRef, useState } from 'react'
import { Editor, defaultValueCtx, rootCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark, imageSchema } from '@milkdown/kit/preset/commonmark'
import { gfm, tableSchema } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { undo, redo, undoDepth, redoDepth, closeHistory } from '@milkdown/kit/prose/history'
import { AllSelection, Plugin, Selection, TextSelection, type Command, type EditorState } from '@milkdown/kit/prose/state'
import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands'
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list'
import { $prose } from '@milkdown/kit/utils'
import { maxDocumentBytes } from '../../shared/documents'
import { markdownProblem, markdownSignature } from '../../shared/markdown'
import { editTable, insertTable, removeImage, removeLink, selectedImage, selectedLink, setImage, setLink, toggleTask, type TableAction, type LinkValue, type ImageValue } from './editor-actions'
import { editorNodeViews } from './editor-node-views'
import styles from './Editor.module.css'

export type { TableAction } from './editor-actions'
export type Format = 'bold' | 'italic' | 'strike' | 'task' | 'bullet' | 'ordered' | 'quote' | 'undo' | 'redo' | 'block'
export interface SelectionState {
  bold: boolean
  italic: boolean
  strike: boolean
  task: boolean
  table: boolean
  link: LinkValue | null
  image: ImageValue | null
  bullet: boolean
  ordered: boolean
  quote: boolean
  block: string
  undo: boolean
  redo: boolean
}
export const emptySelection: SelectionState = { bold: false, italic: false, strike: false, task: false, table: false, link: null, image: null, bullet: false, ordered: false, quote: false, block: '0', undo: false, redo: false }
export interface EditorController {
  format(action: Format, level?: string): void
  markSaved(source: string): boolean
  replaceSource(source: string): string | null
  visualReady(): boolean
  setEditable(value: boolean): void
  focus(): void
  insertTable(rows: number, columns: number): boolean
  table(action: TableAction): boolean
  setLink(value: LinkValue): boolean
  removeLink(): boolean
  setImage(value: ImageValue): boolean
  removeImage(): boolean
}

function selectionState(state: EditorState): SelectionState {
  const { from, to, empty } = state.selection
  const $from = state.selection instanceof AllSelection ? Selection.atStart(state.doc).$from : state.selection.$from
  const mark = (name: string) => empty
    ? Boolean(state.schema.marks[name].isInSet(state.storedMarks ?? $from.marks()))
    : state.doc.rangeHasMark(from, to, state.schema.marks[name])
  const ancestors = Array.from({ length: $from.depth }, (_, index) => $from.node(index + 1).type.name)
  return {
    bold: mark('strong'), italic: mark('emphasis'), strike: mark('strike_through'),
    task: Array.from({ length: $from.depth }, (_, index) => $from.node(index + 1)).some((node) => node.type.name === 'list_item' && node.attrs.checked != null),
    table: ancestors.includes('table'), link: selectedLink(state)?.value ?? null, image: selectedImage(state)?.value ?? null,
    bullet: ancestors.includes('bullet_list'), ordered: ancestors.includes('ordered_list'), quote: ancestors.includes('blockquote'),
    block: $from.parent.type.name === 'heading' ? String($from.parent.attrs.level) : '0',
    undo: undoDepth(state) > 0, redo: redoDepth(state) > 0
  }
}

interface Props {
  documentId?: string
  source: string
  savedSource: string
  onReady(controller: EditorController): void
  onChange(markdown: string, clean: boolean): void
  onSelection(state: SelectionState): void
  onError(message: string): void
}

export function MarkdownEditor(props: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const initialSource = useRef(props.source)
  const initialSavedSource = useRef(props.savedSource)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    const host = document.createElement('div')
    mount.current!.append(host)
    let disposed = false
    let ready = false
    let editable = true
    let baseline = ''
    let lastSelection = ''
    let replacing = false
    let conversionBlocked = false
    const reportSelection = (state: EditorState) => {
      const value = selectionState(state)
      const key = JSON.stringify(value)
      if (key !== lastSelection && !disposed) { lastSelection = key; callbacks.current.onSelection(value) }
    }
    const observer = $prose((ctx) => new Plugin({
      filterTransaction: (transaction) => {
        if (!ready || !transaction.docChanged) return true
        const size = new TextEncoder().encode(ctx.get(serializerCtx)(transaction.doc)).length
        if (size <= maxDocumentBytes) return true
        callbacks.current.onError('El documento supera el límite de 2 MB. La última edición no se aplicó.')
        return false
      },
      view: () => ({ update: (view, previous) => {
        if (!ready || disposed) return
        reportSelection(view.state)
        if (!replacing && !view.state.doc.eq(previous.doc)) {
          const markdown = ctx.get(serializerCtx)(view.state.doc)
          callbacks.current.onChange(markdown, markdown === baseline)
        }
      } })
    }))

    const editor = Editor.make().config((ctx) => {
      // Markdown image titles are optional: remark represents their absence as null.
      ctx.update(imageSchema.key, (previous) => (context) => {
        const schema = previous(context)
        return { ...schema, attrs: { ...schema.attrs, title: { default: null, validate: 'string|null' } } }
      })
      // GFM also permits a table containing only its header.
      ctx.update(tableSchema.key, (previous) => (context) => ({ ...previous(context), content: 'table_header_row table_row*' }))
      ctx.set(rootCtx, host)
      ctx.set(defaultValueCtx, initialSource.current)
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        attributes: { class: 'hiloo-document', role: 'textbox', 'aria-label': 'Documento Markdown', 'aria-multiline': 'true', spellcheck: 'false' },
        editable: () => editable,
        nodeViews: editorNodeViews(() => editable, () => callbacks.current.documentId),
        handleClick: (_view, _position, event) => {
          if ((event.target as Element).closest('a')) { event.preventDefault(); return true }
          return false
        },
        handleDrop: (_view, event) => { event.preventDefault(); return true },
        // Pegado de texto sin importar HTML, imágenes ni contenido activo.
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData('text/plain')
          if (text === undefined) return true
          event.preventDefault()
          const paragraphs = text.replace(/\r\n/g, '\n').split('\n').map((line) => view.state.schema.nodes.paragraph.create(null, line ? view.state.schema.text(line) : null))
          if (paragraphs.length === 1) view.dispatch(view.state.tr.insertText(text))
          else {
            const document = view.state.schema.nodes.doc.create(null, paragraphs)
            view.dispatch(view.state.tr.replaceSelection(document.slice(0, document.content.size)).scrollIntoView())
          }
          return true
        }
      }))
    }).use(commonmark).use(gfm).use(history).use(observer)

    const created = editor.create().then(() => {
      if (disposed) return
      const view = editor.ctx.get(editorViewCtx)
      const serialize = () => editor.ctx.get(serializerCtx)(view.state.doc)
      const canonical = serialize()
      const savedBaseline = (source: string) => editor.ctx.get(serializerCtx)(editor.ctx.get(parserCtx)(source))
      baseline = savedBaseline(initialSavedSource.current)
      if (markdownSignature(initialSource.current) !== markdownSignature(canonical)) {
        editable = false
        conversionBlocked = true
        setBlocked(true)
        callbacks.current.onError('La conversión visual cambiaría la estructura de este archivo. Se muestra el original en solo lectura; no se ha modificado.')
      }
      ready = true
      reportSelection(view.state)
      const run = (command: Command, error: string): boolean => {
        if (!editable) return false
        try {
          const applied = command(view.state, (transaction) => view.dispatch(closeHistory(transaction)), view)
          if (!applied) callbacks.current.onError(error)
          else view.focus()
          return applied
        } catch {
          callbacks.current.onError(error)
          return false
        }
      }
      callbacks.current.onReady({
        visualReady: () => !conversionBlocked,
        replaceSource: (source) => {
          try {
            const problem = markdownProblem(source)
            if (problem) return `${problem.split('. El archivo')[0]}. El código se conserva en Markdown; corrígelo para usar la vista impresión o imprimir.`
            const next = editor.ctx.get(parserCtx)(source)
            const canonical = editor.ctx.get(serializerCtx)(next)
            if (new TextEncoder().encode(canonical).length > maxDocumentBytes) {
              return 'La conversión supera el límite de 2 MB. El código se conserva en Markdown; reduce el contenido antes de cambiar de vista o imprimir.'
            }
            if (markdownSignature(source) !== markdownSignature(canonical)) {
              return 'La vista impresión cambiaría la estructura del contenido. El código se conserva en Markdown; revísalo antes de cambiar de vista o imprimir.'
            }
            // Milkdown assigns heading IDs after dispatch; compare serialized
            // content so those visual attributes do not reset history or reject edits.
            const replacingContent = serialize() !== canonical
            if (replacingContent) {
              replacing = true
              try { view.dispatch(closeHistory(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content))) }
              finally { replacing = false }
            }
            if (serialize() !== canonical) return 'No se pudo aplicar la conversión. El código se conserva en Markdown; revísalo antes de cambiar de vista o imprimir.'
            // Keep the first visual keystroke separate from the source replacement.
            if (replacingContent) view.dispatch(closeHistory(view.state.tr))
            conversionBlocked = false
            setBlocked(false)
            return null
          } catch { return 'No se pudo convertir el código. El contenido se conserva en Markdown para que puedas corregirlo.' }
        },
        markSaved: (source) => { baseline = savedBaseline(source); return serialize() === baseline },
        focus: () => view.focus(),
        setEditable: (value) => {
          editable = value && !conversionBlocked
          view.setProps({ editable: () => editable })
          host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => { checkbox.disabled = !editable })
        },
        insertTable: (rows, columns) => run(insertTable(rows, columns), 'No se pudo insertar la tabla. Usa entre 1 y 50 filas y entre 1 y 20 columnas fuera de otra tabla.'),
        table: (action) => run(editTable(action), 'Selecciona una celda para editar la tabla.'),
        setLink: (value) => run(setLink(value), 'No se pudo aplicar el enlace. Revisa la dirección y selecciona texto dentro de un mismo párrafo.'),
        removeLink: () => run(removeLink, 'Selecciona el enlace que quieres quitar.'),
        setImage: (value) => run(setImage(value), 'No se pudo insertar la imagen. Usa una dirección HTTP(S) o una ruta relativa.'),
        removeImage: () => run(removeImage, 'Selecciona la imagen que quieres quitar.'),
        format: (action, level) => {
          if (!editable) return
          if (view.state.selection instanceof AllSelection) {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Selection.atStart(view.state.doc).from, Selection.atEnd(view.state.doc).to)))
          }
          const schema = view.state.schema
          const selected = selectionState(view.state)
          let command: Command
          switch (action) {
            case 'bold': command = toggleMark(schema.marks.strong); break
            case 'italic': command = toggleMark(schema.marks.emphasis); break
            case 'strike': command = toggleMark(schema.marks.strike_through); break
            case 'task': command = toggleTask; break
            case 'bullet': command = selected.bullet ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes.bullet_list); break
            case 'ordered': command = selected.ordered ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes.ordered_list); break
            case 'quote': command = selected.quote ? lift : wrapIn(schema.nodes.blockquote); break
            case 'undo': command = undo; break
            case 'redo': command = redo; break
            case 'block': command = Number(level) ? setBlockType(schema.nodes.heading, { level: Number(level) }) : setBlockType(schema.nodes.paragraph); break
          }
          if (action !== 'undo' && action !== 'redo') view.dispatch(closeHistory(view.state.tr))
          command(view.state, (transaction) => view.dispatch(transaction), view)
          view.focus()
        }
      })
    }).catch(() => {
      if (!disposed) { setBlocked(true); callbacks.current.onError('No se pudo iniciar la edición visual. El contenido original permanece intacto.') }
    })
    return () => {
      disposed = true
      host.remove()
      void created.then(() => editor.destroy())
    }
  }, [])

  return <div className={styles.surface}>
    <div ref={mount} hidden={blocked} />
    {blocked ? <pre className={styles.original} aria-label="Original en solo lectura">{initialSource.current}</pre> : null}
  </div>
}
