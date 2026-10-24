// Firmante dedicado de prueba: Electron sin ventana, con safeStorage (DPAPI) para
// descifrar una clave y firmar en memoria. Mide cuánto tarda arrancar y firmar.
// Se lanza con el binario de Electron SIN ELECTRON_RUN_AS_NODE (ahí no hay safeStorage).
// Uso: electron firmante-electron.cjs <userData> <sdk-dir> <archivo-clave-cifrada|nueva>
const { app, safeStorage } = require('electron')
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')

const [userData, sdkDir, archivo] = process.argv.slice(2)
app.setPath('userData', userData)
const t0 = Date.now()

app.whenReady().then(async () => {
  const listo = Date.now() - t0
  const salida = { listo_ms: listo, cifrado_disponible: safeStorage.isEncryptionAvailable() }
  if (!salida.cifrado_disponible) {
    console.log(JSON.stringify(salida))
    salir(2)
    return
  }
  const sdk = await import(pathToFileURL(join(sdkDir, 'node_modules', '@dcp-ai', 'sdk', 'dist', 'index.js')).href)
  sdk.registerDefaultProviders()
  const reg = sdk.getDefaultRegistry()
  let claves
  if (existsSync(archivo)) {
    const t = Date.now()
    claves = JSON.parse(safeStorage.decryptString(readFileSync(archivo)))
    salida.descifrado_ms = Date.now() - t
  } else {
    const ed = await new sdk.Ed25519Provider().generateKeypair()
    const ml = await new sdk.MlDsa65Provider().generateKeypair()
    claves = { classical: { ...ed, alg: 'ed25519' }, pq: { ...ml, alg: 'ml-dsa-65' } }
    const t = Date.now()
    const blob = safeStorage.encryptString(JSON.stringify(claves))
    writeFileSync(archivo, blob)
    salida.cifrado_ms = Date.now() - t
    salida.blob_bytes = blob.length
  }
  const payload = Buffer.from(sdk.canonicalizeV2({ prueba: 'custodia', n: 1 }))
  const t = Date.now()
  const firma = await sdk.compositeSign(reg, sdk.DCP_CONTEXTS.Intent, payload, claves)
  salida.firma_compuesta_ms = Date.now() - t
  salida.verifica = (await sdk.compositeVerify(reg, sdk.DCP_CONTEXTS.Intent, payload, firma, claves.classical.publicKeyB64, claves.pq.publicKeyB64)).valid
  salida.total_ms = Date.now() - t0
  // Las claves privadas no se imprimen nunca; solo tamaños y tiempos.
  console.log(JSON.stringify(salida))
  salir(0)
}).catch((error) => {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  salir(3)
})

// app.exit() corta antes de que Electron escriba Local State (donde guarda la clave
// DPAPI de safeStorage): el siguiente proceso no podría descifrar. Hay que salir con quit().
function salir(codigo) {
  process.exitCode = codigo
  app.quit()
}
