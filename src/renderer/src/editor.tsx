import { useEffect, useRef, useState } from 'react'
import { Editor, defaultValueCtx, rootCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { history } from '@milkdown/kit/plugin/history'
import { undo, redo, undoDepth, redoDepth, closeHistory } from '@milkdown/kit/prose/history'
import { AllSelection, Plugin, Selection, TextSelection, type Command, type EditorState } from '@milkdown/kit/prose/state'
import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands'
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list'
import { $prose } from '@milkdown/kit/utils'
import { maxDocumentBytes } from '../../shared/documents'
import { markdownSignature } from '../../shared/markdown'
import styles from './Editor.module.css'

export type Format = 'bold' | 'italic' | 'bullet' | 'ordered' | 'quote' | 'undo' | 'redo' | 'block'
export interface SelectionState {
  bold: boolean
  italic: boolean
  bullet: boolean
  ordered: boolean
  quote: boolean
  block: string
  undo: boolean
  redo: boolean
}
export const emptySelection: SelectionState = { bold: false, italic: false, bullet: false, ordered: false, quote: false, block: '0', undo: false, redo: false }
export interface EditorController {
  format(action: Format, level?: string): void
  markSaved(source: string): boolean
  setEditable(value: boolean): void
  focus(): void
}

function selectionState(state: EditorState): SelectionState {
  const { from, to, empty } = state.selection
  const $from = state.selection instanceof AllSelection ? Selection.atStart(state.doc).$from : state.selection.$from
  const mark = (name: string) => empty
    ? Boolean(state.schema.marks[name].isInSet(state.storedMarks ?? $from.marks()))
    : state.doc.rangeHasMark(from, to, state.schema.marks[name])
  const ancestors = Array.from({ length: $from.depth }, (_, index) => $from.node(index + 1).type.name)
  return {
    bold: mark('strong'), italic: mark('emphasis'),
    bullet: ancestors.includes('bullet_list'), ordered: ancestors.includes('ordered_list'), quote: ancestors.includes('blockquote'),
    block: $from.parent.type.name === 'heading' ? String($from.parent.attrs.level) : '0',
    undo: undoDepth(state) > 0, redo: redoDepth(state) > 0
  }
}

interface Props {
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
        if (!view.state.doc.eq(previous.doc)) {
          const markdown = ctx.get(serializerCtx)(view.state.doc)
          callbacks.current.onChange(markdown, markdown === baseline)
        }
      } })
    }))

    const editor = Editor.make().config((ctx) => {
      ctx.set(rootCtx, host)
      ctx.set(defaultValueCtx, initialSource.current)
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        attributes: { class: 'hiloo-document', role: 'textbox', 'aria-label': 'Documento Markdown', 'aria-multiline': 'true', spellcheck: 'false' },
        editable: () => editable,
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
    }).use(commonmark).use(history).use(observer)

    const created = editor.create().then(() => {
      if (disposed) return
      const view = editor.ctx.get(editorViewCtx)
      const serialize = () => editor.ctx.get(serializerCtx)(view.state.doc)
      const canonical = serialize()
      const savedBaseline = (source: string) => editor.ctx.get(serializerCtx)(editor.ctx.get(parserCtx)(source))
      baseline = savedBaseline(initialSavedSource.current)
      if (markdownSignature(initialSource.current) !== markdownSignature(canonical)) {
        editable = false
        setBlocked(true)
        callbacks.current.onError('La conversión visual cambiaría la estructura de este archivo. Se muestra el original en solo lectura; no se ha modificado.')
        return
      }
      ready = true
      reportSelection(view.state)
      callbacks.current.onReady({
        markSaved: (source) => { baseline = savedBaseline(source); return serialize() === baseline },
        focus: () => view.focus(),
        setEditable: (value) => { editable = value; view.setProps({ editable: () => editable }) },
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
