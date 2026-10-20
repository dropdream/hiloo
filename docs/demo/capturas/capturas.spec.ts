import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, chooseOpen } from '../../../tests/fixtures'

// El cuaderno se copia a una carpeta nueva en C:\ para que no salgan rutas personales.
const source = resolve('docs/demo/Proyecto de ejemplo')
const out = resolve('.verification/capturas/png')

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(out, `${name}.png`) })
}

test('capturas del README', async ({ application, editorPage: page }) => {
  // mkdtemp nunca reutiliza una carpeta existente; al final solo se borra la creada aquí.
  const base = await fs.mkdtemp('C:/hiloo-demo-')
  try {
    await capture(application, page, join(base, 'Proyecto de ejemplo'))
  } finally {
    await fs.rm(base, { recursive: true, force: true, maxRetries: 5 })
  }
})

async function capture(application: ElectronApplication, page: Page, root: string) {
  await fs.cp(source, root, { recursive: true, errorOnExist: true, force: false })
  await fs.mkdir(out, { recursive: true })
  const win = await application.browserWindow(page)
  await win.evaluate((w) => { w.setSize(1280, 800); w.center() })

  await page.getByRole('button', { name: 'Mostrar cuaderno', exact: true }).click()
  await chooseOpen(application, root)
  await page.getByRole('button', { name: 'Abrir cuaderno', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Notas del cuaderno' })
  await expect(sidebar.getByRole('button', { name: 'Abrir nota:', exact: false })).toHaveCount(6)
  await sidebar.getByRole('button', { name: 'Abrir nota: plan.md', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Documento Markdown' })
  await expect(editor.locator('h1')).toHaveText('Plan del huerto')
  await expect(page.locator('.document-mermaid')).toHaveAttribute('data-rendered', 'true')

  // Cabecera: tema Día, barra lateral y edición visual.
  await page.getByRole('button', { name: 'Día', exact: true }).click()
  await shot(page, 'portada')

  // Edición visual: tabla y tareas.
  await editor.locator('table').scrollIntoViewIfNeeded()
  await shot(page, 'edicion-visual')

  // Mermaid con su código desplegado.
  const diagram = page.locator('.document-mermaid')
  await diagram.locator('summary').click()
  await diagram.scrollIntoViewIfNeeded()
  await shot(page, 'mermaid')
  await diagram.locator('summary').click()

  // Modo código.
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await shot(page, 'modo-codigo')
  await page.getByRole('button', { name: 'Vista impresión', exact: true }).click()

  // Tema Noche con Fondo noche.
  await page.getByRole('button', { name: 'Noche', exact: true }).click()
  await page.getByRole('button', { name: 'Fondo noche', exact: true }).click()
  await editor.locator('h1').scrollIntoViewIfNeeded()
  await shot(page, 'tema-noche')
  await page.getByRole('button', { name: 'Papel blanco', exact: true }).click()

  // Cerebro con vista previa de una nota.
  await sidebar.getByRole('button', { name: 'Cerebro', exact: true }).click()
  const brain = page.getByRole('region', { name: 'Conexiones del cuaderno' })
  await expect(brain.locator('canvas').first()).toBeVisible()
  await brain.getByRole('button', { name: 'Vista previa: ideas/presupuesto.md', exact: true }).click()
  await expect(brain.getByRole('region', { name: 'Vista previa de nota' })).toBeVisible()
  await page.waitForTimeout(800)
  await brain.getByRole('button', { name: 'Ajustar grafo', exact: true }).click()
  await brain.getByRole('button', { name: 'Acercar grafo', exact: true }).click()
  await brain.getByRole('button', { name: 'Acercar grafo', exact: true }).click()
  await shot(page, 'cerebro')
  await page.getByRole('button', { name: 'Volver al documento', exact: true }).click()

  // Vista previa de impresión.
  await page.getByRole('button', { name: 'Imprimir', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Vista previa de impresión', exact: true })
  await expect(preview.getByRole('button', { name: 'Imprimir', exact: true })).toBeEnabled()
  await page.waitForTimeout(1000)
  await shot(page, 'vista-previa-impresion')
  await preview.getByRole('button', { name: 'Cancelar', exact: true }).click()
}
