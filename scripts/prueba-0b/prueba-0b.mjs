// Prueba 0b: pide un token al emisor de agentes con una firma DCP y prueba RLS y Realtime.
//
// Uso local:
//   1. node claves.mjs                     (clave de prueba del emisor en supabase/functions/.env)
//   2. node emisor-estatico.mjs            (en otra terminal; JWKS para supabase start)
//   3. supabase start -x logflare,vector   (con [auth.third_party.workos].issuer_url = http://127.0.0.1:54399 y auth0 apagado)
//   4. supabase functions serve --env-file supabase/functions/.env   (en otra terminal)
//   5. node prueba-0b.mjs [--conservar] [--sin-vencimiento]
//
// Variables opcionales: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, EMISOR_URL, PRUEBA_0B_DB_CONTENEDOR.
// Los datos de prueba se crean con psql dentro del contenedor local y se borran al final.
//
// Contra el proyecto remoto (sin acceso a psql): dos pasos.
//   node prueba-0b.mjs --remoto preparar   → guarda claves de agentes en .remoto/claves.json (ignorado) e imprime el SQL
//                                            que la persona ejecuta en el SQL Editor (crea organizaciones, agentes y filas).
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_… node prueba-0b.mjs --remoto
//                                          → corre las comprobaciones que no necesitan SQL. Al final imprime el SQL de limpieza.
import { createClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, SignJWT } from 'jose'
import { Ed25519Provider, generateRegistrationPoP, getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = new Set(process.argv.slice(2))
const REMOTO = args.has('--remoto')
const rutaClavesRemoto = resolve(dirname(fileURLToPath(import.meta.url)), '.remoto', 'claves.json')
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const EMISOR_URL = process.env.EMISOR_URL ?? `${SUPABASE_URL}/functions/v1/emisor-agentes`
const CONTENEDOR = process.env.PRUEBA_0B_DB_CONTENEDOR ?? 'supabase_db_hiloo'
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? (REMOTO ? null : clavePublicableLocal())
if (!PUBLISHABLE_KEY && !args.has('preparar')) {
  console.error('Falta SUPABASE_PUBLISHABLE_KEY')
  process.exit(2)
}

const ORG_A = '0b000000-0000-4000-8000-00000000000a'
const ORG_B = '0b000000-0000-4000-8000-00000000000b'
const AGENTE_A = '0b000000-0000-4000-8000-0000000000aa'
const AGENTE_B = '0b000000-0000-4000-8000-0000000000bb'
const CUADERNO_A = '0b000000-0000-4000-8000-0000000000e1'
const CUADERNO_B = '0b000000-0000-4000-8000-0000000000e2'
const CANAL_A = `org:${ORG_A}:cuaderno:${CUADERNO_A}`
const CANAL_B = `org:${ORG_B}:cuaderno:${CUADERNO_B}`

const resultados = []
function anotar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok, detalle })
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
}

function clavePublicableLocal() {
  const estado = JSON.parse(execSync('supabase status -o json', { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  return estado.PUBLISHABLE_KEY ?? estado.ANON_KEY
}

// SQL como postgres dentro del contenedor local: no hace falta ninguna clave secreta.
function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: texto, encoding: 'utf8' }).trim()
}

