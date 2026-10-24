// Spike de custodia de la clave del agente (etapa 1, paso 1.0).
// Pregunta: ¿puede el MCP (proceso Node) firmar artefactos DCP sin tener la clave privada?
//   A. Mitad Ed25519 en el servicio ssh-agent de Windows, firmando por su named pipe
//      (protocolo del agente, no ssh-keygen -Y). La firma debe verificar con el SDK de DCP.
//   B. Firmante dedicado: Electron sin ventana con safeStorage (DPAPI) + firma compuesta
//      Ed25519 + ML-DSA-65 en memoria. Mide arranque y firma.
// No toca ~/.ssh ni la configuración de git. Carga una clave temporal en el ssh-agent
// de Windows y la quita al terminar (ssh-add -d). Ver README.md.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { clavePrivadaOpenSSH, lineaPublica } from '../prueba-0a/clave-ssh.mjs'
import { firmar, identidades, publicaDeBlob } from './agente-ssh.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..', '..')
const SDK = '@dcp-ai/sdk@2.1.1'
const WIN_SSH_ADD = 'C:/Windows/System32/OpenSSH/ssh-add.exe'
const args = process.argv.slice(2)
const opt = (n, def) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : def }
const SANDBOX = resolve(opt('--sandbox', join(RAIZ, '.verification', 'etapa-1-custodia')))
const REPETICIONES = Number(opt('--firmas', '20'))
const COMENTARIO = `hiloo-spike-custodia-${Date.now().toString(36)}`

const log = []
const out = (s = '') => { console.log(s); log.push(s) }
const resultados = []
function registra(id, titulo, ok, detalle = '') {
  resultados.push({ id, titulo, ok, detalle })
  out(`  ${ok ? '✓' : '✗'} ${id} ${titulo}${detalle ? '  (' + detalle + ')' : ''}`)
  return ok
}
function run(cmd, cmdArgs, extra = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', windowsHide: true, ...extra })
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error.message) : '') }
}

out('# Spike de custodia: firma DCP sin exponer la clave')
out(`fecha ${new Date().toISOString()} · node ${process.version} · sandbox ${SANDBOX}`)

// --- 0. sandbox y SDK ---------------------------------------------------------
rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })
const dirSdk = join(SANDBOX, 'sdk')
mkdirSync(dirSdk)
// npm es npm.cmd en Windows: hace falta shell, y con shell el comando va en una sola cadena.
const inst = run(`npm install ${SDK} --no-audit --no-fund --prefix "${dirSdk}"`, [], { shell: true })
if (inst.code !== 0) { out(`no se pudo instalar ${SDK}: ${inst.stderr.trim().split('\n').pop()}`); process.exit(2) }
const sdk = await import(pathToFileURL(join(dirSdk, 'node_modules', '@dcp-ai', 'sdk', 'dist', 'index.js')).href)
sdk.registerDefaultProviders()
const registro = sdk.getDefaultRegistry()
out(`${SDK} instalado en la sandbox`)

