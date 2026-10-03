import { closeHistory } from '@milkdown/kit/prose/history'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorProps } from '@milkdown/kit/prose/view'
import { safeImage } from '../../shared/markdown'

export function editorNodeViews(editable: () => boolean, documentId: () => string | undefined): EditorProps['nodeViews'] {
  return {
    table(initial) {
      const dom = document.createElement('div')
      dom.className = 'document-table'
      dom.tabIndex = 0
      dom.setAttribute('role', 'region')
      dom.setAttribute('aria-label', 'Tabla con desplazamiento horizontal')
      const table = document.createElement('table')
      const contentDOM = document.createElement('tbody')
      const resize = (columns: number) => table.style.setProperty('--table-columns', String(columns))
      resize(initial.firstChild?.childCount ?? 1)
      table.append(contentDOM)
      dom.append(table)
      return {
        dom, contentDOM,
        update(next) {
          if (next.type !== initial.type) return false
          resize(next.firstChild?.childCount ?? 1)
          return true
        },
        ignoreMutation: (mutation) => mutation.type === 'attributes' && mutation.target === table
      }
    },
    list_item(initial, view, getPos) {
      let node = initial
      const dom = document.createElement('li')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.contentEditable = 'false'
      const contentDOM = document.createElement('div')
      contentDOM.className = 'list-item-content'
      dom.append(checkbox, contentDOM)
      const render = () => {
        const task = node.attrs.checked != null
        dom.dataset.itemType = task ? 'task' : 'list'
        dom.dataset.checked = task ? String(node.attrs.checked) : ''
        checkbox.hidden = !task
        checkbox.checked = Boolean(node.attrs.checked)
        checkbox.disabled = !editable()
        checkbox.setAttribute('aria-label', `${node.attrs.checked ? 'Marcar pendiente' : 'Completar tarea'}: ${node.textContent || 'Tarea sin texto'}`)
      }
      checkbox.addEventListener('change', () => {
        const pos = getPos()
        if (!editable() || pos === undefined) { render(); return }
        view.dispatch(closeHistory(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: checkbox.checked })))
      })
      render()
      return {
        dom, contentDOM,
        update(next) { if (next.type !== node.type) return false; node = next; render(); return true },
        stopEvent: (event) => event.target === checkbox,
        ignoreMutation: (mutation) => mutation.type !== 'selection' && (mutation.target === checkbox || mutation.target === dom)
      }
    },
    image(initial, view, getPos) {
      let node = initial
      let version = 0
      let destroyed = false
      const dom = document.createElement('span')
      dom.className = 'document-image'
      dom.contentEditable = 'false'
      // A quick return from an image dialog can look like a double click to
      // ProseMirror. Select the atom directly for every primary-button click.
      dom.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || !editable()) return
        const pos = getPos()
        if (pos === undefined) return
        event.preventDefault()
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
        view.focus()
      })
      dom.addEventListener('click', (event) => { if (event.button === 0) event.preventDefault() })
      const image = document.createElement('img')
      image.draggable = false
      const fallback = document.createElement('span')
      fallback.className = 'image-fallback'
      dom.append(image, fallback)
      const unavailable = () => { image.hidden = true; fallback.hidden = false }
      image.addEventListener('error', unavailable)
      image.addEventListener('load', () => { image.hidden = false; fallback.hidden = true })
      const render = async () => {
        const current = ++version
        image.alt = String(node.attrs.alt ?? '')
        image.title = String(node.attrs.title ?? '')
        fallback.textContent = `Imagen no disponible: ${node.attrs.alt || node.attrs.src || 'sin dirección'}`
        unavailable()
        image.removeAttribute('src')
        const src = String(node.attrs.src ?? '')
        if (!safeImage(src)) return
        try {
          const id = documentId()
          const resolved = /^https?:/i.test(src) ? src : id ? await window.documents.imageSource(id, src) : null
          if (!destroyed && current === version && resolved) image.src = resolved
        } catch { /* Keep the alt text and original Markdown when a file is unavailable. */ }
      }
      const unsubscribe = window.documents.onDocument((snapshot) => {
        if (snapshot.id === documentId() && snapshot.hasFile && !/^https?:/i.test(String(node.attrs.src))) void render()
      })
      void render()
      return {
        dom,
        stopEvent: (event) => editable() && event instanceof MouseEvent && event.button === 0 && (event.type === 'mousedown' || event.type === 'click' || event.type === 'dblclick'),
        update(next) {
          if (next.type !== node.type) return false
          const changed = next.attrs.src !== node.attrs.src || next.attrs.alt !== node.attrs.alt || next.attrs.title !== node.attrs.title
          node = next
          if (changed) void render()
          return true
        },
        ignoreMutation: () => true,
        destroy() { destroyed = true; version++; unsubscribe() }
      }
    }
  }
}
