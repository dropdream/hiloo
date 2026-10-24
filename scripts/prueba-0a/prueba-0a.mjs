// Prueba 0a: commits firmados por un agente DCP.
// Clave Ed25519 del SDK de DCP -> ssh-agent -> commit firmado -> git verify-commit
// con allowed_signers (vigencia, cert-authority, revocación). Ver README.md.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { clavePrivadaOpenSSH, lineaPublica } from './clave-ssh.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = resolve(AQUI, '..', '..')
const SDK = '@dcp-ai/sdk@2.1.1'
const AGENTE = 'claude-recibos'
const INTENCION = 'int-0a-' + Date.now().toString(36)
const WIN_SSH = 'C:/Windows/System32/OpenSSH'
const GIT_SSH = 'C:/Program Files/Git/usr/bin'

// --- argumentos ---------------------------------------------------------------
const args = process.argv.slice(2)
const opt = (n, def) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : def }
const flag = (n) => args.includes(n)
if (flag('--ayuda') || flag('-h')) {
  console.log(`uso: node scripts/prueba-0a/prueba-0a.mjs [opciones]
  --agente auto|windows|git|ninguno  qué ssh-agent usar (auto: windows si el servicio corre, si no git)
  --clave sdk|ssh-keygen             origen de las claves del agente y de sesión (default sdk)
  --sandbox <dir>                    carpeta de trabajo (default .verification/prueba-0a)
  --limpiar                          borra la sandbox al terminar
  --salida <archivo>                 guarda el informe también en ese archivo
  --traza                            muestra cada comando ejecutado`)
  process.exit(0)
}
const modoAgente = opt('--agente', 'auto')
const origenClave = opt('--clave', 'sdk')
const SANDBOX = resolve(opt('--sandbox', join(RAIZ_REPO, '.verification', 'prueba-0a')))
const TRAZA = flag('--traza')

// --- utilidades ---------------------------------------------------------------
const log = []
function out(s = '') { console.log(s); log.push(s) }

function run(cmd, cmdArgs, { cwd, env, input, shell } = {}) {
  if (TRAZA) out(`  $ ${cmd} ${cmdArgs.join(' ')}`)
  const r = spawnSync(cmd, cmdArgs, {
    cwd, input, encoding: 'utf8', windowsHide: true, shell: Boolean(shell),
    env: { ...process.env, ...env }
  })
  if (r.error) return { code: -1, stdout: '', stderr: String(r.error.message) }
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const resultados = []
function marca(ok) { return ok ? '✓' : '✗' }
function registra(id, titulo, ok, detalle = '') {
  resultados.push({ id, titulo, ok, detalle })
  out(`  ${marca(ok)} ${id} ${titulo}${detalle ? '  (' + detalle + ')' : ''}`)
  return ok
}

function fechaSsh(d) {
  // formato YYYYMMDDHHMMSSZ de allowed_signers, en UTC
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'
}
function fechaGit(d) { return d.toISOString().replace(/.d{3}Z$/, '+00:00') }
function msysPath(p) { return p.replace(/^([A-Za-z]):/, (_, l) => '/' + l.toLowerCase()).replace(/\\/g, '/') }

// --- 0. herramientas ----------------------------------------------------------
out('# Prueba 0a: firma de commits con clave DCP')
out()
out('## 0. Entorno')
const gitV = run('git', ['--version']).stdout.trim()
const hayWinSsh = existsSync(join(WIN_SSH, 'ssh-keygen.exe'))
const hayGitSsh = existsSync(join(GIT_SSH, 'ssh-keygen.exe'))
const servicio = run('powershell', ['-NoProfile', '-Command',
  "(Get-Service ssh-agent -ErrorAction SilentlyContinue | % { $_.Status.ToString() + '/' + $_.StartType.ToString() })"]).stdout.trim() || 'no existe'
out(`- git: ${gitV}`)
out(`- OpenSSH de Windows: ${hayWinSsh ? run(join(WIN_SSH, 'ssh.exe'), ['-V']).stderr.trim() : 'no está'}`)
out(`- OpenSSH de Git for Windows: ${hayGitSsh ? run(join(GIT_SSH, 'ssh.exe'), ['-V']).stderr.trim() : 'no está'}`)
out(`- servicio ssh-agent de Windows: ${servicio}`)

let agente = modoAgente
if (agente === 'auto') agente = servicio.startsWith('Running') ? 'windows' : (hayGitSsh ? 'git' : 'ninguno')
if (agente === 'windows' && !servicio.startsWith('Running')) {
  out(`- ALTO: el servicio ssh-agent de Windows está "${servicio}". No se habilita desde aquí.`)
  process.exit(2)
}
// Con el agente de Windows hay que usar el ssh-keygen de System32 (habla por el named pipe);
// git por defecto toma el de Git for Windows, que solo entiende SSH_AUTH_SOCK.
const SSHDIR = agente === 'windows' ? WIN_SSH : GIT_SSH
const sshKeygen = join(SSHDIR, 'ssh-keygen.exe')
const sshAdd = join(SSHDIR, 'ssh-add.exe')
out(`- modo de agente: ${agente}; ssh-keygen: ${sshKeygen}`)

// --- 1. sandbox y SDK ---------------------------------------------------------
out()
out('## 1. Sandbox y SDK')
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })
const dirSdk = join(SANDBOX, 'sdk')
const dirClaves = join(SANDBOX, 'claves')
const dirRepo = join(SANDBOX, 'repo')
mkdirSync(dirClaves); mkdirSync(dirRepo)
out(`- sandbox: ${SANDBOX}`)

