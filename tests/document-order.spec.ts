import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { test, expect, chooseSave, chooseChanges } from './fixtures'

test('actualización recibida durante escritura permanece pendiente y el segundo guardado la persiste', async ({ application, editorPage: page }, testInfo) => {
  const path = testInfo.outputPath('concurrente.md')
  await fs.mkdir(dirname(path), { recursive: true })
  await page.getByRole('textbox').fill('Versión escrita')
  await chooseSave(application, path)
  await application.evaluate(() => {
    const io = process.getBuiltinModule('node:fs').promises
    const original = io.copyFile
    const state = globalThis as typeof globalThis & { saveGate?: { reached: boolean; release(): void } }
    const gate = new Promise<void>((resolve) => { state.saveGate = { reached: false, release: resolve } })
    io.copyFile = async (...args: Parameters<typeof original>) => {
      state.saveGate!.reached = true
      await gate
      io.copyFile = original
      return original(...args)
    }
  })
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect.poll(() => application.evaluate(() => (globalThis as typeof globalThis & { saveGate?: { reached: boolean } }).saveGate?.reached)).toBe(true)
  expect((await page.evaluate(async () => {
    const current = await window.documents.current()
    return window.documents.update(current.id, 'Edición posterior\n')
  })).status).toBe('ok')
  await application.evaluate(() => (globalThis as typeof globalThis & { saveGate?: { release(): void } }).saveGate!.release())
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  expect(await fs.readFile(path, 'utf8')).toContain('Versión escrita')
  expect(await page.evaluate(async () => (await window.documents.current()).content)).toBe('Edición posterior\n')
  expect(await page.evaluate(async () => {
    const current = await window.documents.current()
    return current.savedRevision < current.revision
  })).toBe(true)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (await window.documents.current()).dirty)).toBe(false)
  expect(await fs.readFile(path, 'utf8')).toBe('Edición posterior\n')
})

for (const close of [false, true]) {
  test(`edición tardía del renderer conserva historial y estado${close ? ' al guardar y cerrar' : ' al guardar'}`, async ({ application, editorPage: page }, testInfo) => {
    const path = testInfo.outputPath('renderer.md')
    await fs.mkdir(dirname(path), { recursive: true })
    const editor = page.getByRole('textbox')
    await editor.fill('Primera versión')
    await chooseSave(application, path)
    await chooseChanges(application, 0)
    await application.evaluate(() => {
      const io = process.getBuiltinModule('node:fs').promises
      const original = io.copyFile
      const state = globalThis as typeof globalThis & { saveGate?: { reached: boolean; release(): void } }
      const gate = new Promise<void>((resolve) => { state.saveGate = { reached: false, release: resolve } })
      io.copyFile = async (...args: Parameters<typeof original>) => {
        state.saveGate!.reached = true
        await gate
        io.copyFile = original
        return original(...args)
      }
    })
    if (close) await (await application.browserWindow(page)).evaluate(win => win.close())
    else await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect.poll(() => application.evaluate(() => (globalThis as typeof globalThis & { saveGate?: { reached: boolean } }).saveGate?.reached)).toBe(true)
    // Evento atrasado inyectado para comprobar la protección sin depender del bloqueo visual.
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('document:busy', false))
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await editor.fill('Versión posterior')
    await expect.poll(() => page.evaluate(async () => (await window.documents.current()).content)).toContain('Versión posterior')
    await application.evaluate(() => (globalThis as typeof globalThis & { saveGate?: { release(): void } }).saveGate!.release())
    await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
    await expect(editor).toHaveText('Versión posterior')
    expect(await fs.readFile(path, 'utf8')).toContain('Primera versión')
    if (close) await expect(page.getByRole('alert')).toContainText('cambios posteriores pendientes')
    await editor.press('Control+A')
    await page.getByRole('button', { name: 'Negrita', exact: true }).click()
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Guardado')
    expect(await fs.readFile(path, 'utf8')).toContain('Versión posterior')
  })
}

