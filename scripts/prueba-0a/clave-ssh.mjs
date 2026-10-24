// Conversión de una clave Ed25519 del SDK de DCP (tweetnacl: secreto de 64 bytes =
// semilla || pública) al formato que entienden ssh-add, ssh-keygen y git.
// No reimplementa nada de DCP: solo empaqueta bytes en el formato OpenSSH.
import { randomBytes } from 'node:crypto'

const TIPO = 'ssh-ed25519'

function campo(buf) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(buf.length)
  return Buffer.concat([len, buf])
}

function blobPublico(pub) {
  return Buffer.concat([campo(Buffer.from(TIPO)), campo(pub)])
}

/** Línea de clave pública (`ssh-ed25519 AAAA… comentario`). */
export function lineaPublica(publicKeyB64, comentario = '') {
  const pub = Buffer.from(publicKeyB64, 'base64')
  if (pub.length !== 32) throw new Error(`clave pública Ed25519 de ${pub.length} bytes, se esperaban 32`)
  const linea = `${TIPO} ${blobPublico(pub).toString('base64')}`
  return comentario ? `${linea} ${comentario}` : linea
}

/**
 * Clave privada en formato OPENSSH PRIVATE KEY, sin cifrar, como texto.
 * Pensada para pasarla por stdin a `ssh-add -`; no hace falta escribirla a disco.
 */
export function clavePrivadaOpenSSH(secretKeyB64, comentario = '') {
  const sk = Buffer.from(secretKeyB64, 'base64')
  if (sk.length !== 64) throw new Error(`clave secreta de ${sk.length} bytes, se esperaban 64 (semilla || pública)`)
  const pub = sk.subarray(32)
  const check = randomBytes(4)
  let privado = Buffer.concat([
    check, check,
    campo(Buffer.from(TIPO)),
    campo(pub),
    campo(sk),
    campo(Buffer.from(comentario))
  ])
  const relleno = []
  for (let i = 1; privado.length % 8 !== 0; i++) {
    privado = Buffer.concat([privado, Buffer.from([i])])
  }
  const cuerpo = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    campo(Buffer.from('none')),
    campo(Buffer.from('none')),
    campo(Buffer.alloc(0)),
    Buffer.from([0, 0, 0, 1]),
    campo(blobPublico(pub)),
    campo(privado)
  ])
  const b64 = cuerpo.toString('base64').replace(/(.{70})/g, '$1\n')
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`
}
