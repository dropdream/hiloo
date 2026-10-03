import * as Toolbar from '@radix-ui/react-toolbar'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Select from '@radix-ui/react-select'
import { Icon, type IconName } from './Icon'
import type { Format, SelectionState } from './editor'
import styles from './Toolbar.module.css'

interface ToolProps {
  name: string
  shortcut: string
  icon: IconName
  label?: string
  active?: boolean
  disabled?: boolean
  onClick(): void
}

function Tool({ name, shortcut, icon, label, active, disabled, onClick }: ToolProps) {
  return <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <Toolbar.Button className={styles.button} aria-label={name} aria-keyshortcuts={shortcut.replaceAll('Ctrl', 'Control')} aria-pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
        <Icon name={icon} />{label ? <span>{label}</span> : null}
      </Toolbar.Button>
    </Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className={styles.tooltip} sideOffset={6}>{name}<kbd>{shortcut}</kbd></Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>
}

interface Props {
  busy: boolean
  ready: boolean
  selection: SelectionState
  onOpen(): void
  onSave(copy: boolean): void
  onFormat(action: Format, level?: string): void
  onFocusEditor(): void
}

export function EditorToolbar({ busy, ready, selection, onOpen, onSave, onFormat, onFocusEditor }: Props) {
  const disabled = busy || !ready
  return <Tooltip.Provider delayDuration={450}>
    <Toolbar.Root className={styles.toolbar} aria-label="Herramientas del documento" loop>
      <div className={styles.group}>
        <Tool name="Abrir" label="Abrir" shortcut="Ctrl+O" icon="open" disabled={busy} onClick={onOpen} />
        <Tool name="Guardar" label="Guardar" shortcut="Ctrl+S" icon="save" disabled={disabled} onClick={() => onSave(false)} />
        <Tool name="Guardar como" shortcut="Ctrl+Shift+S" icon="copy" disabled={disabled} onClick={() => onSave(true)} />
      </div>
      <Toolbar.Separator className={styles.separator} />
      <Select.Root value={selection.block} disabled={disabled} onValueChange={(level) => onFormat('block', level)}>
        <Toolbar.Button asChild><Select.Trigger className={styles.select} aria-label="Tipo de bloque"><Select.Value /><Select.Icon><Icon name="chevron" /></Select.Icon></Select.Trigger></Toolbar.Button>
        <Select.Portal><Select.Content className={styles.menu} position="popper" sideOffset={6} onCloseAutoFocus={(event) => { event.preventDefault(); onFocusEditor() }}>
          <Select.Viewport>{['Párrafo', 'Título 1', 'Título 2', 'Título 3', 'Título 4', 'Título 5', 'Título 6'].map((label, index) =>
            <Select.Item className={styles.item} key={label} value={String(index)}><Select.ItemText>{label}</Select.ItemText><Select.ItemIndicator><Icon name="check" /></Select.ItemIndicator><kbd>Ctrl+Alt+{index}</kbd></Select.Item>
          )}</Select.Viewport>
        </Select.Content></Select.Portal>
      </Select.Root>
      <Toolbar.Separator className={styles.separator} />
      <div className={styles.group}>
        <Tool name="Negrita" shortcut="Ctrl+B" icon="bold" active={selection.bold} disabled={disabled} onClick={() => onFormat('bold')} />
        <Tool name="Cursiva" shortcut="Ctrl+I" icon="italic" active={selection.italic} disabled={disabled} onClick={() => onFormat('italic')} />
      </div>
      <Toolbar.Separator className={styles.separator} />
      <div className={styles.group}>
        <Tool name="Lista con viñetas" shortcut="Ctrl+Alt+8" icon="bullet" active={selection.bullet} disabled={disabled} onClick={() => onFormat('bullet')} />
        <Tool name="Lista numerada" shortcut="Ctrl+Alt+7" icon="ordered" active={selection.ordered} disabled={disabled} onClick={() => onFormat('ordered')} />
        <Tool name="Cita" shortcut="Ctrl+Shift+B" icon="quote" active={selection.quote} disabled={disabled} onClick={() => onFormat('quote')} />
      </div>
      <Toolbar.Separator className={styles.separator} />
      <div className={styles.group}>
        <Tool name="Deshacer" shortcut="Ctrl+Z" icon="undo" disabled={disabled || !selection.undo} onClick={() => onFormat('undo')} />
        <Tool name="Rehacer" shortcut="Ctrl+Y" icon="redo" disabled={disabled || !selection.redo} onClick={() => onFormat('redo')} />
      </div>
    </Toolbar.Root>
  </Tooltip.Provider>
}