test('actualización rechazada por 2 MiB impide guardar silenciosamente la versión anterior', async ({ application, editorPage: page }, testInfo) => {
  const path = testInfo.outputPath('limite.md')
  await fs.mkdir(dirname(path), { recursive: true })
  await page.getByRole('textbox').fill('Versión anterior')
  await chooseSave(application, path)
  const result = await page.evaluate(async () => {
    const current = await window.documents.current()
    const update = await window.documents.update(current.id, 'x'.repeat(2 * 1024 * 1024 + 1))
    const save = await window.documents.save()
    return { update, save }
  })
  expect(result.update.status).toBe('error')
  expect(result.save.status).toBe('error')
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  await expect(page.getByRole('alert')).toContainText('2 MB')
  await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rechazo recibido durante el diálogo bloquea guardar y una edición válida permite recuperarse', async ({ application, editorPage: page }, testInfo) => {
  const path = testInfo.outputPath('dialogo.md')
  await fs.mkdir(dirname(path), { recursive: true })
  const editor = page.getByRole('textbox')
  await editor.fill('Primera versión')
  await application.evaluate(({ dialog }, path) => {
    const state = globalThis as typeof globalThis & { dialogGate?: { reached: boolean; release(): void } }
    const gate = new Promise<void>(resolve => { state.dialogGate = { reached: false, release: resolve } })
    dialog.showSaveDialog = async () => {
      state.dialogGate!.reached = true
      await gate
      return { canceled: false, filePath: path }
    }
  }, path)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect.poll(() => application.evaluate(() => (globalThis as typeof globalThis & { dialogGate?: { reached: boolean } }).dialogGate?.reached)).toBe(true)
  expect((await page.evaluate(async () => {
    const current = await window.documents.current()
    await window.documents.update(current.id, 'Versión recibida en diálogo\n')
    return window.documents.update(current.id, 'x'.repeat(2 * 1024 * 1024 + 1))
  })).status).toBe('error')
  await application.evaluate(() => (globalThis as typeof globalThis & { dialogGate?: { release(): void } }).dialogGate!.release())
  await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
  await expect(page.getByRole('alert')).toContainText('2 MB')
  await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  await editor.fill('Edición corregida')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Guardado')
  expect(await fs.readFile(path, 'utf8')).toContain('Edición corregida')
})

for (const collision of [true, false]) {
  test(`copia exclusiva ${collision ? 'conserva un destino que aparece durante el guardado' : 'mantiene la edición ante un fallo de copia'}`, async ({ application, editorPage: page }, testInfo) => {
    const path = testInfo.outputPath('destino.md')
    await fs.mkdir(dirname(path), { recursive: true })
    const editor = page.getByRole('textbox')
    await editor.fill('Contenido pendiente')
    await chooseSave(application, path)
    await application.evaluate((_electron, collision) => {
      const builtin = process.getBuiltinModule('node:fs')
      const io = builtin.promises
      const original = io.copyFile
      io.copyFile = async (source, target, flags) => {
        io.copyFile = original
        if (flags !== builtin.constants.COPYFILE_EXCL) throw new Error('La copia no es exclusiva.')
        if (collision) {
          await io.writeFile(target, 'Archivo de otro proceso\n', { flag: 'wx' })
          return original(source, target, flags)
        }
        throw Object.assign(new Error('Fallo de copia inyectado'), { code: 'ENOSPC' })
      }
    }, collision)
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(collision ? 'No se sobrescribió' : 'No hay espacio')
    await expect(page.getByRole('status')).toHaveText('Cambios sin guardar')
    await expect(editor).toHaveText('Contenido pendiente')
    if (collision) expect(await fs.readFile(path, 'utf8')).toBe('Archivo de otro proceso\n')
    else await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.readdir(dirname(path))).filter(file => file.endsWith('.tmp'))).toEqual([])
  })
}
