import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { AllSelection, NodeSelection, Selection, TextSelection, type Command, type EditorState } from '@milkdown/kit/prose/state'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import { safeImage, safeLink } from '../../shared/markdown'

export type TableAction =
  | 'row-before'
  | 'row-after'
  | 'column-before'
  | 'column-after'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'
  | 'align-left'
  | 'align-center'
  | 'align-right'
export interface LinkValue {
  href: string
  title: string
  text: string
  fallbackText?: string
}
export interface ImageValue {
  src: string
  alt: string
  title: string
}

export function selectedLink(state: EditorState) {
  const { $from, from, to } = state.selection
  const type = state.schema.marks.link
  let start = $from.start()
  let found: { from: number; to: number; mark: ReturnType<typeof type.create> } | null = null
  $from.parent.forEach((node, offset) => {
    const mark = type.isInSet(node.marks)
    const pos = start + offset
    if (mark && pos <= from && pos + node.nodeSize >= from && !found) found = { from: pos, to: pos + node.nodeSize, mark }
  })
  if (!found) return null
  const range = found as { from: number; to: number; mark: ReturnType<typeof type.create> }
  let previous = -1
  while (previous !== range.from) {
    previous = range.from
    $from.parent.forEach((node, offset) => {
      const pos = start + offset
      if (pos + node.nodeSize === range.from && range.mark.isInSet(node.marks)) range.from = pos
      if (pos === range.to && range.mark.isInSet(node.marks)) range.to += node.nodeSize
    })
  }
  if (to > range.to) return null
  return {
    ...range,
    value: { href: String(range.mark.attrs.href ?? ''), title: String(range.mark.attrs.title ?? ''), text: state.doc.textBetween(range.from, range.to) }
  }
}

export function selectedImage(state: EditorState) {
  const selection = state.selection
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return null
  return {
    from: selection.from,
    node: selection.node,
    value: { src: String(selection.node.attrs.src ?? ''), alt: String(selection.node.attrs.alt ?? ''), title: String(selection.node.attrs.title ?? '') }
  }
}

export function setLink(value: LinkValue): Command {
  return (state, dispatch) => {
    const href = value.href.trim()
    if (!href || !safeLink(href)) return false
    const existing = selectedLink(state)
    const { from, to } =
      existing ?? (state.selection instanceof AllSelection ? { from: Selection.atStart(state.doc).from, to: Selection.atEnd(state.doc).to } : state.selection)
    const $from = state.doc.resolve(from)
    if (!$from.parent.isTextblock || !$from.sameParent(state.doc.resolve(to))) return false
    let containsImage = false
    state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === 'image') containsImage = true
    })
    if (containsImage) return false
    const mark = state.schema.marks.link.create({ href, title: value.title || null })
    const currentText = state.doc.textBetween(from, to)
    const text = value.text || currentText || value.fallbackText || href
    const tr = state.tr
    if (text !== currentText || from === to) {
      const marks = (state.storedMarks ?? $from.nodeAfter?.marks ?? $from.marks()).filter((item) => item.type !== state.schema.marks.link)
      tr.replaceWith(from, to, state.schema.text(text, mark.addToSet(marks)))
    } else tr.removeMark(from, to, state.schema.marks.link).addMark(from, to, mark)
    tr.setSelection(TextSelection.create(tr.doc, from, from + text.length)).removeStoredMark(state.schema.marks.link)
    dispatch?.(tr.scrollIntoView())
    return true
  }
}

export const removeLink: Command = (state, dispatch) => {
  const range = selectedLink(state) ?? state.selection
  if (range.from === range.to) return false
  dispatch?.(state.tr.removeMark(range.from, range.to, state.schema.marks.link).removeStoredMark(state.schema.marks.link))
  return true
}

export function setImage(value: ImageValue): Command {
  return (state, dispatch) => {
    const src = value.src.trim()
    if (!src || !safeImage(src)) return false
    const selected = selectedImage(state)
    const attrs = { src, alt: value.alt, title: value.title || null }
    const tr = selected ? state.tr.setNodeMarkup(selected.from, undefined, attrs) : state.tr.replaceSelectionWith(state.schema.nodes.image.create(attrs))
    dispatch?.(tr.scrollIntoView())
    return true
  }
}

export const removeImage: Command = (state, dispatch) => {
  if (!selectedImage(state)) return false
  dispatch?.(state.tr.deleteSelection().scrollIntoView())
  return true
}

