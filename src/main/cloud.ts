import { app, ipcMain, safeStorage, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CloudProbe, CloudResult, CloudStatus } from '../shared/cloud'
import { Auth0Error, refresh, revoke, signIn, type Auth0Config, type Auth0Tokens } from './auth0'

interface CloudConfig {
  supabaseUrl: string
  supabasePublishableKey: string
  auth0: Auth0Config
}

// Valores públicos que electron-vite toma del .env al compilar. Nunca la clave secreta.
declare const __HILOO_CLOUD__: Partial<Record<'supabaseUrl' | 'supabasePublishableKey' | 'auth0Domain' | 'auth0ClientId', string>>

function readConfig(): CloudConfig | null {
  const { supabaseUrl, supabasePublishableKey, auth0Domain, auth0ClientId } = __HILOO_CLOUD__
  if (!supabaseUrl || !supabasePublishableKey || !auth0Domain || !auth0ClientId) return null
  return { supabaseUrl, supabasePublishableKey, auth0: { domain: auth0Domain, clientId: auth0ClientId } }
}

// Margen para no mandar a Supabase un token a punto de vencer.
const renewMargin = 60_000

// Solo https: el renderer carga la foto directo de su origen, sin pasar por el proceso principal.
function safePicture(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

class CloudSession {
  private tokens: Auth0Tokens | null = null
  private renewing: Promise<string | null> | null = null
  private login: AbortController | null = null
  private restoring: Promise<void> | null = null
  private client: SupabaseClient | null = null
  private readonly file = join(app.getPath('userData'), 'auth0-session.bin')

  constructor(readonly config: CloudConfig) {}

  status(): CloudStatus {
    if (!this.tokens) return { state: 'signed-out' }
    const { name, email, picture } = this.tokens.claims
    return { state: 'signed-in', name: name ?? null, email: email ?? null, picture: safePicture(picture) }
  }

  // Al arrancar solo hay refresh token guardado; el ID token se pide de nuevo.
  restore(): Promise<void> {
    this.restoring ??= this.restoreSaved()
    return this.restoring
  }

  private async restoreSaved(): Promise<void> {
    const saved = await this.readRefreshToken()
    if (!saved) return
    try {
      this.tokens = await refresh(this.config.auth0, saved)
      await this.saveRefreshToken(this.tokens.refreshToken)
    } catch (error) {
      // Sin conexión se conserva el refresh token para el próximo intento.
      if (!(error instanceof Auth0Error && error.code === 'network')) await this.clear()
    }
  }

  async signIn(): Promise<CloudResult<CloudStatus>> {
    if (this.login) return { status: 'error', message: 'Ya hay un inicio de sesión abierto en el navegador.' }
    const login = this.login = new AbortController()
    try {
      const tokens = await signIn(this.config.auth0, (url) => shell.openExternal(url), login.signal)
      const previous = this.tokens?.refreshToken
      this.tokens = tokens
      await this.saveRefreshToken(tokens.refreshToken)
      if (previous && previous !== tokens.refreshToken) await revoke(this.config.auth0, previous)
      return { status: 'ok', value: this.status() }
    } catch (error) {
      if (error instanceof Auth0Error && error.code === 'cancelled') return { status: 'cancelled' }
      return { status: 'error', message: error instanceof Auth0Error ? error.message : 'No se pudo iniciar sesión.' }
    } finally {
      this.login = null
    }
  }

  async signOut(): Promise<CloudStatus> {
    this.login?.abort()
    const refreshToken = this.tokens?.refreshToken ?? await this.readRefreshToken()
    await this.clear()
    if (refreshToken) await revoke(this.config.auth0, refreshToken)
    return this.status()
  }

  cancelLogin(): void {
    this.login?.abort()
  }

  // Lo llama supabase-js antes de cada petición. null equivale a anon.
  async idToken(): Promise<string | null> {
    const current = this.tokens
    if (!current) return null
    if (current.claims.exp * 1000 - renewMargin > Date.now()) return current.idToken
    if (!current.refreshToken) return null
    this.renewing ??= refresh(this.config.auth0, current.refreshToken)
      .then(async (tokens) => {
        if (this.tokens !== current) return this.tokens?.idToken ?? null
        this.tokens = tokens
        await this.saveRefreshToken(tokens.refreshToken)
        return tokens.idToken
      })
      .catch(async (error: unknown) => {
        if (this.tokens === current && !(error instanceof Auth0Error && error.code === 'network')) await this.clear()
        return null
      })
      .finally(() => { this.renewing = null })
    return this.renewing
  }

  supabase(): SupabaseClient {
    this.client ??= createClient(this.config.supabaseUrl, this.config.supabasePublishableKey, {
      accessToken: () => this.idToken()
    })
    return this.client
  }

  private async clear(): Promise<void> {
    this.tokens = null
    await fs.unlink(this.file).catch(() => {})
  }

  // DPAPI de Windows: solo el mismo usuario en el mismo equipo puede descifrarlo.
  private async saveRefreshToken(refreshToken: string | null): Promise<void> {
    if (!refreshToken || !safeStorage.isEncryptionAvailable()) return
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, safeStorage.encryptString(refreshToken), { flag: 'wx' })
      await fs.rename(temporary, this.file)
    } catch {
      // Si no se guarda, la sesión dura hasta cerrar hiloo.
    } finally {
      await fs.unlink(temporary).catch(() => {})
    }
  }

  private async readRefreshToken(): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(await fs.readFile(this.file))
    } catch {
      return null
    }
  }
}