// --- A. ssh-agent de Windows como firmante Ed25519 -----------------------------
out('\n## A. Mitad Ed25519 en el servicio ssh-agent de Windows')
const servicio = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Service ssh-agent).Status'])
const corre = servicio.stdout.trim() === 'Running'
registra('A0', 'el servicio ssh-agent está en marcha', corre, servicio.stdout.trim() || servicio.stderr.trim())
let limpiar = null
if (corre) {
  const ed = new sdk.Ed25519Provider()
  const kp = await ed.generateKeypair()
  const publica = lineaPublica(kp.publicKeyB64, COMENTARIO)
  const privada = clavePrivadaOpenSSH(kp.secretKeyB64, COMENTARIO)
  // Carga por stdin: la privada nunca se escribe en disco. Después se descarta de este proceso.
  const add = run(WIN_SSH_ADD, ['-'], { input: privada })
  registra('A1', 'la clave Ed25519 del SDK entra al agente por stdin (ssh-add -)', add.code === 0, add.stderr.trim())
  limpiar = () => {
    const ruta = join(SANDBOX, 'spike.pub')
    writeFileSync(ruta, publica + '\n')
    const d = run(WIN_SSH_ADD, ['-d', ruta])
    const quedan = run(WIN_SSH_ADD, ['-L']).stdout.includes(COMENTARIO)
    registra('A9', 'la clave temporal se quitó del agente (ssh-add -d)', d.code === 0 && !quedan, d.stderr.trim())
  }
  try {
    const lista = await identidades()
    const nuestra = lista.find((k) => k.comentario === COMENTARIO)
    registra('A2', 'el protocolo del agente (named pipe) lista la identidad', Boolean(nuestra), `${lista.length} identidades en el agente`)
    if (nuestra) {
      const pubAgente = publicaDeBlob(nuestra.blob)
      registra('A3', 'la pública que publica el agente es la del SDK', pubAgente.equals(Buffer.from(kp.publicKeyB64, 'base64')))

      // Artefacto DCP: intención canónica con separación de dominio, como hace el SDK.
      const intencion = {
        dcp_version: '2.0', intent_id: 'spike-1', session_nonce: sdk.generateSessionNonce(), agent_id: 'agente-spike',
        human_id: 'humano-spike', timestamp: new Date().toISOString(), action_type: 'write_file',
        target: { channel: 'filesystem' }, data_classes: ['none'], estimated_impact: 'low', requires_consent: false
      }
      const { canonicalBytes, payloadHash } = sdk.preparePayload(intencion)
      const mensaje = sdk.domainSeparatedMessage(sdk.DCP_CONTEXTS.Intent, canonicalBytes)
      const t = performance.now()
      const firma = await firmar(nuestra.blob, Buffer.from(mensaje))
      const ms = performance.now() - t
      const valida = await ed.verify(mensaje, firma, kp.publicKeyB64)
      registra('A4', 'el agente firma los bytes DCP crudos y Ed25519Provider.verify del SDK la acepta', valida, `${ms.toFixed(1)} ms`)

      // Misma firma empaquetada como CompositeSignature classical_only y verificada con compositeVerify.
      const kid = sdk.deriveKid('ed25519', pubAgente)
      const compuesta = { classical: { alg: 'ed25519', kid, sig_b64: Buffer.from(firma).toString('base64') }, pq: null, binding: 'classical_only' }
      const envoltorio = { payload: intencion, payload_hash: payloadHash, composite_sig: compuesta }
      const v = await sdk.compositeVerify(registro, sdk.DCP_CONTEXTS.Intent, canonicalBytes, compuesta, kp.publicKeyB64)
      registra('A5', 'empaquetada como SignedPayload classical_only, compositeVerify y verifyPayloadHash la aceptan', v.valid && v.classical_valid && sdk.verifyPayloadHash(envoltorio), `kid ${kid === kp.kid ? 'coincide con el del SDK' : 'NO coincide'}`)

      const alterado = sdk.preparePayload({ ...intencion, estimated_impact: 'high' }).canonicalBytes
      const vAlt = await sdk.compositeVerify(registro, sdk.DCP_CONTEXTS.Intent, alterado, compuesta, kp.publicKeyB64)
      const vCtx = await sdk.compositeVerify(registro, sdk.DCP_CONTEXTS.AuditEvent, canonicalBytes, compuesta, kp.publicKeyB64)
      registra('A6', 'un payload alterado o un contexto distinto no verifican', !vAlt.valid && !vCtx.valid)

      const tiempos = []
      for (let i = 0; i < REPETICIONES; i++) {
        const t1 = performance.now()
        await firmar(nuestra.blob, Buffer.from(mensaje))
        tiempos.push(performance.now() - t1)
      }
      tiempos.sort((a, b) => a - b)
      const mediana = tiempos[Math.floor(tiempos.length / 2)]
      registra('A7', `${REPETICIONES} firmas seguidas por el pipe`, true, `mediana ${mediana.toFixed(1)} ms, máx ${tiempos[tiempos.length - 1].toFixed(1)} ms`)

      // ¿Puede un proceso de usuario leer la clave almacenada por el servicio? (clave en HKLM, ACL de SYSTEM)
      const reg = run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "try { $k = Get-ChildItem 'HKLM:\\SOFTWARE\\OpenSSH\\Agent\\Keys' -ErrorAction Stop; 'LEGIBLE ' + $k.Count } catch { 'DENEGADO ' + $_.Exception.GetType().Name }"])
      const texto = reg.stdout.trim()
      registra('A8', 'un proceso normal del usuario no puede leer las claves almacenadas por el servicio', texto.startsWith('DENEGADO'), texto)
    }
  } finally {
    limpiar?.()
  }
}

