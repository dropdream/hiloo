import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { LanguageCode } from './languages'

// Condición SQL sobre `nodes` que limita la búsqueda a cuadernos o subárboles.
export interface SearchScope {
  where: string
  args: SQLInputValue[]
}

export interface EngineRequest {
  query: string
  languages: LanguageCode[]
  scope: SearchScope
  // Máximo de fragmentos por nota; se aplica antes del límite para que una nota grande no llene la lista.
  perNode: number
}

export interface EngineResult {
  // `chunks.rowid` ordenados de mejor a peor, con orden estable; como mucho 201 y perNode por nota.
  rowids: number[]
  // Opcional: un motor sin términos (p. ej., semántico) no los informa.
  terms?: string[]
  // Detalle de los fragmentos elegidos; sin él, el extracto es el inicio del fragmento.
  explain?(rowids: number[]): { matched: Map<number, string[]>; missing: string[]; excerpts: Map<number, string> }
}

// Un motor solo ordena fragmentos; BrainIndex aplica límites, presupuesto y formato.
// Así otro motor (p. ej., uno semántico instalado aparte) no cambia la CLI ni el contrato JSON.
export interface SearchEngine {
  readonly name: string
  search(request: EngineRequest): EngineResult
}

export type SearchEngineFactory = (db: DatabaseSync) => SearchEngine
