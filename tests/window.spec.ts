import { test, expect } from './fixtures'

test('superficie de edición, aislamiento y ciclo de ventana por API', async ({ application, editorPage: page }, testInfo) => {
    expect(await page.getByRole('textbox', { name: 'Documento Markdown' }).innerText()).toBe('\n')
    await expect(page.getByRole('toolbar')).toBeVisible()
    expect(await page.evaluate(() => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      background: getComputedStyle(document.body).backgroundColor,
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight
    }))).toEqual({ node: 'undefined', process: 'undefined', background: 'rgb(24, 53, 80)', overflow: false })

    const window = await application.browserWindow(page)
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(testInfo.project.name === 'packaged')
    expect(await window.evaluate((win) => {
      const preferences = win.webContents.getLastWebPreferences()
      return { isolation: preferences.contextIsolation, sandbox: preferences.sandbox, node: preferences.nodeIntegration, resizable: win.isResizable(), menu: win.isMenuBarVisible() }
    })).toEqual({ isolation: true, sandbox: true, node: false, resizable: true, menu: false })

    await expect.poll(() => window.evaluate((win) => win.isVisible())).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('window.png') })
    await window.evaluate((win) => win.minimize())
    await expect.poll(() => window.evaluate((win) => win.isMinimized())).toBe(true)
    await window.evaluate((win) => win.restore())
    await expect.poll(() => window.evaluate((win) => win.isMinimized())).toBe(false)
    await window.evaluate((win) => win.maximize())
    await expect.poll(() => window.evaluate((win) => win.isMaximized())).toBe(true)
    await window.evaluate((win) => win.unmaximize())
    await expect.poll(() => window.evaluate((win) => win.isMaximized())).toBe(false)
    await window.evaluate((win) => win.setBounds({ x: 100, y: 100, width: 800, height: 500 }))
    await expect.poll(() => window.evaluate((win) => {
      const { x, y } = win.getBounds()
      return { x, y }
    })).toEqual({ x: 100, y: 100 })
    // Windows puede redondear el tamaño en 1 DIP con escala fraccionaria.
    await expect.poll(() => window.evaluate((win) => {
      const { width, height } = win.getBounds()
      return Math.max(Math.abs(width - 800), Math.abs(height - 500))
    })).toBeLessThanOrEqual(1)
    await window.evaluate((win) => win.setSize(100, 100))
    const minimum = await window.evaluate((win) => win.getSize())
    expect(minimum[0]).toBeGreaterThanOrEqual(420)
    expect(minimum[1]).toBeGreaterThanOrEqual(300)

    const closed = application.waitForEvent('close')
    await window.evaluate((win) => win.close())
    await closed
})
