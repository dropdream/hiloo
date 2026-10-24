import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './fixtures'
import { BrainIndex } from '../src/main/brain'
import { openDatabase, schemaVersion } from '../src/main/brain/schema'

// Esquema 4 (etapa 1): tablas nuevas de identidad y escritura, sin tocar el índice.
// Siempre sobre bases temporales: la base de la app instalada (%APPDATA%) no se migra en pruebas.

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', 'Las pruebas del esquema usan SQLite del runtime de pruebas.')
})

const tablasV4 = ['organizaciones', 'humanos', 'personas', 'agentes', 'intenciones', 'commits', 'escrituras', 'bloqueos']

function tablas(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((row) => row.name)
}

function version(db: DatabaseSync): number {
  return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
}

// Deja la base como la dejaba hiloo con el esquema 3: sin las tablas nuevas y con user_version 3.
function degradarA3(path: string): void {
  const db = new DatabaseSync(path)
  db.exec(tablasV4.map((name) => `DROP TABLE ${name};`).reverse().join('') + 'PRAGMA user_version = 3')
  db.close()
}

test('una base nueva nace con el esquema 4, sus tablas y una organización local', async ({}, testInfo) => {
  const path = testInfo.outputPath('brain.sqlite')
  const db = openDatabase(path)
  try {
    expect(schemaVersion).toBe(4)
    expect(version(db)).toBe(4)
    expect(tablas(db)).toEqual(expect.arrayContaining(tablasV4))
    const orgs = db.prepare('SELECT id,nombre,tipo FROM organizaciones').all() as { id: string; nombre: string; tipo: string }[]
    expect(orgs).toHaveLength(1)
    expect(orgs[0].tipo).toBe('local')
    expect(orgs[0].id).toMatch(/^[0-9a-f-]{36}$/)
  } finally {
    db.close()
  }
  // Reabrir no crea otra organización ni cambia la versión.
  const again = openDatabase(path)
  try {
    expect(version(again)).toBe(4)
    expect((again.prepare('SELECT count(*) AS n FROM organizaciones').get() as { n: number }).n).toBe(1)
  } finally {
    again.close()
  }
})

test('migrar de 3 a 4 conserva catálogo, fragmentos y relaciones manuales', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(join(root, 'nota.md'), '# Árbol\n\n## Raíces\n\nDecisión persistente.\n')
  const path = testInfo.outputPath('brain.sqlite')
  let index = new BrainIndex(path)
  let notebookId: string
  let noteId: string
  let linkId: string
  try {
    const notebook = await index.registerNotebook(root)
    notebookId = notebook.id
    await index.sync(notebook.id)
    noteId = (await index.search({ query: 'arbol' })).items[0].nodeId
    linkId = (await index.link({ sourceId: notebook.id, targetId: noteId, label: 'Decisiones' })).id
  } finally {
    index.close()
  }
  degradarA3(path)
  const antes = new DatabaseSync(path, { readOnly: true })
  expect(version(antes)).toBe(3)
  expect(tablas(antes)).not.toContain('agentes')
  antes.close()

  // Solo lectura no migra: el MCP de lectura avisa y es la app (o la CLI) quien actualiza.
  expect(() => openDatabase(path, { readOnly: true })).toThrow(/esquema anterior/)

  index = new BrainIndex(path)
  try {
    expect((await index.status()).schemaVersion).toBe(4)
    expect((await index.catalog()).items[0].id).toBe(notebookId)
    expect((await index.sync(notebookId)).changedFiles).toBe(0)
    expect((await index.outline({ nodeId: noteId })).items.map((item) => item.heading)).toEqual(['Árbol', 'Árbol / Raíces'])
    expect((await index.related({ nodeId: notebookId, type: 'manual' })).items[0].linkId).toBe(linkId)
  } finally {
    index.close()
  }
  const despues = new DatabaseSync(path, { readOnly: true })
  try {
    expect(version(despues)).toBe(4)
    expect(tablas(despues)).toEqual(expect.arrayContaining(tablasV4))
    expect((despues.prepare('SELECT count(*) AS n FROM organizaciones').get() as { n: number }).n).toBe(1)
  } finally {
    despues.close()
  }
})