async function pedir(ruta, cuerpo) {
  const respuesta = await fetch(`${EMISOR_URL}${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await respuesta.text()
  let datos = null
  try { datos = JSON.parse(texto) } catch { datos = texto }
  return { estado: respuesta.status, datos }
}

async function pedirToken(agente, claveSecreta) {
  const desafio = await pedir('/desafio', { agente_id: agente })
  if (desafio.estado !== 201) return { desafio, token: { estado: 0, datos: { error: 'sin_desafio', desafio: desafio.datos } } }
  const firma = await generateRegistrationPoP(registro, desafio.datos.desafio, 'ed25519', claveSecreta)
  const token = await pedir('/token', { agente_id: agente, nonce: desafio.datos.desafio.nonce, firma })
  return { desafio, token }
}

// accessToken en createClient: supabase-js lo pasa a PostgREST y llama a realtime.setAuth(token) al conectar y en cada latido.
function clienteConToken(token) {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, { accessToken: async () => token, auth: { persistSession: false } })
}

async function leer(cliente, tabla, columna) {
  const { data, error } = await cliente.from(tabla).select(columna)
  if (error) return { error: `${error.code ?? ''} ${error.message}`.trim() }
  return { filas: data.map((f) => f[columna]).sort() }
}

// Suscripción a un canal privado; resuelve con el estado final del join.
// Antes del primer canal se espera a que el token del callback accessToken esté cargado: si no, el primer
// join puede salir con la clave publicable (carrera entre el callback y el join; verificado en los logs de Realtime).
async function suscribir(cliente, tema, alRecibir) {
  await cliente.realtime.setAuth()
  return new Promise((resolver) => {
    const canal = cliente.channel(tema, { config: { private: true } })
    if (alRecibir) canal.on('broadcast', { event: '*' }, alRecibir)
    const temporizador = setTimeout(() => resolver({ canal, estado: 'TIMED_OUT' }), 8000)
    canal.subscribe((estado, err) => {
      if (estado === 'SUBSCRIBED' || estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
        clearTimeout(temporizador)
        resolver({ canal, estado, error: err?.message })
      }
    })
  })
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
function esperarMensaje(buzon, filtro, ms = 8000) {
  return new Promise((resolver) => {
    const inicio = Date.now()
    const revisar = () => {
      const m = buzon.find(filtro)
      if (m) return resolver(m)
      if (Date.now() - inicio > ms) return resolver(null)
      setTimeout(revisar, 100)
    }
    revisar()
  })
}

registerDefaultProviders()
const registro = getDefaultRegistry()
const ed25519 = new Ed25519Provider()

console.log(`Emisor: ${EMISOR_URL}\nSupabase: ${SUPABASE_URL}\n`)

// ── Datos de prueba: dos organizaciones, un agente en cada una, claves DCP generadas aquí ──
const sqlDatos = (pubA, pubB) => `
  delete from public.organizaciones where id in ('${ORG_A}', '${ORG_B}');
  insert into public.organizaciones (id, nombre) values ('${ORG_A}', 'Prueba 0b A'), ('${ORG_B}', 'Prueba 0b B');
  insert into public.agentes (id, org_id, nombre, clave_publica) values
    ('${AGENTE_A}', '${ORG_A}', 'agente-a', '${pubA}'),
    ('${AGENTE_B}', '${ORG_B}', 'agente-b', '${pubB}');
  insert into public.pruebas_0b (org_id, cuaderno_id, texto) values
    ('${ORG_A}', '${CUADERNO_A}', 'fila de A'),
    ('${ORG_B}', '${CUADERNO_B}', 'fila de B 1'),
    ('${ORG_B}', '${CUADERNO_B}', 'fila de B 2');
`
const sqlLimpieza = `delete from public.organizaciones where id in ('${ORG_A}', '${ORG_B}');`

let claveA, claveB
if (REMOTO && args.has('preparar')) {
  claveA = await ed25519.generateKeypair()
  claveB = await ed25519.generateKeypair()
  mkdirSync(dirname(rutaClavesRemoto), { recursive: true })
  writeFileSync(rutaClavesRemoto, JSON.stringify({ claveA, claveB }))
  console.log(`Claves de los agentes de prueba guardadas en ${rutaClavesRemoto} (ignorado por git).\n`)
  console.log('Ejecuta este SQL en el proyecto remoto (SQL Editor) y después corre: node prueba-0b.mjs --remoto\n')
  console.log(sqlDatos(claveA.publicKeyB64, claveB.publicKeyB64))
  process.exit(0)
} else if (REMOTO) {
  if (!existsSync(rutaClavesRemoto)) {
    console.error('Primero: node prueba-0b.mjs --remoto preparar')
    process.exit(2)
  }
  ;({ claveA, claveB } = JSON.parse(readFileSync(rutaClavesRemoto, 'utf8')))
  console.log('Modo remoto: se omiten las comprobaciones que necesitan SQL (aviso desde la base, revocación, variantes de claims).\n')
} else {
  claveA = await ed25519.generateKeypair()
  claveB = await ed25519.generateKeypair()
  sql(sqlDatos(claveA.publicKeyB64, claveB.publicKeyB64))
  console.log('Datos de prueba creados.\n')
}

try {
  // ── 1. Documento OIDC y JWKS del emisor ──
  const oidc = await pedir('/.well-known/openid-configuration')
  anotar('El emisor sirve /.well-known/openid-configuration', oidc.estado === 200 && oidc.datos?.issuer === EMISOR_URL,
    `issuer=${oidc.datos?.issuer}`)
  const jwks = await pedir('/.well-known/jwks.json')
  const claveJwks = jwks.datos?.keys?.[0]
  anotar('El JWKS publica una clave ES256 con kid y sin parte privada',
    jwks.estado === 200 && claveJwks?.kty === 'EC' && claveJwks?.kid && !('d' in claveJwks), `kid=${claveJwks?.kid?.slice(0, 8)}…`)
  const conjuntoClaves = createRemoteJWKSet(new URL(oidc.datos.jwks_uri))

  // ── 2. Token con firma DCP ──
  const a = await pedirToken(AGENTE_A, claveA.secretKeyB64)
  anotar('El desafío trae kid, agent_id, timestamp y nonce', a.desafio.estado === 201 && a.desafio.datos.desafio?.nonce?.length === 64,
    a.desafio.estado === 201 ? `contexto=${a.desafio.datos.contexto}` : `HTTP ${a.desafio.estado} ${JSON.stringify(a.desafio.datos)}`)
  anotar('El emisor entrega un token a cambio de la firma', a.token.estado === 200 && typeof a.token.datos?.access_token === 'string',
    a.token.estado === 200 ? `expires_in=${a.token.datos.expires_in}` : JSON.stringify(a.token.datos))
  const tokenA = a.token.datos?.access_token
  if (!tokenA) throw new Error('Sin token no se puede seguir')

  const cabecera = decodeProtectedHeader(tokenA)
  const claims = decodeJwt(tokenA)
  anotar('El token se verifica con el JWKS del emisor (jose, por descubrimiento OIDC)',
    await jwtVerify(tokenA, conjuntoClaves, { issuer: EMISOR_URL, audience: 'authenticated' }).then(() => true, (e) => e.message))
  anotar('Claims: iss, sub, role, aud, exp, iat, org_id, agente_id, tipo',
    cabecera.alg === 'ES256' && cabecera.kid === claveJwks.kid && claims.role === 'authenticated' && claims.aud === 'authenticated'
      && claims.org_id === ORG_A && claims.agente_id === AGENTE_A && claims.sub === AGENTE_A && claims.tipo === 'agente'
      && claims.exp - claims.iat === 600,
    `alg=${cabecera.alg} vida=${claims.exp - claims.iat}s`)

  const repetido = await pedir('/token', { agente_id: AGENTE_A, nonce: a.desafio.datos.desafio.nonce,
    firma: await generateRegistrationPoP(registro, a.desafio.datos.desafio, 'ed25519', claveA.secretKeyB64) })
  anotar('Un desafío no se usa dos veces', repetido.estado === 401 && repetido.datos?.error === 'desafio_invalido', `HTTP ${repetido.estado}`)

  const firmaAjena = await pedirToken(AGENTE_A, claveB.secretKeyB64)
  anotar('Una firma con otra clave se rechaza', firmaAjena.token.estado === 401 && firmaAjena.token.datos?.error === 'firma_invalida', `HTTP ${firmaAjena.token.estado}`)

  const kidAjeno = await pedir('/desafio', { agente_id: AGENTE_A })
  const firmaKid = await generateRegistrationPoP(registro, kidAjeno.datos.desafio, 'ed25519', claveA.secretKeyB64)
  const conKidAjeno = await pedir('/token', { agente_id: AGENTE_A, nonce: kidAjeno.datos.desafio.nonce, firma: { ...firmaKid, kid: claveB.kid } })
  anotar('Un kid distinto al del pasaporte se rechaza', conKidAjeno.estado === 401, `HTTP ${conKidAjeno.estado}`)

  const desafioAjeno = await pedir('/desafio', { agente_id: AGENTE_B })
  const firmaDesafioAjeno = await generateRegistrationPoP(registro, desafioAjeno.datos.desafio, 'ed25519', claveA.secretKeyB64)
  const cruzado = await pedir('/token', { agente_id: AGENTE_A, nonce: desafioAjeno.datos.desafio.nonce, firma: firmaDesafioAjeno })
  anotar('El desafío de otro agente no sirve', cruzado.estado === 401, `HTTP ${cruzado.estado}`)

  const inexistente = await pedir('/desafio', { agente_id: '0b000000-0000-4000-8000-0000000000ff' })
  anotar('Un agente inexistente no recibe desafío', inexistente.estado === 403, `HTTP ${inexistente.estado}`)
  const malFormado = await pedir('/desafio', { agente_id: 'x' })
  anotar('Una petición mal formada responde 400', malFormado.estado === 400, `HTTP ${malFormado.estado}`)

  const b = await pedirToken(AGENTE_B, claveB.secretKeyB64)
  const tokenB = b.token.datos?.access_token
  anotar('El agente B también recibe su token', typeof tokenB === 'string' && decodeJwt(tokenB).org_id === ORG_B)

  // ── 3. RLS por org_id a través de PostgREST ──
  const clienteA = clienteConToken(tokenA)
  const clienteB = clienteConToken(tokenB)
  const pruebasA = await leer(clienteA, 'pruebas_0b', 'texto')
  anotar('El agente A lee solo las filas de A', JSON.stringify(pruebasA.filas) === JSON.stringify(['fila de A']), JSON.stringify(pruebasA))
  const pruebasB = await leer(clienteB, 'pruebas_0b', 'texto')
  anotar('El agente B lee solo las filas de B', JSON.stringify(pruebasB.filas) === JSON.stringify(['fila de B 1', 'fila de B 2']), JSON.stringify(pruebasB))
  const orgsA = await leer(clienteA, 'organizaciones', 'nombre')
  anotar('El agente A ve solo su organización', JSON.stringify(orgsA.filas) === JSON.stringify(['Prueba 0b A']), JSON.stringify(orgsA))
  const agentesA = await leer(clienteA, 'agentes', 'nombre')
  anotar('El agente A ve solo a los agentes de A', JSON.stringify(agentesA.filas) === JSON.stringify(['agente-a']), JSON.stringify(agentesA))
  const pedidoB = await clienteA.from('pruebas_0b').select('texto').eq('org_id', ORG_B)
  anotar('El agente A no lee filas de B aunque las pida', !pedidoB.error && pedidoB.data.length === 0)
  const humanosA = await leer(clienteA, 'humanos', 'id')
  anotar('El agente no ve humanos', !humanosA.error && humanosA.filas.length === 0, JSON.stringify(humanosA))
  const escritura = await clienteA.from('pruebas_0b').insert({ org_id: ORG_A, cuaderno_id: CUADERNO_A, texto: 'x' })
  anotar('El agente no escribe directo', escritura.error?.code === '42501', escritura.error?.code)
  const sinToken = await createClient(SUPABASE_URL, PUBLISHABLE_KEY).from('pruebas_0b').select('texto')
  anotar('Sin token (anon) no hay acceso', sinToken.error?.code === '42501', sinToken.error?.code)

  // ── 4. Variantes de aud, role e iss, firmadas con la clave local del emisor ──
  const rutaEnv = resolve(raiz, 'supabase', 'functions', '.env')
  if (existsSync(rutaEnv) && !REMOTO) {
    const env = Object.fromEntries(readFileSync(rutaEnv, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    const jwk = JSON.parse(env.EMISOR_CLAVE_JWK)
    const clavePrivada = await importJWK(jwk, 'ES256')
    const firmar = async (claims, { iss = EMISOR_URL, aud, vida = 600 } = {}) => {
      const ahora = Math.floor(Date.now() / 1000)
      let t = new SignJWT({ role: 'authenticated', org_id: ORG_A, agente_id: AGENTE_A, tipo: 'agente', ...claims })
        .setProtectedHeader({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' }).setIssuer(iss).setSubject(AGENTE_A).setIssuedAt(ahora).setExpirationTime(ahora + vida)
      if (aud !== undefined) t = t.setAudience(aud)
      return t.sign(clavePrivada)
    }
    const sinAud = await leer(clienteConToken(await firmar({})), 'pruebas_0b', 'texto')
    anotar('PostgREST acepta un token sin aud', JSON.stringify(sinAud.filas) === JSON.stringify(['fila de A']), JSON.stringify(sinAud))
    const audOtro = await leer(clienteConToken(await firmar({}, { aud: 'otra-audiencia' })), 'pruebas_0b', 'texto')
    anotar('PostgREST acepta un token con aud distinto de authenticated', JSON.stringify(audOtro.filas) === JSON.stringify(['fila de A']), JSON.stringify(audOtro))
    const audLista = await leer(clienteConToken(await firmar({}, { aud: ['uno', 'authenticated'] })), 'pruebas_0b', 'texto')
    anotar('PostgREST acepta un token con aud en lista', JSON.stringify(audLista.filas) === JSON.stringify(['fila de A']), JSON.stringify(audLista))
    const sinRole = await leer(clienteConToken(await firmar({ role: undefined })), 'pruebas_0b', 'texto')
    anotar('Sin claim role la petición corre como anon y no lee', sinRole.error?.includes('42501') ?? false, JSON.stringify(sinRole))
    const roleRaro = await leer(clienteConToken(await firmar({ role: 'postgres' })), 'pruebas_0b', 'texto')
    anotar('Un role que no existe para la API se rechaza', !!roleRaro.error, JSON.stringify(roleRaro))
    const issOtro = await leer(clienteConToken(await firmar({}, { iss: 'https://otro-emisor.example/' })), 'pruebas_0b', 'texto')
    anotar('Supabase no valida iss (misma clave, otro iss, pasa la firma) y la RLS devuelve vacío',
      !issOtro.error && issOtro.filas.length === 0, JSON.stringify(issOtro))
    const orgAjena = await leer(clienteConToken(await firmar({ org_id: ORG_B })), 'pruebas_0b', 'texto')
    anotar('Quien controle la clave del emisor fabrica tokens de cualquier organización (riesgo conocido del diseño)',
      JSON.stringify(orgAjena.filas) === JSON.stringify(['fila de B 1', 'fila de B 2']), JSON.stringify(orgAjena))
    if (!args.has('--sin-vencimiento')) {
      // Realtime cierra el canal cuando vence el token: se prueba con un token de 12 s.
      const corto = await firmar({}, { vida: 12 })
      const clienteCorto = clienteConToken(corto)
      await clienteCorto.realtime.setAuth()
      const cierres = []
      const canalCorto = clienteCorto.channel(CANAL_A, { config: { private: true } })
      const estadoCorto = await new Promise((resolver) => canalCorto.subscribe((estado, err) => {
        if (estado === 'SUBSCRIBED') resolver(estado)
        else if (estado === 'CHANNEL_ERROR' || estado === 'CLOSED') { cierres.push(`${estado}: ${err?.message ?? ''}`); resolver(estado) }
      }))
      anotar('Un token de 12 s abre el canal', estadoCorto === 'SUBSCRIBED', estadoCorto)
      await esperar(16000)
      anotar('Al vencer el token, Realtime cierra el canal (sin resuscripción automática)', cierres.length > 0, cierres.join(' | '))
      await clienteCorto.removeAllChannels()
      clienteCorto.realtime.disconnect()
    }
  } else {
    console.log('(sin la clave local del emisor: se omiten las variantes de aud, role e iss)')
  }

  // ── 5. Realtime: canales privados ──
  // Un setAuth(token) manual se pierde: el cliente de Auth incorporado de supabase-js vuelve a poner su sesión (vacía,
  // o sea la clave publicable) en el siguiente evento de sesión, y los joins siguientes salen como anon (verificado
  // en los logs de Realtime). Por eso los clientes usan accessToken (ver clienteConToken).
  const buzonA = []
  const rtA = clienteConToken(tokenA)
  const subA = await suscribir(rtA, CANAL_A, (m) => buzonA.push(m))
  anotar('El agente A se suscribe al canal privado de su cuaderno con su token', subA.estado === 'SUBSCRIBED', `${subA.estado} ${subA.error ?? ''}`)

  const rtB = clienteConToken(tokenB)
  const subBenA = await suscribir(rtB, CANAL_A)
  anotar('El agente B no puede unirse al canal de A', subBenA.estado === 'CHANNEL_ERROR', `${subBenA.estado} ${subBenA.error ?? ''}`)
  const subB = await suscribir(rtB, CANAL_B)
  anotar('El agente B sí se une a su propio canal', subB.estado === 'SUBSCRIBED', `${subB.estado} ${subB.error ?? ''}`)

  const rtAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const subAnon = await suscribir(rtAnon, CANAL_A)
  anotar('Sin token no se entra a un canal privado', subAnon.estado === 'CHANNEL_ERROR', `${subAnon.estado} ${subAnon.error ?? ''}`)

  const rtA2 = clienteConToken(tokenA)
  const subA2 = await suscribir(rtA2, CANAL_A)
  const envio = await subA2.canal.send({ type: 'broadcast', event: 'saludo', payload: { de: 'A2' } })
  const saludo = await esperarMensaje(buzonA, (m) => m.event === 'saludo')
  anotar('Un broadcast de otro cliente de A llega al agente A', envio === 'ok' && saludo?.payload?.de === 'A2', `send=${envio}`)

  const buzonB = []
  subB.canal.on('broadcast', { event: '*' }, (m) => buzonB.push(m))
  if (!REMOTO) {
    const idNueva = sql(`insert into public.pruebas_0b (org_id, cuaderno_id, texto) values ('${ORG_A}', '${CUADERNO_A}', 'fila avisada') returning id`)
    const aviso = await esperarMensaje(buzonA, (m) => m.event === 'nueva_fila')
    anotar('Broadcast from Database: insertar una fila avisa al canal con id y org_id, sin contenido',
      aviso?.payload?.id === idNueva && aviso?.payload?.org_id === ORG_A && !('texto' in (aviso?.payload ?? {})), JSON.stringify(aviso?.payload))
    sql(`insert into public.pruebas_0b (org_id, cuaderno_id, texto) values ('${ORG_A}', '${CUADERNO_A}', 'otra fila de A')`)
  } else {
    await subA2.canal.send({ type: 'broadcast', event: 'otro', payload: { de: 'A2' } })
  }
  await esperar(1500)
  anotar('El agente B no recibe los mensajes de A', buzonB.length === 0, `mensajes en B: ${buzonB.length}`)

  const rtManual = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } })
  await rtManual.realtime.setAuth(tokenB)
  const unirse = (tema) => new Promise((resolver) => rtManual.channel(tema, { config: { private: true } })
    .subscribe((estado, err) => { if (estado !== 'JOINING') resolver({ estado, error: err?.message }) }))
  const manual1 = await unirse(CANAL_B)
  await esperar(500)
  const manual2 = await unirse(`org:${ORG_B}:cuaderno:0b000000-0000-4000-8000-0000000000e9`)
  anotar('setAuth(token) manual: el primer join entra, pero el cliente de Auth incorporado repone la clave publicable y el siguiente join sale como anon',
    manual1.estado === 'SUBSCRIBED' && manual2.estado === 'CHANNEL_ERROR', `${manual1.estado} → ${manual2.estado}`)

  for (const c of [rtA, rtB, rtAnon, rtA2, rtManual]) { await c.removeAllChannels(); c.realtime.disconnect() }

  // ── 6. Revocación: la siguiente petición de token falla ──
  if (!REMOTO) {
    sql(`update public.agentes set revocado_en = now() where id = '${AGENTE_A}'`)
    const revocado = await pedir('/desafio', { agente_id: AGENTE_A })
    anotar('Un agente revocado no recibe desafío', revocado.estado === 403 && revocado.datos?.error === 'agente_no_vigente', `HTTP ${revocado.estado}`)
    const sigueLeyendo = await leer(clienteA, 'pruebas_0b', 'texto')
    anotar('Hasta que venza su token, el agente revocado sigue leyendo (como dice el diseño)', !sigueLeyendo.error && sigueLeyendo.filas.length > 0)
  }
} finally {
  if (REMOTO) {
    console.log(`\nPara borrar los datos de prueba del remoto: ${sqlLimpieza}`)
  } else if (args.has('--conservar')) {
    console.log('\nDatos de prueba conservados (--conservar).')
  } else {
    sql(sqlLimpieza)
    console.log('\nDatos de prueba borrados.')
  }
}

const fallidas = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - fallidas.length}/${resultados.length} comprobaciones correctas.`)
process.exit(fallidas.length === 0 ? 0 : 1)
