import { Icon } from './Icon'
import styles from './ZoomBar.module.css'

export const minZoom = 50
export const maxZoom = 200
export const zoomStep = 10

export const clampZoom = (value: number) => Math.min(maxZoom, Math.max(minZoom, Math.round(value)))

interface Props {
  zoom: number
  fit: boolean
  disabled: boolean
  onZoom(zoom: number): void
  onFit(): void
}

export function ZoomBar({ zoom, fit, disabled, onZoom, onFit }: Props) {
  return <div className={styles.bar} role="group" aria-label="Zoom del documento">
    <button type="button" className={styles.fit} disabled={disabled} aria-pressed={fit} aria-label="Ajustar a pantalla" title="Ajustar el documento al ancho de la ventana" onClick={onFit}>
      <Icon name="fit" /><span>Ajustar a pantalla</span>
    </button>
    <button type="button" className={styles.step} disabled={disabled || zoom <= minZoom} aria-label="Alejar" title="Alejar (Ctrl+-)" aria-keyshortcuts="Control+-" onClick={() => onZoom(Math.ceil(zoom / zoomStep - 1) * zoomStep)}><Icon name="minus" /></button>
    <input type="range" className={styles.slider} min={minZoom} max={maxZoom} step={zoomStep} value={zoom} disabled={disabled} aria-label="Zoom" aria-valuetext={`${zoom} %`} onChange={(event) => onZoom(Number(event.target.value))} />
    <button type="button" className={styles.step} disabled={disabled || zoom >= maxZoom} aria-label="Acercar" title="Acercar (Ctrl++)" aria-keyshortcuts="Control++" onClick={() => onZoom(Math.floor(zoom / zoomStep + 1) * zoomStep)}><Icon name="plus" /></button>
    <button type="button" className={styles.value} disabled={disabled} aria-label={`Zoom ${zoom} %. Restablecer al 100 %`} title="Restablecer al 100 % (Ctrl+0)" aria-keyshortcuts="Control+0" onClick={() => onZoom(100)}>{zoom} %</button>
  </div>
}