let session: CloudSession | null | undefined

async function cloudSession(): Promise<CloudSession | null> {
  if (session === undefined) {
    const config = readConfig()
    session = config ? new CloudSession(config) : null
  }
  await session?.restore()
  return session
}

async function probe(current: CloudSession): Promise<CloudResult<CloudProbe>> {
  if (!await current.idToken()) return { status: 'error', message: 'Inicia sesión para consultar la nube.' }
  const supabase = current.supabase()
  const [organizations, rows] = await Promise.all([
    supabase.from('organizaciones').select('nombre').order('nombre'),
    supabase.from('pruebas_0c').select('texto, organizaciones(nombre)').order('texto')
  ])
  if (organizations.error || rows.error) return { status: 'error', message: 'Supabase rechazó la consulta.' }
  return {
    status: 'ok',
    value: {
      organizations: organizations.data.map((row) => row.nombre as string),
      rows: rows.data.map((row) => {
        const organization = row.organizaciones as unknown as { nombre: string } | null
        return { organization: organization?.nombre ?? '', text: row.texto as string }
      })
    }
  }
}

export function attachCloud(window: BrowserWindow, trustedUrl: string): void {
  const channels = ['cloud:status', 'cloud:sign-in', 'cloud:cancel-sign-in', 'cloud:sign-out', 'cloud:probe']

  function validateSender(event: IpcMainInvokeEvent): void {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== trustedUrl
    ) {
      throw new Error('Origen de solicitud no permitido.')
    }
  }

  ipcMain.handle('cloud:status', async (event): Promise<CloudStatus> => {
    validateSender(event)
    const current = await cloudSession()
    return current ? current.status() : { state: 'unconfigured' }
  })

  ipcMain.handle('cloud:sign-in', async (event): Promise<CloudResult<CloudStatus>> => {
    validateSender(event)
    const current = await cloudSession()
    if (!current) return { status: 'error', message: 'Esta copia de hiloo no tiene configurada la nube.' }
    const result = await current.signIn()
    if (result.status === 'ok' && !window.isDestroyed()) window.focus()
    return result
  })

  ipcMain.handle('cloud:cancel-sign-in', (event) => {
    validateSender(event)
    session?.cancelLogin()
  })

  ipcMain.handle('cloud:sign-out', async (event): Promise<CloudStatus> => {
    validateSender(event)
    const current = await cloudSession()
    return current ? current.signOut() : { state: 'unconfigured' }
  })

  ipcMain.handle('cloud:probe', async (event): Promise<CloudResult<CloudProbe>> => {
    validateSender(event)
    const current = await cloudSession()
    if (!current) return { status: 'error', message: 'Esta copia de hiloo no tiene configurada la nube.' }
    try {
      return await probe(current)
    } catch {
      return { status: 'error', message: 'No se pudo conectar con Supabase.' }
    }
  })

  window.once('closed', () => {
    session?.cancelLogin()
    channels.forEach((channel) => ipcMain.removeHandler(channel))
  })
}
