// Sirve el documento OIDC y el JWKS de la clave de prueba desde el host, para que
// `supabase start` los lea con [auth.third_party.workos].issuer_url = http://127.0.0.1:54399.
// La Edge Function sirve lo mismo, pero arranca después del stack, y el stack solo lee el JWKS al iniciar.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = Object.fromEntries(
  readFileSync(resolve(raiz, 'supabase', 'functions', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const puerto = Number(process.env.PUERTO ?? 54399)
const base = `http://127.0.0.1:${puerto}`
const { d: _privada, ...publica } = JSON.parse(env.EMISOR_CLAVE_JWK)

const documentos = {
  '/.well-known/openid-configuration': {
    issuer: env.EMISOR_ISSUER,
    jwks_uri: `${base}/.well-known/jwks.json`,
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
  },
  '/.well-known/jwks.json': { keys: [publica] },
}

createServer((req, res) => {
  const doc = documentos[req.url]
  res.writeHead(doc ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(doc ?? { error: 'no existe' }))
  console.log(`${req.method} ${req.url} → ${doc ? 200 : 404}`)
}).listen(puerto, '127.0.0.1', () => console.log(`Emisor estático en ${base}`))
