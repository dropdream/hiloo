import type { DatabaseSync } from 'node:sqlite'
import type { EngineRequest, EngineResult, SearchEngine } from './engine'
import { ftsQuery, termMatch } from './query'

// Pesos BM25 por columna: título, encabezado, ruta y cuerpo.
const ranking = "rank MATCH 'bm25(5.0, 3.0, 2.0, 1.0)'"

export class FtsEngine implements SearchEngine {
  readonly name = 'fts5'

  constructor(private readonly db: DatabaseSync) {}

  search({ query, languages, scope, perNode }: EngineRequest): EngineResult {
    const { expression, terms } = ftsQuery(query, languages)
    if (!terms.length) return { rowids: [], terms }
    // El rowid desempata para que las páginas sean estables.
    const rows = this.db.prepare(
      `WITH hits AS (SELECT chunks.rowid AS id,chunks.node_id AS node,rank AS score FROM chunks_fts
        JOIN chunks ON chunks.rowid=chunks_fts.rowid JOIN nodes ON nodes.id=chunks.node_id
        WHERE chunks_fts MATCH ? AND ${scope.where} AND ${ranking})
      SELECT id FROM (SELECT id,score,row_number() OVER (PARTITION BY node ORDER BY score,id) AS n FROM hits)
      WHERE n<=? ORDER BY score,id LIMIT 201`
    ).all(expression, ...scope.args, perNode)
    const explain = (rowids: number[]) => {
      const matched = new Map<number, string[]>(rowids.map((rowid) => [rowid, []]))
      const missing: string[] = []
      const marks = rowids.map(() => '?').join(',')
      const excerpts = new Map<number, string>()
      if (rowids.length) for (const row of this.db.prepare(
        `SELECT rowid,snippet(chunks_fts,3,'','','…',48) AS excerpt FROM chunks_fts WHERE chunks_fts MATCH ? AND rowid IN (${marks})`
      ).all(expression, ...rowids)) excerpts.set(Number(row.rowid), String(row.excerpt))
      for (const term of terms) {
        const match = termMatch(term, languages)
        const hits = rowids.length
          ? this.db.prepare(`SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? AND rowid IN (${marks})`).all(match, ...rowids)
          : []
        for (const hit of hits) matched.get(Number(hit.rowid))?.push(term)
        if (!hits.length && !this.db.prepare(
          `SELECT 1 FROM chunks_fts JOIN chunks ON chunks.rowid=chunks_fts.rowid JOIN nodes ON nodes.id=chunks.node_id
          WHERE chunks_fts MATCH ? AND ${scope.where} LIMIT 1`
        ).get(match, ...scope.args)) missing.push(term)
      }
      return { matched, missing, excerpts }
    }
    return { rowids: rows.map((row) => Number(row.id)), terms, explain }
  }
}
