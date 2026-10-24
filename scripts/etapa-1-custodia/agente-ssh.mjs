// Cliente mínimo del protocolo ssh-agent (draft-miller-ssh-agent) sobre el named pipe
// del servicio OpenSSH de Windows. Solo lista identidades y pide firmas: con eso el
// MCP puede firmar bytes DCP crudos sin que la clave privada salga del servicio.
import { connect } from 'node:net'

export const PIPE_WINDOWS = '\\\\.\\pipe\\openssh-ssh-agent'

const REQUEST_IDENTITIES = 11
const IDENTITIES_ANSWER = 12
const SIGN_REQUEST = 13
const SIGN_RESPONSE = 14
const FAILURE = 5

function campo(buf) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(buf.length)
  return Buffer.concat([len, buf])
}

function leerCampo(buf, pos) {
  const len = buf.readUInt32BE(pos)
  return { valor: buf.subarray(pos + 4, pos + 4 + len), pos: pos + 4 + len }
}

/** Envía un mensaje y devuelve la respuesta completa (sin el prefijo de longitud). */
function intercambio(pipe, cuerpo) {
  return new Promise((resolve, reject) => {
    const socket = connect(pipe)
    const trozos = []
    let esperado = -1
    socket.on('error', reject)
    socket.on('connect', () => socket.write(campo(cuerpo)))
    socket.on('data', (d) => {
      trozos.push(d)
      const todo = Buffer.concat(trozos)
      if (esperado < 0 && todo.length >= 4) esperado = todo.readUInt32BE(0)
      if (esperado >= 0 && todo.length >= 4 + esperado) {
        socket.end()
        resolve(todo.subarray(4, 4 + esperado))
      }
    })
    socket.on('close', () => reject(new Error('el agente cerró la conexión sin responder')))
  })
}

/** Lista las identidades del agente: [{ blob, tipo, comentario }]. */
export async function identidades(pipe = PIPE_WINDOWS) {
  const r = await intercambio(pipe, Buffer.from([REQUEST_IDENTITIES]))
  if (r[0] !== IDENTITIES_ANSWER) throw new Error(`respuesta inesperada ${r[0]}`)
  const n = r.readUInt32BE(1)
  let pos = 5
  const lista = []
  for (let i = 0; i < n; i++) {
    const b = leerCampo(r, pos)
    const c = leerCampo(r, b.pos)
    pos = c.pos
    const tipo = leerCampo(b.valor, 0).valor.toString()
    lista.push({ blob: b.valor, tipo, comentario: c.valor.toString() })
  }
  return lista
}

/**
 * Pide al agente que firme `datos` con la clave `blob`. Para ssh-ed25519 el agente
 * firma los bytes tal cual (PureEdDSA): devuelve la firma cruda de 64 bytes.
 */
export async function firmar(blob, datos, pipe = PIPE_WINDOWS) {
  const cuerpo = Buffer.concat([Buffer.from([SIGN_REQUEST]), campo(blob), campo(datos), Buffer.from([0, 0, 0, 0])])
  const r = await intercambio(pipe, cuerpo)
  if (r[0] === FAILURE) throw new Error('el agente rechazó la firma')
  if (r[0] !== SIGN_RESPONSE) throw new Error(`respuesta inesperada ${r[0]}`)
  const firmaBlob = leerCampo(r, 1).valor
  const tipo = leerCampo(firmaBlob, 0)
  const firma = leerCampo(firmaBlob, tipo.pos).valor
  if (tipo.valor.toString() !== 'ssh-ed25519' || firma.length !== 64) throw new Error('la firma no es ssh-ed25519 de 64 bytes')
  return firma
}

/** Clave pública cruda (32 bytes) a partir del blob ssh-ed25519. */
export function publicaDeBlob(blob) {
  const tipo = leerCampo(blob, 0)
  return leerCampo(blob, tipo.pos).valor
}
