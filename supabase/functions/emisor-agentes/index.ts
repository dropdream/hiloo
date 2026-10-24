// Emisor OIDC de agentes (prueba 0b, sección 10 del diseño).
// Sirve el documento OIDC y el JWKS, y entrega tokens de 10 minutos a los agentes que demuestran
// con una firma DCP (prueba de posesión Ed25519) que tienen la clave de su pasaporte.
// La clave de firma del emisor vive solo en los secretos de la función (EMISOR_CLAVE_JWK).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignJWT, importJWK } from 'npm:jose@6'
import {
  deriveKid,
  getDefaultRegistry,
  registerDefaultProviders,
  verifyRegistrationPoP,
  type PopChallenge,
  type SignatureEntry,
} from 'npm:@dcp-ai/sdk@2.1.1'

const ISSUER = Deno.env.get('EMISOR_ISSUER')
const CLAVE = JSON.parse(Deno.env.get('EMISOR_CLAVE_JWK') ?? 'null')
if (!ISSUER || !CLAVE?.d || !CLAVE?.kid) {
  throw new Error('Faltan EMISOR_ISSUER o EMISOR_CLAVE_JWK')
}

const DESAFIO_SEGUNDOS = 60
const TOKEN_SEGUNDOS = 600
const CONTEXTO_DCP = 'DCP-AI.v2.ProofOfPossession'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NONCE = /^[0-9a-f]{64}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

// Solo la parte pública va al JWKS.
const { d: _privada, ...clavePublica } = CLAVE
const clavePrivada = await importJWK(CLAVE, 'ES256')

registerDefaultProviders()
const registro = getDefaultRegistry()

// service_role solo dentro de la función: lee agentes y usa las RPC del emisor.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const json = (cuerpo: unknown, estado = 200, cabeceras: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json', ...cabeceras },
  })

const error = (estado: number, codigo: string, mensaje: string) =>
  json({ error: codigo, mensaje }, estado)

async function leerJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const cuerpo = await req.json()
    return cuerpo && typeof cuerpo === 'object' ? cuerpo : null
  } catch {
    return null
  }
}

const bytesDeBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

function documentoOidc() {
  return {
    issuer: ISSUER,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'role', 'org_id', 'agente_id', 'tipo'],
  }
}

// Paso 1: el agente pide un desafío. Se guarda 60 s, atado al agente y a su organización.
async function desafio(req: Request): Promise<Response> {
  const cuerpo = await leerJson(req)
  const agenteId = cuerpo?.agente_id
  if (typeof agenteId !== 'string' || !UUID.test(agenteId)) {
    return error(400, 'peticion_invalida', 'agente_id debe ser un uuid')
  }

  const { data: agente, error: errorAgente } = await supabase
    .from('agentes')
    .select('id, clave_publica, revocado_en, vence_en')
    .eq('id', agenteId)
    .maybeSingle()
  if (errorAgente) {
    console.error('leer agente:', errorAgente.code, errorAgente.message)
    return error(500, 'error_interno', 'No se pudo leer el agente')
  }
  const vencido = agente?.vence_en && new Date(agente.vence_en) <= new Date()
  if (!agente || agente.revocado_en || vencido) {
    return error(403, 'agente_no_vigente', 'El agente no existe, está revocado o venció')
  }

  const desafio: PopChallenge = {
    kid: deriveKid('ed25519', bytesDeBase64(agente.clave_publica)),
    agent_id: agenteId,
    timestamp: new Date().toISOString(),
    nonce: hex(crypto.getRandomValues(new Uint8Array(32))),
  }
  const venceEn = new Date(Date.now() + DESAFIO_SEGUNDOS * 1000).toISOString()
  const { error: errorRpc } = await supabase.rpc('emisor_crear_desafio', {
    p_agente_id: agenteId,
    p_desafio: desafio,
    p_vence_en: venceEn,
  })
  if (errorRpc) {
    if (errorRpc.code !== '42501') console.error('crear desafío:', errorRpc.code, errorRpc.message)
    return errorRpc.code === '42501'
      ? error(403, 'agente_no_vigente', 'El agente no existe, está revocado o venció')
      : error(500, 'error_interno', 'No se pudo guardar el desafío')
  }
  return json({ desafio, vence_en: venceEn, contexto: CONTEXTO_DCP }, 201)
}

// Paso 2: el agente devuelve el desafío firmado y recibe el token.
async function token(req: Request): Promise<Response> {
  const cuerpo = await leerJson(req)
  const agenteId = cuerpo?.agente_id
  const nonce = cuerpo?.nonce
  const firma = cuerpo?.firma as Partial<SignatureEntry> | undefined
  if (
    typeof agenteId !== 'string' || !UUID.test(agenteId) ||
    typeof nonce !== 'string' || !NONCE.test(nonce) ||
    !firma || firma.alg !== 'ed25519' || typeof firma.kid !== 'string' ||
    typeof firma.sig_b64 !== 'string' || !BASE64.test(firma.sig_b64)
  ) {
    return error(400, 'peticion_invalida', 'Se esperan agente_id, nonce y firma {alg: ed25519, kid, sig_b64}')
  }

  // Se consume antes de verificar: una firma mala también gasta el desafío.
  const { data, error: errorRpc } = await supabase.rpc('emisor_consumir_desafio', {
    p_nonce: nonce,
    p_agente_id: agenteId,
  })
  if (errorRpc) {
    console.error('consumir desafío:', errorRpc.code, errorRpc.message)
    return error(500, 'error_interno', 'No se pudo consumir el desafío')
  }
  const fila = data?.[0] as { org_id: string; desafio: PopChallenge; clave_publica: string } | undefined
  if (!fila) return error(401, 'desafio_invalido', 'Desafío inexistente, usado o vencido')
  if (firma.kid !== fila.desafio.kid) {
    return error(401, 'firma_invalida', 'El kid no es el de la clave del agente')
  }

  let valida = false
  try {
    valida = await verifyRegistrationPoP(registro, fila.desafio, firma as SignatureEntry, fila.clave_publica)
  } catch {
    valida = false
  }
  if (!valida) return error(401, 'firma_invalida', 'La firma no corresponde a la clave del agente')

  const ahora = Math.floor(Date.now() / 1000)
  const jwt = await new SignJWT({ role: 'authenticated', org_id: fila.org_id, agente_id: agenteId, tipo: 'agente' })
    .setProtectedHeader({ alg: 'ES256', kid: CLAVE.kid, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setSubject(agenteId)
    .setAudience('authenticated')
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + TOKEN_SEGUNDOS)
    .sign(clavePrivada)
  return json({ access_token: jwt, token_type: 'Bearer', expires_in: TOKEN_SEGUNDOS, expires_at: ahora + TOKEN_SEGUNDOS })
}

Deno.serve(async (req) => {
  const ruta = new URL(req.url).pathname.replace(/^.*?\/emisor-agentes/, '') || '/'
  const cache = { 'cache-control': 'public, max-age=300' }

  if (req.method === 'GET' && ruta === '/.well-known/openid-configuration') return json(documentoOidc(), 200, cache)
  if (req.method === 'GET' && ruta === '/.well-known/jwks.json') return json({ keys: [clavePublica] }, 200, cache)
  if (req.method === 'POST' && ruta === '/desafio') return desafio(req)
  if (req.method === 'POST' && ruta === '/token') return token(req)
  return error(404, 'no_existe', 'Ruta desconocida')
})