let sdk = null
let caminoClave = 'ssh-keygen'
if (origenClave === 'sdk') {
  mkdirSync(dirSdk)
  writeFileSync(join(dirSdk, 'package.json'), '{"name":"sandbox-0a","private":true}\n')
  // npm es npm.cmd en Windows: hace falta shell
  const inst = run('npm', ['install', SDK, '--no-audit', '--no-fund', '--prefix', `"${dirSdk}"`], { shell: true })
  if (inst.code === 0) {
    const ruta = join(dirSdk, 'node_modules', '@dcp-ai', 'sdk', 'dist', 'index.js')
    sdk = await import(pathToFileURL(ruta).href)
    caminoClave = 'sdk'
    out(`- ${SDK} instalado en la sandbox (camino A: clave del SDK)`)
  } else {
    out(`- no se pudo instalar ${SDK}: ${inst.stderr.trim().split('\n').pop()}`)
    out('- se sigue con claves de ssh-keygen (camino B)')
  }
} else {
  out('- claves de ssh-keygen por pedido (camino B)')
}

// --- 2. claves ----------------------------------------------------------------
out()
out('## 2. Claves')
const env = {}
let pidAgente = null

// Cada clave: { nombre, pub (línea), priv (texto OpenSSH, solo en memoria), pubFile }
function claveDesdeSdk(nombre) {
  const k = sdk.generateKeypair()
  return { nombre, pub: lineaPublica(k.publicKeyB64, nombre), priv: clavePrivadaOpenSSH(k.secretKeyB64, nombre) }
}
function claveDesdeSshKeygen(nombre) {
  const f = join(dirClaves, nombre)
  const r = run(sshKeygen, ['-q', '-t', 'ed25519', '-N', '', '-C', nombre, '-f', f])
  if (r.code !== 0) throw new Error(`ssh-keygen falló para ${nombre}: ${r.stderr}`)
  const priv = readFileSync(f, 'utf8')
  rmSync(f)
  return { nombre, pub: readFileSync(f + '.pub', 'utf8').trim(), priv }
}
const nuevaClave = (n) => (sdk ? claveDesdeSdk(n) : claveDesdeSshKeygen(n))

const kAgente = nuevaClave(AGENTE)
const kSesion = nuevaClave(AGENTE + '-sesion')
const kIntruso = claveDesdeSshKeygen('intruso')
for (const k of [kAgente, kSesion, kIntruso]) {
  k.pubFile = join(dirClaves, k.nombre + '.pub')
  writeFileSync(k.pubFile, k.pub + '\n')
}
out(`- clave del agente "${AGENTE}" (${caminoClave}), clave de sesión (${caminoClave}), clave intrusa (ssh-keygen)`)

