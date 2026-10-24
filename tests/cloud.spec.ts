import type { ElectronApplication, Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './fixtures'

// Auth0 simulado dentro del proceso principal: captura la URL de autorización y responde /oauth/token.
async function fakeAuth0(application: ElectronApplication, picture?: string) {
  await application.evaluate(({ shell }, picture) => {
    const state = globalThis as unknown as { authUrls: string[]; tokenRequests: string[]; revoked: string[] }
    state.authUrls = []
    state.tokenRequests = []
    state.revoked = []
    shell.openExternal = async (url: string) => { state.authUrls.push(url) }
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/oauth/revoke') {
        state.revoked.push(JSON.parse(String(init?.body)).token)
        return new Response('{}', { status: 200 })
      }
      const body = new URLSearchParams(String(init?.body))
      state.tokenRequests.push(body.toString())
      const authorize = new URL(state.authUrls.at(-1)!)
      const claims = {
        iss: `https://${authorize.host}/`,
        sub: 'auth0|prueba',
        aud: authorize.searchParams.get('client_id'),
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce: body.get('grant_type') === 'authorization_code' ? authorize.searchParams.get('nonce') : undefined,
        name: 'Ana Prueba',
        picture
      }
      const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
      return new Response(JSON.stringify({
        id_token: `${part({ alg: 'RS256' })}.${part(claims)}.firma`,
        refresh_token: 'refresco-secreto-1',
        token_type: 'Bearer'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }, picture)
}

const authUrl = (application: ElectronApplication) =>
  application.evaluate(() => (globalThis as unknown as { authUrls: string[] }).authUrls.at(-1) ?? null)

test('inicio de sesión con Auth0 por PKCE y loopback, y cierre de sesión', async ({ application, editorPage: page }) => {
  expect(await page.evaluate(() => typeof (window as unknown as { cloud?: unknown }).cloud)).toBe('object')
  test.skip((await page.evaluate(() => window.cloud.status())).state === 'unconfigured', 'Sin .env de nube al compilar.')
  await fakeAuth0(application)

  await page.getByRole('button', { name: /^Cuenta en la nube: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Cuenta en la nube' })
  await expect(dialog).toContainText('No has iniciado sesión.')
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect.poll(() => authUrl(application)).not.toBeNull()

  const authorize = new URL((await authUrl(application))!)
  const params = authorize.searchParams
  expect(authorize.pathname).toBe('/authorize')
  expect(params.get('response_type')).toBe('code')
  expect(params.get('code_challenge_method')).toBe('S256')
  expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/)
  expect(params.get('scope')).toBe('openid profile email offline_access')
  expect(params.get('redirect_uri')).toBe('http://127.0.0.1:47615/callback')
  expect(params.has('client_secret')).toBe(false)

  // Un state ajeno no completa el inicio de sesión.
  const redirect = params.get('redirect_uri')!
  expect((await fetch(`${redirect}?code=falso&state=otro`)).status).toBe(400)
  const callback = await fetch(`${redirect}?code=codigo-1&state=${params.get('state')}`)
  expect(callback.status).toBe(200)
  expect(await callback.text()).toContain('Sesión iniciada')
  await expect(dialog).toContainText('Sesión iniciada como Ana Prueba.')

  const tokenRequest = new URLSearchParams(await application.evaluate(() => (globalThis as unknown as { tokenRequests: string[] }).tokenRequests[0]))
  expect(tokenRequest.get('grant_type')).toBe('authorization_code')
  expect(tokenRequest.get('code')).toBe('codigo-1')
  expect(tokenRequest.get('redirect_uri')).toBe(redirect)
  expect(tokenRequest.get('code_verifier')).toMatch(/^[\w-]{43}$/)
  expect(tokenRequest.has('client_secret')).toBe(false)

  // El refresh token queda cifrado con DPAPI, nunca en texto plano.
  const sessionFile = join(await application.evaluate(({ app }) => app.getPath('userData')), 'auth0-session.bin')
  expect((await fs.readFile(sessionFile)).includes('refresco-secreto-1')).toBe(false)

  await dialog.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(dialog).toContainText('No has iniciado sesión.')
  expect(await application.evaluate(() => (globalThis as unknown as { revoked: string[] }).revoked)).toEqual(['refresco-secreto-1'])
  await expect(fs.access(sessionFile)).rejects.toThrow()
})

test('cancelar en Auth0 o cerrar el diálogo libera el loopback', async ({ application, editorPage: page }) => {
  test.skip((await page.evaluate(() => window.cloud.status())).state === 'unconfigured', 'Sin .env de nube al compilar.')
  await fakeAuth0(application)

  await page.getByRole('button', { name: /^Cuenta en la nube: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Cuenta en la nube' })
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect.poll(() => authUrl(application)).not.toBeNull()
  const first = new URL((await authUrl(application))!).searchParams
  await fetch(`${first.get('redirect_uri')}?error=access_denied&state=${first.get('state')}`)
  await expect(dialog.getByRole('alert')).toHaveText('Inicio de sesión cancelado.')

  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect.poll(() => application.evaluate(() => (globalThis as unknown as { authUrls: string[] }).authUrls.length)).toBe(2)
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(dialog).toBeHidden()
  // Tras cancelar, el puerto vuelve a estar libre para el siguiente intento.
  await expect.poll(() => application.evaluate(async () => {
    const { createServer } = process.mainModule!.require('node:http') as typeof import('node:http')
    const server = createServer()
    return new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false))
      server.listen(47615, '127.0.0.1', () => server.close(() => resolve(true)))
    })
  })).toBe(true)
})

// Completa el inicio de sesión simulado y cierra el diálogo.
async function signInFake(application: ElectronApplication, page: Page) {
  await page.getByRole('button', { name: /^Cuenta en la nube: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Cuenta en la nube' })
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect.poll(() => authUrl(application)).not.toBeNull()
  const params = new URL((await authUrl(application))!).searchParams
  await fetch(`${params.get('redirect_uri')}?code=codigo-1&state=${params.get('state')}`)
  await expect(dialog).toContainText('Sesión iniciada como Ana Prueba.')
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(dialog).toBeHidden()
}

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('el botón de cuenta sin sesión muestra el ícono genérico', async ({ editorPage: page }) => {
  const account = page.getByRole('banner').getByRole('button', { name: 'Cuenta en la nube: sin sesión' })
  await expect(account).toHaveAttribute('title', 'Cuenta en la nube: sin sesión')
  await expect(account.locator('svg')).toHaveCount(1)
  await expect(account.locator('img')).toHaveCount(0)
  // Ya no hay botón de nube en la barra de herramientas.
  await expect(page.getByRole('toolbar', { name: 'Herramientas del documento' }).getByRole('button', { name: /nube/i })).toHaveCount(0)
  await account.click()
  await expect(page.getByRole('dialog', { name: 'Cuenta en la nube' })).toBeVisible()
})

test('con sesión el botón de cuenta muestra la foto del perfil', async ({ application, editorPage: page }) => {
  test.skip((await page.evaluate(() => window.cloud.status())).state === 'unconfigured', 'Sin .env de nube al compilar.')
  await page.route('https://fotos.prueba.test/**', (route) => route.fulfill({ contentType: 'image/png', body: pixel }))
  await fakeAuth0(application, 'https://fotos.prueba.test/ana.png')
  await signInFake(application, page)

  const account = page.getByRole('banner').getByRole('button', { name: 'Cuenta en la nube: Ana Prueba' })
  await expect(account).toHaveAttribute('title', 'Cuenta en la nube: Ana Prueba')
  await expect(account.locator('img')).toHaveAttribute('src', 'https://fotos.prueba.test/ana.png')
  await expect.poll(() => account.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  // El renderer recibe solo nombre, correo y foto; nunca los tokens.
  expect(Object.keys(await page.evaluate(() => window.cloud.status())).sort()).toEqual(['email', 'name', 'picture', 'state'])

  await account.click()
  await page.getByRole('dialog', { name: 'Cuenta en la nube' }).getByRole('button', { name: 'Cerrar sesión' }).click()
  await page.getByRole('dialog', { name: 'Cuenta en la nube' }).getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Cuenta en la nube: sin sesión' }).locator('svg')).toHaveCount(1)
})

test('si la foto falla se muestran las iniciales, y sin foto https también', async ({ application, editorPage: page }) => {
  test.skip((await page.evaluate(() => window.cloud.status())).state === 'unconfigured', 'Sin .env de nube al compilar.')
  await page.route('https://fotos.prueba.test/**', (route) => route.abort())
  await fakeAuth0(application, 'https://fotos.prueba.test/rota.png')
  await signInFake(application, page)

  const account = page.getByRole('banner').getByRole('button', { name: 'Cuenta en la nube: Ana Prueba' })
  await expect(account.locator('img')).toHaveCount(0)
  await expect(account).toContainText('AP')

  // Una URL que no es https no llega al renderer.
  await account.click()
  await page.getByRole('dialog', { name: 'Cuenta en la nube' }).getByRole('button', { name: 'Cerrar sesión' }).click()
  await fakeAuth0(application, 'http://fotos.prueba.test/ana.png')
  await page.getByRole('dialog', { name: 'Cuenta en la nube' }).getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect.poll(() => authUrl(application)).not.toBeNull()
  const params = new URL((await authUrl(application))!).searchParams
  await fetch(`${params.get('redirect_uri')}?code=codigo-2&state=${params.get('state')}`)
  await expect.poll(async () => (await page.evaluate(() => window.cloud.status()) as { picture?: string | null }).picture).toBeNull()
})
