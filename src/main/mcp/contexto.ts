import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { envAgente, envBase, envEscritura, type CodigoErrorMcp, type ErrorMcp } from '../../shared/dcp'
import { BrainIndex } from '../brain'
import { bounded } from '../brain/output'

// Punto único que comparten los grupos de herramientas del MCP (lectura, escritura, identidad,
// firma): configuración, acceso al Cerebro y formato de respuestas. Cada grupo se registra
// desde brain-mcp.ts con registrarX(server, contexto); así ningún frente edita el de otro.

export interface ConfiguracionMcp {
  dbPath: string
  // Agente con el que corre el MCP (HILOO_AGENTE o --agente); null = MCP sin identidad.
  agenteId: string | null
  // Cuadernos con escritura habilitada (HILOO_ESCRITURA o --escritura, ids separados por coma).
  cuadernosEscritura: ReadonlySet<string>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const uso = `Uso: brain-mcp [--db <ruta>] [--agente <id>] [--escritura <id,id>]. ${envBase}, ${envAgente} y ${envEscritura} también configuran.\n`

// Error con código del contrato: el cliente MCP recibe { error, codigo, detalle }.
export class McpError extends Error {
  constructor(
    readonly codigo: CodigoErrorMcp,
    message: string,
    readonly detalle?: ErrorMcp['detalle']
  ) {
    super(message)
  }
}

export function configurar(argv: string[], env: NodeJS.ProcessEnv): ConfiguracionMcp {
  const opciones = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) {
    const nombre = argv[i]
    const valor = argv[i + 1]
    if (!['--db', '--agente', '--escritura'].includes(nombre) || !valor || opciones.has(nombre)) throw new Error(uso)
    opciones.set(nombre, valor)
  }
  const directory = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  const dbPath = resolve(opciones.get('--db') ?? env[envBase] ?? join(directory, 'hiloo', 'brain.sqlite'))
  const agenteId = opciones.get('--agente') ?? env[envAgente] ?? null
  if (agenteId !== null && !uuid.test(agenteId)) throw new Error(`${envAgente} debe ser el id (UUID) de un agente registrado en Hiloo.\n`)
  const lista = (opciones.get('--escritura') ?? env[envEscritura] ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  if (lista.some((id) => !uuid.test(id))) throw new Error(`${envEscritura} admite ids de cuaderno (UUID) separados por coma.\n`)
  return { dbPath, agenteId, cuadernosEscritura: new Set(lista) }
}

export class ContextoMcp {
  private reader: BrainIndex | null = null

  constructor(readonly config: ConfiguracionMcp) {}

  // Se abre al primer uso: el servidor arranca aunque la base todavía no exista.
  index(): BrainIndex {
    if (this.reader) return this.reader
    if (!existsSync(this.config.dbPath))
      throw new Error(`No existe la base de Cerebro en ${this.config.dbPath}. Abre un cuaderno en hiloo o define ${envBase}.`)
    this.reader = new BrainIndex(this.config.dbPath, { readOnly: true })
    return this.reader
  }

  // Conexión de escritura aparte; quien la abre la cierra.
  writer(): BrainIndex {
    if (!existsSync(this.config.dbPath)) this.index()
    return new BrainIndex(this.config.dbPath)
  }

  async requireNotebooks(): Promise<void> {
    if (!(await this.index().catalog({ limit: 1 })).items.length)
      throw new Error('No hay cuadernos registrados en Cerebro. Abre una carpeta como cuaderno en hiloo.')
  }

  failure(error: unknown): CallToolResult {
    const message = error instanceof Error ? error.message : 'No se pudo consultar Cerebro.'
    const body: Partial<ErrorMcp> = { error: message.slice(0, 400) }
    if (error instanceof McpError) {
      body.codigo = error.codigo
      if (error.detalle) body.detalle = error.detalle
    }
    return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true }
  }

  async respond(maxChars: number, action: () => Promise<unknown>): Promise<CallToolResult> {
    try {
      const { text, overflow } = bounded(await action(), maxChars, 'Aumenta maxChars o pide menos elementos.')
      return { content: [{ type: 'text', text }], ...(overflow ? { isError: true } : {}) }
    } catch (error) {
      return this.failure(error)
    }
  }
}
