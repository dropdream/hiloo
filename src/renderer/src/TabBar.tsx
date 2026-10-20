import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { DocumentTab } from '../../shared/documents'
import { Icon } from './Icon'
import styles from './TabBar.module.css'

interface Props {
  tabs: DocumentTab[]
  activeId: string
  busy: boolean
  onActivate(id: string): void
  onClose(id: string): void
}

export function TabBar({ tabs, activeId, busy, onActivate, onClose }: Props) {
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = list.current
    if (!element) return
    const reveal = () =>
      element.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    reveal()
    // Al estrechar la ventana la pestaña activa sigue a la vista.
    const observer = new ResizeObserver(reveal)
    observer.observe(element)
    return () => observer.disconnect()
  }, [activeId, tabs.length])

  useEffect(() => {
    const element = list.current
    if (!element) return
    // La rueda vertical desplaza la barra en horizontal.
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY || element.scrollWidth <= element.clientWidth) return
      event.preventDefault()
      element.scrollLeft += event.deltaY
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  // Flechas, Inicio y Fin mueven el foco; Intro o Espacio activan; Supr cierra.
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    const index = items.indexOf(globalThis.document.activeElement as HTMLButtonElement)
    if (index < 0) return
    const target =
      event.key === 'ArrowRight' ? items[(index + 1) % items.length]
        : event.key === 'ArrowLeft' ? items[(index - 1 + items.length) % items.length]
          : event.key === 'Home' ? items[0]
            : event.key === 'End' ? items.at(-1)
              : null
    if (target) {
      event.preventDefault()
      target.focus()
    } else if (event.key === 'Delete' && !busy) {
      event.preventDefault()
      onClose(tabs[index].id)
    }
  }

  return (
    <div ref={list} role="tablist" aria-label="Documentos abiertos" className={styles.tabs} onKeyDown={keyDown}>
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <div key={tab.id} role="presentation" className={styles.tab} data-active={active || undefined}>
            <button
              type="button"
              role="tab"
              className={styles.label}
              aria-selected={active}
              aria-controls="document-workspace"
              aria-description={tab.dirty ? 'Cambios sin guardar' : undefined}
              data-dirty={tab.dirty || undefined}
              tabIndex={active ? 0 : -1}
              title={tab.path ?? tab.name}
              disabled={busy && !active}
              onClick={() => onActivate(tab.id)}
              onMouseDown={(event) => {
                // Evita el desplazamiento automático del botón central.
                if (event.button === 1) event.preventDefault()
              }}
              onAuxClick={(event) => {
                if (event.button === 1 && !busy) onClose(tab.id)
              }}
            >
              <span className={styles.name}>{tab.name}</span>
              {tab.dirty ? <span className={styles.dirty} aria-hidden="true" /> : null}
            </button>
            <button
              type="button"
              className={styles.close}
              aria-label={`Cerrar ${tab.name}`}
              title={`Cerrar ${tab.name} (Ctrl+W)`}
              tabIndex={-1}
              disabled={busy}
              onClick={() => onClose(tab.id)}
            >
              <Icon name="close" width="12" height="12" strokeWidth="2" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
