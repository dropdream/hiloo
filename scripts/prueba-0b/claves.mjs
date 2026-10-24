// Genera la clave de firma de prueba del emisor (ES256) y la deja en supabase/functions/.env.
// Ese archivo está ignorado por git. Para el remoto, la clave va en los secretos de la función.
import { generateKeyPair, exportJWK, calculateJwkThumbprint } from 'jose'
import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// --salida <ruta> escribe en otro archivo (por ejemplo, la clave del remoto para supabase secrets set --env-file).
const indiceSalida = process.argv.indexOf('--salida')
const destino = indiceSalida > 0 ? resolve(process.argv[indiceSalida + 1]) : resolve(raiz, 'supabase', 'functions', '.env')
const issuer = process.env.EMISOR_ISSUER ?? 'http://127.0.0.1:54321/functions/v1/emisor-agentes'

if (existsSync(destino) && !process.argv.includes('--forzar')) {
  console.log(`Ya existe ${destino}; usa --forzar para reemplazarlo.`)
  process.exit(0)
}

const { privateKey } = await generateKeyPair('ES256', { extractable: true })
const jwk = await exportJWK(privateKey)
jwk.kid = await calculateJwkThumbprint(jwk)
jwk.alg = 'ES256'
jwk.use = 'sig'

writeFileSync(destino, [
  '# Clave de prueba del emisor de agentes (solo local, ignorado por git).',
  `EMISOR_ISSUER=${issuer}`,
  `EMISOR_CLAVE_JWK=${JSON.stringify(jwk)}`,
  '',
].join('\n'))
console.log(`Clave ES256 escrita en ${destino} (kid ${jwk.kid.slice(0, 8)}…).`)
