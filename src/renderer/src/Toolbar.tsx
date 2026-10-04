import * as Toolbar from '@radix-ui/react-toolbar'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Select from '@radix-ui/react-select'
import { useState } from 'react'
import { Icon, type IconName } from './Icon'
import type { Format, SelectionState, TableAction } from './editor'
import { InsertDialog, type InsertKind } from './InsertDialog'
import styles from './Toolbar.module.css'

interface ToolProps {
  name: string
  shortcut?: string
  icon: IconName
  label?: string
  active?: boolean
  disabled?: boolean
  opensDialog?: boolean
  onClick(): void
}

function Tool({ name, shortcut, icon, label, active, disabled, opensDialog, onClick }: ToolProps) {
  return <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <Toolbar.Button className={styles.button} aria-label={name} aria-keyshortcuts={shortcut?.replaceAll('Ctrl', 'Control')} aria-pressed={active} aria-haspopup={opensDialog ? 'dialog' : undefined} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
        <Icon name={icon} />{label ? <span>{label}</span> : null}
      </Toolbar.Button>
    </Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className={styles.tooltip} sideOffset={6}>{name}{shortcut ? <kbd>{shortcut}</kbd> : null}</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>
}

interface Props {
  busy: boolean
  ready: boolean
  canSave: boolean
  selection: SelectionState
  onOpen(): void
  onSave(copy: boolean): void
  onFormat(action: Format, level?: string): void
  onFocusEditor(): void
  onInsertTable(rows: number, columns: number): boolean
  onTable(action: TableAction): boolean
  onLink(value: { href: string; title: string; text: string }): boolean
  onRemoveLink(): boolean
  onImage(value: { src: string; alt: string; title: string }): boolean
  onRemoveImage(): boolean
}

export function EditorToolbar({ busy, ready, canSave, selection, onOpen, onSave, onFormat, onFocusEditor, ...actions }: Props) {
  const disabled = busy || !ready
  const [dialog, setDialog] = useState<{ kind: InsertKind; selection: SelectionState } | null>(null)
  const openDialog = (kind: InsertKind) => setDialog({ kind, selection })
  return <Tooltip.Provider delayDuration={450}>
    <Toolbar.Root className={styles.toolbar} aria-label="Herramientas del documento" loop>
      <div className={styles.group}>
        <Tool name="Abrir" label="Abrir" shortcut="Ctrl+O" icon="open" disabled={busy} onClick={onOpen} />
        <Tool name="Guardar" label="Guardar" shortcut="Ctrl+S" icon="save" disabled={busy || !canSave} onClick={() => onSave(false)} />
        <Tool name="Guardar como" shortcut="Ctrl+Shift+S" icon="copy" disabled={busy || !canSave} onClick={() => onSave(true)} />
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
        <Tool name="Tachado" icon="strike" active={selection.strike} disabled={disabled} onClick={() => onFormat('strike')} />
      </div>
      <Toolbar.Separator className={styles.separator} />
      <div className={styles.group}>
        <Tool name="Lista con viñetas" shortcut="Ctrl+Alt+8" icon="bullet" active={selection.bullet} disabled={disabled} onClick={() => onFormat('bullet')} />
        <Tool name="Lista numerada" shortcut="Ctrl+Alt+7" icon="ordered" active={selection.ordered} disabled={disabled} onClick={() => onFormat('ordered')} />
        <Tool name="Lista de tareas" icon="task" active={selection.task} disabled={disabled} onClick={() => onFormat('task')} />
        <Tool name="Cita" shortcut="Ctrl+Shift+B" icon="quote" active={selection.quote} disabled={disabled} onClick={() => onFormat('quote')} />
      </div>
      <Toolbar.Separator className={styles.separator} />
      <div className={styles.group}>
        <Tool name="Enlace" icon="link" opensDialog active={Boolean(selection.link)} disabled={disabled} onClick={() => openDialog('link')} />
        <Tool name="Imagen" icon="image" opensDialog active={Boolean(selection.image)} disabled={disabled} onClick={() => openDialog('image')} />
        <Tool name="Tabla" icon="table" opensDialog active={selection.table} disabled={disabled} onClick={() => openDialog('table')} />
      </div>
      <Toolbar.Separator className={styles.separator} />
      <div className={styles.group}>
        <Tool name="Deshacer" shortcut="Ctrl+Z" icon="undo" disabled={disabled || !selection.undo} onClick={() => onFormat('undo')} />
        <Tool name="Rehacer" shortcut="Ctrl+Y" icon="redo" disabled={disabled || !selection.redo} onClick={() => onFormat('redo')} />
      </div>
    </Toolbar.Root>
    {dialog ? <InsertDialog kind={dialog.kind} selection={dialog.selection} disabled={disabled} {...actions} onClose={() => { setDialog(null); onFocusEditor() }} /> : null}
  </Tooltip.Provider>
}