// 2a. ¿la clave DCP es una clave SSH válida? se comprueba con el agente o con ssh-keygen -y
function cargarEnAgente(k, certFile) {
  // Con "-" ssh-add lee la privada por stdin y busca el certificado en "(stdin)-cert.pub"
  // del directorio actual: así entra el certificado sin escribir la privada.
  const certTmp = join(dirClaves, '(stdin)-cert.pub')
  if (certFile) writeFileSync(certTmp, readFileSync(certFile))
  let r = run(sshAdd, ['-t', '1800', '-'], { env, input: k.priv, cwd: dirClaves })
  if (r.code !== 0 && /refused/.test(r.stderr)) {
    // el ssh-agent de Windows (9.5) no acepta vencimiento: se carga sin -t y se quita al final
    sinVencimiento = true
    r = run(sshAdd, ['-'], { env, input: k.priv, cwd: dirClaves })
  }
  if (certFile) rmSync(certTmp, { force: true })
  if (r.code !== 0) throw new Error(`ssh-add falló para ${k.nombre}: ${r.stderr.trim()}`)
  if (certFile && !/Certificate added/.test(r.stdout + r.stderr)) throw new Error(`ssh-add no cargó el certificado de ${k.nombre}: ${r.stderr.trim()}`)
}
let sinVencimiento = false
let dirSock = null
function arrancarAgenteGit() {
  // el socket va al temporal del sistema: las rutas Unix no pasan de 108 caracteres
  dirSock = join(tmpdir(), `hiloo-0a-${process.pid}`)
  mkdirSync(dirSock, { recursive: true })
  const sock = msysPath(join(dirSock, 'agente.sock'))
  const r = run(join(GIT_SSH, 'ssh-agent.exe'), ['-s', '-a', sock])
  const pid = /SSH_AGENT_PID=(\d+)/.exec(r.stdout)?.[1]
  if (r.code !== 0 || !pid) throw new Error(`no arrancó ssh-agent de Git: ${r.stderr}`)
  env.SSH_AUTH_SOCK = sock
  pidAgente = Number(pid)
  out(`- ssh-agent temporal de Git for Windows, pid ${pid}, socket en ${dirSock}`)
}

const privEnDisco = {}
function claveParaFirmar(k) {
  // Devuelve el valor de user.signingKey según el modo
  if (agente !== 'ninguno') return 'key::' + k.pub
  const f = join(dirClaves, k.nombre)
  if (!privEnDisco[f]) { writeFileSync(f, k.priv); privEnDisco[f] = true }
  return f
}

const ahora = new Date()
const serie = String(Date.now() % 1e6)
const certFile = join(dirClaves, kSesion.nombre + '-cert.pub')
const soloClave = (k) => k.pub.split(' ').slice(0, 2).join(' ')

