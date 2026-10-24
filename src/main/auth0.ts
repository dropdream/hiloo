import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { auth0CallbackPath, auth0CallbackPorts } from '../shared/cloud'

export interface Auth0Config {
  domain: string
  clientId: string
}

export interface IdTokenClaims {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  nonce?: string
  name?: string
  email?: string
  picture?: string
}

export interface Auth0Tokens {
  idToken: string
  claims: IdTokenClaims
  refreshToken: string | null
}

export class Auth0Error extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
  }
}

const loginTimeout = 5 * 60_000
const scope = 'openid profile email offline_access'

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function issuer(config: Auth0Config): string {
  return `https://${config.domain}/`
}

// Abre el puerto libre de la lista; Auth0 no acepta puertos que no estén registrados.
async function listen(): Promise<{ server: Server; redirectUri: string }> {
  for (const port of auth0CallbackPorts) {
    const server = createServer()
    const opened = await new Promise<boolean>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false)
        else reject(error)
      })
      server.listen(port, '127.0.0.1', () => resolve(true))
    })
    if (opened) return { server, redirectUri: `http://127.0.0.1:${port}${auth0CallbackPath}` }
  }
  throw new Auth0Error('Los puertos para iniciar sesión están ocupados. Cierra otros programas y vuelve a intentarlo.')
}

function waitForCode(server: Server, state: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (error: Error | null, code?: string) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      server.removeAllListeners('request')
      if (error) reject(error)
      else resolve(code!)
    }
    const abort = () => finish(new Auth0Error('Inicio de sesión cancelado.', 'cancelled'))
    const timer = setTimeout(() => finish(new Auth0Error('El inicio de sesión tardó demasiado. Vuelve a intentarlo.')), loginTimeout)
    signal.addEventListener('abort', abort, { once: true })

    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method !== 'GET' || url.pathname !== auth0CallbackPath) {
        response.writeHead(404).end()
        return
      }
      // Un state distinto puede venir de otra pestaña o de un intento viejo; se ignora.
      if (url.searchParams.get('state') !== state) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Solicitud no válida.')
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const message = error || !code ? 'No se pudo iniciar sesión. Vuelve a hiloo para intentarlo de nuevo.' : 'Sesión iniciada. Ya puedes volver a hiloo.'
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' }).end(message)
      if (error || !code) {
        const cancelled = error === 'access_denied'
        finish(new Auth0Error(cancelled ? 'Inicio de sesión cancelado.' : 'Auth0 rechazó el inicio de sesión.', cancelled ? 'cancelled' : error ?? undefined))
      } else {
        finish(null, code)
      }
    })
  })
}

function decodeClaims(idToken: string): IdTokenClaims {
  const payload = idToken.split('.')[1]
  if (!payload) throw new Auth0Error('Auth0 devolvió un token no válido.')
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims
  } catch {
    throw new Auth0Error('Auth0 devolvió un token no válido.')
  }
}

// El token llega directo del endpoint de Auth0 por TLS, así que basta con revisar sus claims
// (OIDC Core 3.1.3.7). Supabase verifica la firma con el JWKS del tenant en cada petición.
function validateClaims(config: Auth0Config, claims: IdTokenClaims, nonce: string | null): void {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (
    claims.iss !== issuer(config) ||
    !audiences.includes(config.clientId) ||
    typeof claims.sub !== 'string' ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 <= Date.now() ||
    (nonce !== null && claims.nonce !== nonce)
  ) {
    throw new Auth0Error('Auth0 devolvió un token que no corresponde a esta aplicación.')
  }
}

async function requestTokens(config: Auth0Config, body: Record<string, string>, nonce: string | null, previousRefresh: string | null): Promise<Auth0Tokens> {
  let response: Response
  try {
    response = await fetch(`https://${config.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, ...body })
    })
  } catch {
    throw new Auth0Error('No se pudo conectar con Auth0. Comprueba tu conexión.', 'network')
  }
  const data = await response.json().catch(() => ({})) as { id_token?: unknown; refresh_token?: unknown; error?: unknown }
  if (!response.ok || typeof data.id_token !== 'string') {
    throw new Auth0Error('Auth0 no entregó la sesión.', typeof data.error === 'string' ? data.error : undefined)
  }
  const claims = decodeClaims(data.id_token)
  validateClaims(config, claims, nonce)
  return {
    idToken: data.id_token,
    claims,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : previousRefresh
  }
}

// Authorization Code + PKCE con loopback (RFC 8252). No usa el Client Secret.
export async function signIn(config: Auth0Config, openExternal: (url: string) => Promise<void>, signal: AbortSignal): Promise<Auth0Tokens> {
  const { server, redirectUri } = await listen()
  const local = new AbortController()
  const stop = () => local.abort()
  signal.addEventListener('abort', stop, { once: true })
  try {
    if (signal.aborted) throw new Auth0Error('Inicio de sesión cancelado.', 'cancelled')
    const verifier = randomToken()
    const state = randomToken()
    const nonce = randomToken()
    const authorize = new URL(`https://${config.domain}/authorize`)
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256'
    }).toString()
    const code = waitForCode(server, state, local.signal)
    code.catch(() => {}) // Si falla openExternal, el error que vale es ese.
    await openExternal(authorize.href)
    return await requestTokens(config, {
      grant_type: 'authorization_code',
      code: await code,
      code_verifier: verifier,
      redirect_uri: redirectUri
    }, nonce, null)
  } finally {
    signal.removeEventListener('abort', stop)
    local.abort()
    server.closeAllConnections()
    server.close()
  }
}

export function refresh(config: Auth0Config, refreshToken: string): Promise<Auth0Tokens> {
  return requestTokens(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, null, refreshToken)
}

export async function revoke(config: Auth0Config, refreshToken: string): Promise<void> {
  await fetch(`https://${config.domain}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId, token: refreshToken })
  }).catch(() => {})
}
