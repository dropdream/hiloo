import { closeHistory } from '@milkdown/kit/prose/history'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorProps } from '@milkdown/kit/prose/view'
import { safeImage } from '../../shared/markdown'
import { renderMermaid } from './mermaid-renderer'

export function editorNodeViews(editable: () => boolean, documentId: () => string | undefined): EditorProps['nodeViews'] {
  return {
    code_block(initial) {
      let node = initial
      let version = 0
      let destroyed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const dom = document.createElement('div')
      const preview = document.createElement('div')
      preview.contentEditable = 'false'
      const image = document.createElement('img')
      image.alt = 'Diagrama de flujo Mermaid'
      image.draggable = false
      image.hidden = true
      const status = document.createElement('p')
      status.setAttribute('role', 'status')
      preview.append(image, status)
      const details = document.createElement('details')
      const summary = document.createElement('summary')
      summary.contentEditable = 'false'
      summary.textContent = 'Código Mermaid'
      const pre = document.createElement('pre')
      const contentDOM = document.createElement('code')
      pre.append(contentDOM)
      details.append(summary, pre)
      const failure = (message: string) => {
        dom.dataset.loading = 'false'
        dom.dataset.rendered = 'false'
        image.hidden = true
        status.hidden = false
        status.textContent = message
        details.open = true
      }
      const render = () => {
        clearTimeout(timer)
        const current = ++version
        if (node.attrs.language) pre.dataset.language = String(node.attrs.language)
        else delete pre.dataset.language
        const mermaid = String(node.attrs.language ?? '').toLowerCase() === 'mermaid'
        dom.className = mermaid ? 'document-mermaid' : 'document-code'
        if (!mermaid) {
          dom.dataset.loading = 'false'
          preview.remove()
          details.remove()
          dom.append(pre)
          return
        }
        details.append(pre)
        dom.append(preview, details)
        dom.dataset.loading = 'true'
        dom.dataset.rendered = 'false'
        image.hidden = true
        image.removeAttribute('src')
        status.hidden = false
        status.textContent = 'Preparando diagrama…'
        const source = node.textContent
        timer = setTimeout(() => {
          void renderMermaid(source)
            .then((src) => {
              if (destroyed || current !== version) return
              image.onload = () => {
                if (destroyed || current !== version) return
                dom.dataset.loading = 'false'
                dom.dataset.rendered = 'true'
                image.hidden = false
                status.hidden = true
              }
              image.onerror = () => {
                if (!destroyed && current === version) failure('No se pudo cargar el diagrama. El código se conserva.')
              }
              image.src = src
            })
            .catch((error: unknown) => {
              if (!destroyed && current === version)
                failure(
                  error instanceof Error && /^(El flujo|Las directivas|Las imágenes|Solo se muestran)/.test(error.message)
                    ? error.message
                    : 'No se pudo dibujar el flujo Mermaid. Revisa el código; su contenido se conserva.'
                )
            })
        }, 150)
      }
      render()
      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== node.type) return false
          const changed = next.textContent !== node.textContent || next.attrs.language !== node.attrs.language
          node = next
          if (changed) render()
          return true
        },
        stopEvent: (event) => event.target === summary || preview.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) => mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
        destroy() {
          destroyed = true
          version++
          clearTimeout(timer)
          image.onload = null
          image.onerror = null
        }
      }
    },
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
        dom,
        contentDOM,
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
        if (!editable() || pos === undefined) {
          render()
          return
        }
        view.dispatch(closeHistory(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: checkbox.checked })))
      })
      render()
      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          render()
          return true
        },
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
      // Volver del diálogo puede parecer un doble clic; selecciona la imagen.
      dom.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || !editable()) return
        const pos = getPos()
        if (pos === undefined) return
        event.preventDefault()
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
        view.focus()
      })
      dom.addEventListener('click', (event) => {
        if (event.button === 0) event.preventDefault()
      })
      const image = document.createElement('img')
      image.draggable = false
      const fallback = document.createElement('span')
      fallback.className = 'image-fallback'
      dom.append(image, fallback)
      const unavailable = () => {
        image.hidden = true
        fallback.hidden = false
      }
      image.addEventListener('error', () => {
        dom.dataset.loading = 'false'
        unavailable()
      })
      image.addEventListener('load', () => {
        dom.dataset.loading = 'false'
        image.hidden = false
        fallback.hidden = true
      })
      const render = async () => {
        const current = ++version
        dom.dataset.loading = 'true'
        image.alt = String(node.attrs.alt ?? '')
        image.title = String(node.attrs.title ?? '')
        fallback.textContent = `Imagen no disponible: ${node.attrs.alt || node.attrs.src || 'sin dirección'}`
        unavailable()
        image.removeAttribute('src')
        const src = String(node.attrs.src ?? '')
        if (!safeImage(src)) {
          dom.dataset.loading = 'false'
          return
        }
        try {
          const id = documentId()
          const resolved = /^https?:/i.test(src) ? src : id ? await window.documents.imageSource(id, src) : null
          if (!destroyed && current === version) {
            if (resolved) image.src = resolved
            else dom.dataset.loading = 'false'
          }
        } catch {
          if (!destroyed && current === version) dom.dataset.loading = 'false'
        }
      }
      const unsubscribe = window.documents.onDocument((snapshot) => {
        if (snapshot.id === documentId() && snapshot.hasFile && !/^https?:/i.test(String(node.attrs.src))) void render()
      })
      void render()
      return {
        dom,
        stopEvent: (event) =>
          editable() &&
          event instanceof MouseEvent &&
          event.button === 0 &&
          (event.type === 'mousedown' || event.type === 'click' || event.type === 'dblclick'),
        update(next) {
          if (next.type !== node.type) return false
          const changed = next.attrs.src !== node.attrs.src || next.attrs.alt !== node.attrs.alt || next.attrs.title !== node.attrs.title
          node = next
          if (changed) void render()
          return true
        },
        ignoreMutation: () => true,
        destroy() {
          destroyed = true
          version++
          unsubscribe()
        }
      }
    }
  }
}