try {
  if (agente === 'git') arrancarAgenteGit()
  if (agente !== 'ninguno') {
    cargarEnAgente(kAgente)
    const lista = run(sshAdd, ['-L'], { env }).stdout
    registra('1', `la clave ${caminoClave === 'sdk' ? 'del SDK de DCP' : 'de ssh-keygen'} entra en el ssh-agent y este publica la misma pública`, lista.includes(soloClave(kAgente)))
  } else {
    const y = run(sshKeygen, ['-y', '-f', claveParaFirmar(kAgente)])
    registra('1', `ssh-keygen -y deriva de la clave ${caminoClave} la misma pública`, y.code === 0 && y.stdout.trim().startsWith(soloClave(kAgente)))
  }

  // 2b. certificado de sesión firmado por la clave del agente (CA)
  const caArgs = agente !== 'ninguno' ? ['-U', '-s', kAgente.pubFile] : ['-s', claveParaFirmar(kAgente)]
  const cert = run(sshKeygen, [...caArgs, '-I', `sesion-${AGENTE}`, '-n', AGENTE, '-z', serie,
    '-V', '-5m:+2h', kSesion.pubFile], { env })
  const hayCert = cert.code === 0 && existsSync(certFile)
  registra('5a', `certificado de sesión emitido con la clave del agente como CA${agente !== 'ninguno' ? ' (CA en el agente, -U)' : ''}`, hayCert, hayCert ? `serie ${serie}, 2 h` : cert.stderr.trim())
  if (!hayCert) throw new Error('sin certificado de sesión no se puede seguir')
  const certLinea = readFileSync(certFile, 'utf8').trim()

  if (agente !== 'ninguno') {
    cargarEnAgente(kSesion, certFile)
    cargarEnAgente(kIntruso)
    const lista = run(sshAdd, ['-L'], { env }).stdout
    // el agente de Windows lista solo el certificado de la clave de sesión; el de Git, clave y certificado
    const todas = [kAgente, kIntruso].every((k) => lista.includes(soloClave(k))) && lista.includes(certLinea.split(' ')[1])
    registra('2a', 'agente, sesión (con su certificado) e intrusa cargadas por stdin con ssh-add, sin archivo privado en claro', todas,
      `agente ${agente}` + (sinVencimiento ? '; el agente rechazó -t, cargadas sin vencimiento' : '; con -t 1800'))
  } else {
    claveParaFirmar(kSesion)
    registra('2a', 'claves en el ssh-agent', false, 'sin agente: las privadas se escribieron en la sandbox')
  }

  // --- 3. repo de prueba ------------------------------------------------------
  out()
  out('## 3. Repo de prueba y commits')
  const git = (a, extra = {}) => run('git', a, { cwd: dirRepo, env: { ...env, ...(extra.env || {}) } })
  git(['init', '-q', '-b', 'main'])
  // Configuración solo del repo de prueba, por worktree como manda el diseño
  git(['config', 'extensions.worktreeConfig', 'true'])
  const cfg = [
    ['user.name', AGENTE], ['user.email', `${AGENTE}@agentes.hiloo.invalid`],
    ['gpg.format', 'ssh'], ['commit.gpgsign', 'true'], ['gpg.ssh.program', sshKeygen],
    ['user.signingKey', claveParaFirmar(kAgente)]
  ]
  for (const [k, v] of cfg) git(['config', '--worktree', k, v])
  const cfgOk = git(['config', '--worktree', '--get', 'user.signingKey']).stdout.trim().startsWith(agente !== 'ninguno' ? 'key::ssh-ed25519' : dirClaves.slice(0, 3))
  registra('2b', 'git config --worktree con gpg.format=ssh, commit.gpgsign y user.signingKey', cfgOk, agente !== 'ninguno' ? 'key::ssh-ed25519 …' : 'ruta de archivo')

  let n = 0
  function commit(nombre, { signingKey, fecha } = {}) {
    writeFileSync(join(dirRepo, 'nota.md'), `cambio ${++n}: ${nombre}\n`)
    git(['add', 'nota.md'])
    const a = []
    if (signingKey) a.push('-c', `user.signingKey=${signingKey}`)
    a.push('commit', '-q', '-S', '-m', nombre, '--trailer', `DCP-Agente: ${AGENTE}`, '--trailer', `DCP-Intencion: ${INTENCION}`)
    const e = fecha ? { GIT_AUTHOR_DATE: fechaGit(fecha), GIT_COMMITTER_DATE: fechaGit(fecha) } : {}
    const r = git(a, { env: e })
    if (r.code !== 0) throw new Error(`commit "${nombre}" falló: ${r.stderr.trim()}`)
    return git(['rev-parse', 'HEAD']).stdout.trim()
  }
  const despues = new Date(ahora.getTime() + 3 * 24 * 3600e3) // después de la vigencia y del certificado
  const cAgente = commit('firmado por el agente')
  const cIntruso = commit('firmado por una clave ajena', { signingKey: claveParaFirmar(kIntruso) })
  const cTarde = commit('firmado por el agente con fecha posterior a la vigencia', { fecha: despues })
  const cSesion = commit('firmado con el certificado de sesión', { signingKey: agente !== 'ninguno' ? 'key::' + certLinea : certFile })
  const cSesionTarde = commit('firmado con el certificado, con fecha posterior a su vencimiento', { signingKey: agente !== 'ninguno' ? 'key::' + certLinea : certFile, fecha: despues })
  const firmados = [cAgente, cIntruso, cTarde, cSesion, cSesionTarde].every((c) => git(['cat-file', '-p', c]).stdout.includes('-----BEGIN SSH SIGNATURE-----'))
  registra('2c', 'cinco commits con firma SSH y trailers DCP-Agente / DCP-Intencion', firmados)

  // --- 4. allowed_signers y verificación ---------------------------------------
  out()
  out('## 4. Verificación con allowed_signers')
  const pubAgente = kAgente.pub.split(' ').slice(0, 2).join(' ')
  const desde = fechaSsh(new Date(ahora.getTime() - 24 * 3600e3))
  const hasta = fechaSsh(new Date(ahora.getTime() + 24 * 3600e3))
  const ayer = fechaSsh(new Date(ahora.getTime() - 3600e3))
  const firmantes = {
    vigente: [
      `${AGENTE} namespaces="git",valid-after="${desde}",valid-before="${hasta}" ${pubAgente}`,
      `${AGENTE} cert-authority,namespaces="git",valid-after="${desde}",valid-before="${hasta}" ${pubAgente}`
    ],
    vencido: [
      `${AGENTE} namespaces="git",valid-after="${desde}",valid-before="${ayer}" ${pubAgente}`,
      `${AGENTE} cert-authority,namespaces="git",valid-after="${desde}",valid-before="${ayer}" ${pubAgente}`
    ]
  }
  const archivos = {}
  for (const [nombre, lineas] of Object.entries(firmantes)) {
    archivos[nombre] = join(SANDBOX, `allowed_signers.${nombre}`)
    writeFileSync(archivos[nombre], lineas.join('\n') + '\n')
  }
  // listas de revocación (KRL): la clave del agente, o el certificado por serie
  const krlAgente = join(SANDBOX, 'revocados-agente.krl')
  run(sshKeygen, ['-q', '-k', '-f', krlAgente, kAgente.pubFile])
  const krlSesion = join(SANDBOX, 'revocados-sesion.krl')
  const spec = join(SANDBOX, 'revocar-sesion.txt')
  writeFileSync(spec, `serial: ${serie}\n`)
  run(sshKeygen, ['-q', '-k', '-f', krlSesion, '-s', kAgente.pubFile, spec])

  function verifica(sha, signers, krl) {
    const a = ['-c', `gpg.ssh.allowedSignersFile=${archivos[signers]}`]
    if (krl) a.push('-c', `gpg.ssh.revocationFile=${krl}`)
    a.push('verify-commit', '--raw', sha)
    const r = git(a)
    const lineas = r.stderr.trim().split('\n').map((l) => l.trim())
    // primero la causa del rechazo; si no hay, la línea "Good ... for <principal>"
    const motivo = lineas.find((l) => /(expired|not yet valid|No principal|no valid principals|Could not verify|revoked|not permitted)/i.test(l))
      || lineas.find((l) => /^Good .* for /.test(l)) || lineas[0] || ''
    return { ok: r.code === 0, motivo: motivo.replace(/^.*allowed_signers\.\w+:\d+: /, '') }
  }
  const espera = (id, titulo, sha, signers, krl, debeAceptar) => {
    const v = verifica(sha, signers, krl)
    registra(id, titulo, v.ok === debeAceptar, (debeAceptar ? 'aceptado: ' : 'rechazado: ') + v.motivo)
  }
  espera('3', 'commit del agente con allowed_signers vigente', cAgente, 'vigente', null, true)
  espera('4a', 'commit firmado por otra clave', cIntruso, 'vigente', null, false)
  espera('4b', 'commit del agente con allowed_signers vencido', cAgente, 'vencido', null, false)
  espera('4c', 'commit del agente fechado después de valid-before', cTarde, 'vigente', null, false)
  espera('4d', 'commit del agente con su clave en la lista de revocación', cAgente, 'vigente', krlAgente, false)
  espera('5b', 'commit con certificado de sesión y cert-authority', cSesion, 'vigente', null, true)
  espera('5c', 'commit con certificado fechado después de su vencimiento', cSesionTarde, 'vigente', null, false)
  espera('5d', 'commit con certificado revocado por serie (KRL de la CA)', cSesion, 'vigente', krlSesion, false)
  espera('5e', 'commit con certificado cuando se revoca la clave del agente (CA)', cSesion, 'vigente', krlAgente, false)
  espera('5f', 'commit con certificado y allowed_signers vencido', cSesion, 'vencido', null, false)

  if (TRAZA) {
    const t = git(['-c', `gpg.ssh.allowedSignersFile=${archivos.vigente}`, 'verify-commit', cAgente], { env: { GIT_TRACE: '1' } })
    out('  traza de git verify-commit:')
    for (const l of t.stderr.split('\n').filter((l) => l.includes('ssh-keygen'))) out('    ' + l.trim())
  }
} finally {
  // --- limpieza ----------------------------------------------------------------
  out()
  out('## Limpieza')
  if (agente === 'windows') {
    for (const k of [kAgente, kSesion, kIntruso]) run(sshAdd, ['-d', k.pubFile], { env })
    out('- claves de prueba quitadas del ssh-agent de Windows')
  } else if (agente === 'git' && pidAgente) {
    run(sshAdd, ['-D'], { env })
    // el pid que da ssh-agent es de cygwin: se mata con ssh-agent -k
    run(join(GIT_SSH, 'ssh-agent.exe'), ['-k'], { env: { ...env, SSH_AGENT_PID: String(pidAgente) } })
    if (dirSock) rmSync(dirSock, { recursive: true, force: true })
    out('- ssh-agent temporal de Git detenido')
  }
  for (const f of Object.keys(privEnDisco)) rmSync(f, { force: true })
  if (flag('--limpiar')) { rmSync(SANDBOX, { recursive: true, force: true }); out('- sandbox borrada') }
  else out('- sandbox conservada (repo, allowed_signers, KRL y públicas; sin privadas)')
}