// --- B. Firmante dedicado: Electron sin ventana + safeStorage --------------------
out('\n## B. Firmante dedicado (Electron sin ventana, safeStorage = DPAPI, firma compuesta)')
const electronBin = join(RAIZ, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(electronBin)) {
  registra('B0', 'hay un Electron en node_modules', false, 'ejecuta npm ci')
} else {
  const userData = join(SANDBOX, 'userData')
  mkdirSync(userData)
  const archivoClave = join(SANDBOX, 'agente.claves')
  const corridas = []
  for (const vuelta of ['generar y cifrar', 'descifrar y firmar']) {
    const t = Date.now()
    // Electron trata la variable como presente aunque esté vacía: hay que quitarla del entorno.
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const r = run(electronBin, [join(AQUI, 'firmante-electron.cjs'), userData, dirSdk, archivoClave], { env, timeout: 60000 })
    const linea = r.stdout.trim().split('\n').pop() ?? ''
    let datos = null
    try { datos = JSON.parse(linea) } catch { /* sin JSON */ }
    corridas.push({ vuelta, proceso_ms: Date.now() - t, datos, code: r.code, stderr: r.stderr.trim().slice(-200) })
  }
  const [gen, uso] = corridas
  registra('B1', 'Electron sin ventana expone safeStorage y cifra las dos mitades (Ed25519 + ML-DSA-65)', gen.datos?.cifrado_disponible === true && gen.datos?.verifica === true,
    gen.datos ? `listo en ${gen.datos.listo_ms} ms, blob ${gen.datos.blob_bytes} bytes, proceso completo ${gen.proceso_ms} ms` : gen.stderr)
  registra('B2', 'un segundo proceso descifra el blob y firma en compuesto (pq_over_classical)', uso.datos?.verifica === true,
    uso.datos ? `listo en ${uso.datos.listo_ms} ms, descifrar ${uso.datos.descifrado_ms} ms, firma ${uso.datos.firma_compuesta_ms} ms, proceso completo ${uso.proceso_ms} ms` : uso.stderr)
  // Con ELECTRON_RUN_AS_NODE=1 (como corre el MCP hoy) no hay safeStorage: require('electron') es una ruta.
  const comoNode = run(electronBin, ['-e', "console.log(typeof require('electron'))"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  registra('B3', 'con ELECTRON_RUN_AS_NODE=1 (modo del MCP) no existe safeStorage', comoNode.stdout.trim() === 'string', `require('electron') es ${comoNode.stdout.trim()}`)
}

// --- resumen -----------------------------------------------------------------
out('\n## Resumen')
const fallos = resultados.filter((r) => !r.ok)
out(`${resultados.length - fallos.length} de ${resultados.length} comprobaciones en verde${fallos.length ? ': fallan ' + fallos.map((f) => f.id).join(', ') : ''}`)
const salida = opt('--salida', join(SANDBOX, 'informe.md'))
writeFileSync(salida, log.join('\n') + '\n')
out(`informe en ${salida}`)
process.exit(fallos.length ? 1 : 0)