export const toggleTask: Command = (state, dispatch) => {
  const positions: number[] = []
  const { from, to, $from } = state.selection
  if (from === to) {
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'list_item') {
        positions.push($from.before(depth))
        break
      }
    }
  } else
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'list_item') return
      let selectedContent = false
      node.forEach((child, offset) => {
        const start = pos + 1 + offset
        if (child.isTextblock && start < to && start + child.nodeSize > from) selectedContent = true
      })
      if (selectedContent) positions.push(pos)
    })
  if (positions.length) {
    const remove = positions.every((pos) => state.doc.nodeAt(pos)?.attrs.checked != null)
    const tr = state.tr
    positions.forEach((pos) => {
      const attrs = tr.doc.nodeAt(pos)!.attrs
      tr.setNodeMarkup(pos, undefined, { ...attrs, checked: remove ? null : (attrs.checked ?? false) })
    })
    dispatch?.(tr)
    return true
  }
  return wrapInList(state.schema.nodes.bullet_list)(
    state,
    dispatch
      ? (tr) => {
          tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
            if (node.type.name === 'list_item') tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false })
          })
          dispatch(tr)
        }
      : undefined
  )
}

function tablePosition(state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table')
      return { node: $from.node(depth), pos: $from.before(depth), row: $from.index(depth), column: $from.depth > depth + 1 ? $from.index(depth + 1) : 0 }
  }
  return null
}

export function insertTable(rows: number, columns: number): Command {
  return (state, dispatch) => {
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 50 || columns < 1 || columns > 20 || tablePosition(state)) return false
    const nodes = state.schema.nodes
    const content = Array.from({ length: rows }, (_, row) =>
      nodes[row ? 'table_row' : 'table_header_row'].create(
        null,
        Array.from({ length: columns }, () => nodes[row ? 'table_cell' : 'table_header'].createAndFill({ alignment: null })!)
      )
    )
    const tr = state.tr.replaceSelectionWith(nodes.table.create(null, content))
    // El mapeo de pasos permite localizar la tabla recién insertada.
    let inserted = -1
    tr.doc.descendants((node, pos) => {
      if (node.type.name === 'table' && pos >= tr.mapping.map(state.selection.from, -1) - 1 && inserted < 0) inserted = pos
    })
    if (inserted >= 0) tr.setSelection(TextSelection.create(tr.doc, inserted + 4))
    dispatch?.(tr.scrollIntoView())
    return true
  }
}

export function editTable(action: TableAction): Command {
  return (state, dispatch) => {
    const found = tablePosition(state)
    if (!found) return false
    const { node, pos } = found
    let row = Math.min(found.row, node.childCount - 1)
    let column = Math.min(found.column, node.firstChild!.childCount - 1)
    const rows: ProseNode[][] = []
    node.forEach((line) => {
      const cells: ProseNode[] = []
      line.forEach((cell) => cells.push(cell))
      rows.push(cells)
    })
    if (action === 'delete-table' || (action === 'delete-row' && rows.length === 1) || (action === 'delete-column' && rows[0].length === 1)) {
      dispatch?.(state.tr.delete(pos, pos + node.nodeSize).scrollIntoView())
      return true
    }
    const nodes = state.schema.nodes
    const empty = (alignment: unknown) => nodes.table_cell.createAndFill({ alignment })!
    if (action === 'row-before' || action === 'row-after') {
      const at = row + (action === 'row-after' ? 1 : 0)
      rows.splice(
        at,
        0,
        rows[0].map((cell) => empty(cell.attrs.alignment))
      )
      row = at
    } else if (action === 'column-before' || action === 'column-after') {
      const at = column + (action === 'column-after' ? 1 : 0)
      rows.forEach((cells) => cells.splice(at, 0, empty(null)))
      column = at
    } else if (action === 'delete-row') {
      rows.splice(row, 1)
      row = Math.min(row, rows.length - 1)
    } else if (action === 'delete-column') {
      rows.forEach((cells) => cells.splice(column, 1))
      column = Math.min(column, rows[0].length - 1)
    } else if (action.startsWith('align-'))
      rows.forEach((cells) => {
        const cell = cells[column]
        cells[column] = cell.type.create({ ...cell.attrs, alignment: action.slice(6) }, cell.content)
      })
    const content = rows.map((cells, index) =>
      nodes[index ? 'table_row' : 'table_header_row'].create(
        null,
        cells.map((cell) => nodes[index ? 'table_cell' : 'table_header'].create(cell.attrs, cell.content))
      )
    )
    const table = nodes.table.create(node.attrs, content)
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, table)
    const caret =
      pos + 4 + content.slice(0, row).reduce((sum, line) => sum + line.nodeSize, 0) + rows[row].slice(0, column).reduce((sum, cell) => sum + cell.nodeSize, 0)
    tr.setSelection(Selection.near(tr.doc.resolve(caret)))
    dispatch?.(tr.scrollIntoView())
    return true
  }
}