// --- resumen ------------------------------------------------------------------
out()
out('## Resultado')
const ok = (ids) => ids.every((id) => resultados.find((r) => r.id === id)?.ok)
const puntos = [
  ['1', 'Clave Ed25519 del SDK de DCP usable como clave SSH', ok(['1']) && caminoClave === 'sdk', caminoClave === 'sdk' ? 'camino A: SDK' : 'camino B: ssh-keygen (el SDK no se usó)'],
  ['2', 'Cargada en el ssh-agent de Windows, firma sin clave privada en disco', agente === 'windows' && ok(['2a', '2b', '2c']),
    agente === 'windows' ? 'servicio ssh-agent de Windows' : agente === 'git' ? 'cadena probada con el agente temporal de Git; falta el servicio de Windows' : 'sin agente'],
  ['3', 'git verify-commit acepta con allowed_signers con valid-after/valid-before', ok(['3'])],
  ['4', 'Rechaza otra clave, vigencia vencida, fecha fuera de vigencia y clave revocada', ok(['4a', '4b', '4c', '4d'])],
  ['5', 'Certificado de sesión (cert-authority) verifica y deja de verificar al vencer o revocarse', ok(['5a', '5b', '5c', '5d', '5e', '5f'])]
]
for (const [n, t, v, d] of puntos) out(`${marca(v)} ${n}. ${t}${d ? '  (' + d + ')' : ''}`)
out()
out(`Camino de clave: ${caminoClave}. Agente: ${agente}. ${new Date().toISOString()}`)

const salida = opt('--salida')
if (salida) { mkdirSync(dirname(resolve(salida)), { recursive: true }); writeFileSync(resolve(salida), log.join('\n') + '\n') }
process.exit(puntos.every((p) => p[2]) ? 0 : 1)