test('las tablas nuevas imponen claves foráneas, unicidad y solo agregar', async ({}, testInfo) => {
  const root = testInfo.outputPath('cuaderno')
  await fs.mkdir(root, { recursive: true })
  const index = new BrainIndex(testInfo.outputPath('brain.sqlite'))
  let notebookId: string
  try {
    notebookId = (await index.registerNotebook(root)).id
  } finally {
    index.close()
  }
  const db = openDatabase(testInfo.outputPath('brain.sqlite'))
  try {
    const ahora = new Date().toISOString()
    const org = (db.prepare('SELECT id FROM organizaciones').get() as { id: string }).id
    const persona = randomUUID()
    db.prepare('INSERT INTO personas(id,org_id,nombre_plantilla,rol,permisos,nivel_max,personalidad,creada_en,actualizada_en) VALUES(?,?,?,?,?,?,NULL,?,?)')
      .run(persona, org, 'Revisor', 'Agente revisor', '{"cuadernos":[],"repos":[],"rutas":[],"nivel_max":"standard"}', 'standard', ahora, ahora)
    expect(() =>
      db.prepare('INSERT INTO personas(id,org_id,nombre_plantilla,rol,permisos,nivel_max,creada_en,actualizada_en) VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), org, 'Revisor', 'Otro', '{}', 'standard', ahora, ahora)
    ).toThrow(/UNIQUE/)
    expect(() =>
      db.prepare('INSERT INTO personas(id,org_id,nombre_plantilla,rol,permisos,nivel_max,creada_en,actualizada_en) VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), org, 'Sin nivel', 'Otro', '{}', 'extremo', ahora, ahora)
    ).toThrow(/CHECK/)

    const agente = randomUUID()
    const insertAgente = db.prepare(
      'INSERT INTO agentes(id,org_id,persona_id,persona_version,nombre,clave_publica,kid,pasaporte,creado_en) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    expect(() => insertAgente.run(agente, org, randomUUID(), 1, 'claude-recibos', 'AAAA', 'kid-1', '{}', ahora)).toThrow(/FOREIGN KEY/)
    insertAgente.run(agente, org, persona, 1, 'claude-recibos', 'AAAA', 'kid-1', '{}', ahora)
    expect(() => insertAgente.run(randomUUID(), org, persona, 1, 'claude-recibos', 'BBBB', 'kid-2', '{}', ahora)).toThrow(/UNIQUE/)
    expect(() => insertAgente.run(randomUUID(), org, persona, 1, 'otro', 'BBBB', 'kid-1', '{}', ahora)).toThrow(/UNIQUE/)

    const intencion = randomUUID()
    db.prepare('INSERT INTO intenciones(id,org_id,agente_id,repo,rama,accion,recurso,nivel,payload,payload_hash,firma,creada_en) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(intencion, org, agente, 'erpcacem', 'feat/x', 'editar', 'notas', 'standard', '{}', 'sha256:00', '{}', ahora)
    expect(() => db.prepare("UPDATE intenciones SET accion='otra' WHERE id=?").run(intencion)).toThrow(/solo agregar/)
    expect(() => db.prepare('DELETE FROM intenciones WHERE id=?').run(intencion)).toThrow(/solo agregar/)

    const insertCommit = db.prepare(
      'INSERT INTO commits(id,org_id,repo,sha,agente_id,intencion_id,fecha_commit,registrado_en) VALUES(?,?,?,?,?,?,?,?)'
    )
    insertCommit.run(randomUUID(), org, 'erpcacem', 'a'.repeat(40), agente, intencion, ahora, ahora)
    expect(() => insertCommit.run(randomUUID(), org, 'erpcacem', 'a'.repeat(40), agente, intencion, ahora, ahora)).toThrow(/UNIQUE/)
    expect(() => insertCommit.run(randomUUID(), org, 'erpcacem', 'b'.repeat(40), agente, randomUUID(), ahora, ahora)).toThrow(/FOREIGN KEY/)

    const escritura = randomUUID()
    db.prepare('INSERT INTO escrituras(id,org_id,notebook_id,ruta,herramienta,cliente,agente_id,hash_despues,creada_en) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(escritura, org, notebookId, 'tareas/nota.md', 'create_note', 'claude-code 2.0', agente, 'c'.repeat(64), ahora)
    expect(() => db.prepare('DELETE FROM escrituras WHERE id=?').run(escritura)).toThrow(/solo agregar/)
    expect(() =>
      db.prepare('INSERT INTO escrituras(id,org_id,notebook_id,ruta,herramienta,cliente,hash_despues,creada_en) VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), org, notebookId, 'x.md', 'delete_note', 'cli', 'd'.repeat(64), ahora)
    ).toThrow(/CHECK/)

    const insertBloqueo = db.prepare(
      'INSERT INTO bloqueos(artefacto_key,org_id,notebook_id,titular_tipo,titular_id,titular_nombre,pid,vence_en,creado_en) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    insertBloqueo.run('c:\\notas\\nota.md', org, notebookId, 'agente', agente, 'claude-recibos', 123, ahora, ahora)
    expect(() => insertBloqueo.run('c:\\notas\\nota.md', org, notebookId, 'app', 'app-1', 'hiloo', 456, ahora, ahora)).toThrow(/UNIQUE/)
    // El bloqueo es un préstamo: se renueva y se suelta.
    expect(db.prepare('DELETE FROM bloqueos WHERE artefacto_key=?').run('c:\\notas\\nota.md').changes).toBe(1)
  } finally {
    db.close()
  }
})
