import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export const schemaVersion = 4

export function openDatabase(path: string, options: { readOnly?: boolean } = {}): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 150, enableForeignKeyConstraints: true, allowExtension: false, readOnly: options.readOnly === true })
  try {
    // Solo lectura: no migra ni cambia el modo de diario de una base que usa la app.
    if (options.readOnly) {
      db.exec('PRAGMA busy_timeout = 150; PRAGMA query_only = ON')
      const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
      if (version > schemaVersion) throw new Error('El índice pertenece a una versión más reciente de hiloo.')
      if (version < schemaVersion) throw new Error('El índice usa un esquema anterior. Abre un cuaderno en hiloo para actualizarlo.')
      return db
    }
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 150; PRAGMA cache_size = -4096; PRAGMA wal_autocheckpoint = 1000')
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
    if (version > schemaVersion) throw new Error('El índice pertenece a una versión más reciente de hiloo.')
    if (version === 0) {
      db.exec('BEGIN IMMEDIATE')
      // Otro proceso puede haber creado el esquema mientras esperábamos.
      if (Number(db.prepare('PRAGMA user_version').get()!.user_version) === 0) db.exec(`
        CREATE TABLE notebooks (
          id TEXT PRIMARY KEY, root TEXT NOT NULL, root_key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', indexed_at TEXT,
          generation INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE nodes (
          id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id),
          parent_id TEXT REFERENCES nodes(id), kind TEXT NOT NULL CHECK(kind IN ('notebook','folder','note')),
          path TEXT NOT NULL, path_key TEXT NOT NULL, absolute_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL, source_hash TEXT, indexed_at TEXT, modified_at REAL,
          byte_size INTEGER, seen_generation INTEGER NOT NULL DEFAULT 0,
          deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
          UNIQUE(notebook_id,path_key)
        ) STRICT;
        CREATE INDEX nodes_parent ON nodes(parent_id,deleted);
        CREATE INDEX nodes_notebook ON nodes(notebook_id,deleted,kind);
        CREATE TABLE chunks (
          rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
          node_id TEXT NOT NULL REFERENCES nodes(id), ordinal INTEGER NOT NULL,
          title TEXT NOT NULL, heading TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL,
          start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
          source_hash TEXT NOT NULL, chunk_hash TEXT NOT NULL,
          parser_version INTEGER NOT NULL, chunk_version INTEGER NOT NULL,
          UNIQUE(node_id,ordinal)
        ) STRICT;
        CREATE VIRTUAL TABLE chunks_fts USING fts5(title,heading,path,body,content='chunks',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');
        CREATE TRIGGER chunks_insert AFTER INSERT ON chunks BEGIN
          INSERT INTO chunks_fts(rowid,title,heading,path,body) VALUES(new.rowid,new.title,new.heading,new.path,new.body);
        END;
        CREATE TRIGGER chunks_delete AFTER DELETE ON chunks BEGIN
          INSERT INTO chunks_fts(chunks_fts,rowid,title,heading,path,body) VALUES('delete',old.rowid,old.title,old.heading,old.path,old.body);
        END;
        CREATE TABLE links (
          id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES nodes(id),
          target_id TEXT REFERENCES nodes(id), target_key TEXT NOT NULL, fragment TEXT,
          source_hash TEXT NOT NULL, reason TEXT,
          UNIQUE(source_id,target_key,fragment)
        ) STRICT;
        CREATE INDEX links_source ON links(source_id);
        CREATE INDEX links_target ON links(target_id);
        CREATE INDEX links_target_key ON links(target_key);
        CREATE TABLE manual_links (
          id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES nodes(id),
          target_id TEXT NOT NULL REFERENCES nodes(id), label TEXT NOT NULL,
          created_at TEXT NOT NULL, UNIQUE(source_id,target_id,label)
        ) STRICT;
        CREATE INDEX manual_source ON manual_links(source_id);
        CREATE INDEX manual_target ON manual_links(target_id);
        CREATE TABLE jobs (
          notebook_id TEXT PRIMARY KEY REFERENCES notebooks(id), state TEXT NOT NULL,
          owner_pid INTEGER, owner_token TEXT, heartbeat INTEGER NOT NULL DEFAULT 0,
          generation INTEGER NOT NULL DEFAULT 0, changed_files INTEGER NOT NULL DEFAULT 0,
          error TEXT
        ) STRICT;
        PRAGMA user_version = 1;`)
      db.exec('COMMIT')
    }
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) < 2) {
      db.exec('BEGIN IMMEDIATE')
      if (Number(db.prepare('PRAGMA user_version').get()!.user_version) < 2) {
        db.exec(`ALTER TABLE nodes ADD COLUMN links_partial INTEGER NOT NULL DEFAULT 0 CHECK(links_partial IN (0,1));
          UPDATE nodes SET source_hash=NULL WHERE kind='note';
          PRAGMA user_version = 2;`)
      }
      db.exec('COMMIT')
    }
    // El idioma solo cambia la consulta: no hace falta reindexar ni tocar identidades.
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) < 3) {
      db.exec('BEGIN IMMEDIATE')
      if (Number(db.prepare('PRAGMA user_version').get()!.user_version) < 3) {
        db.exec(`ALTER TABLE notebooks ADD COLUMN language TEXT NOT NULL DEFAULT 'auto';
          ALTER TABLE notebooks ADD COLUMN detected_language TEXT;
          PRAGMA user_version = 3;`)
      }
      db.exec('COMMIT')
    }
    // Etapa 1 (identidad y escritura local): solo tablas nuevas, no toca las existentes ni el índice.
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) < 4) {
      db.exec('BEGIN IMMEDIATE')
      if (Number(db.prepare('PRAGMA user_version').get()!.user_version) < 4) {
        // Idempotente: una base degradada a mano puede conservar las tablas.
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='organizaciones'").get()) db.exec(schemaV4)
        // Una organización local por base; en la etapa 3 se reemplaza por la remota.
        if (!db.prepare('SELECT 1 FROM organizaciones LIMIT 1').get())
          db.prepare("INSERT INTO organizaciones(id,nombre,tipo,creada_en) VALUES(?,?,'local',?)")
            .run(randomUUID(), 'Organización local', new Date().toISOString())
        db.exec('PRAGMA user_version = 4')
      }
      db.exec('COMMIT')
    }
    return db
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.close()
    throw error
  }
}

// Esquema 4: identidad DCP y escritura local (docs/etapa-1-contrato.md). Fechas ISO 8601 en UTC,
// ids UUID en texto, JSON en columnas TEXT. Las tablas con org_id calcan la sección 8 del diseño
// para subir a Supabase sin traducciones. intenciones, commits y escrituras son de solo agregar.
const schemaV4 = `
  CREATE TABLE organizaciones (
    id TEXT PRIMARY KEY, nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('local','remota')), creada_en TEXT NOT NULL
  ) STRICT;
  CREATE TABLE humanos (
    id TEXT PRIMARY KEY, auth0_sub TEXT UNIQUE, nombre TEXT NOT NULL, creado_en TEXT NOT NULL
  ) STRICT;
  CREATE TABLE personas (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizaciones(id),
    nombre_plantilla TEXT NOT NULL, rol TEXT NOT NULL,
    permisos TEXT NOT NULL,
    nivel_max TEXT NOT NULL CHECK(nivel_max IN ('routine','standard','elevated','maximum')),
    personalidad TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    firma_admin TEXT, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL,
    UNIQUE(org_id,nombre_plantilla), UNIQUE(id,org_id)
  ) STRICT;
  CREATE TABLE agentes (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizaciones(id),
    persona_id TEXT NOT NULL, persona_version INTEGER NOT NULL,
    nombre TEXT NOT NULL, avatar TEXT, color TEXT, restricciones TEXT,
    responsable_id TEXT REFERENCES humanos(id),
    clave_publica TEXT NOT NULL, kid TEXT NOT NULL UNIQUE,
    clave_pq_publica TEXT, kid_pq TEXT,
    pasaporte TEXT NOT NULL,
    secreto_hash TEXT,
    org_origen TEXT, emitido_por TEXT, firma_emision TEXT,
    vence_en TEXT, revocado_en TEXT, revocado_desde TEXT, revocado_motivo TEXT,
    creado_en TEXT NOT NULL,
    FOREIGN KEY(persona_id,org_id) REFERENCES personas(id,org_id),
    UNIQUE(org_id,nombre), UNIQUE(id,org_id)
  ) STRICT;
  CREATE INDEX agentes_org ON agentes(org_id,revocado_en);
  CREATE TABLE intenciones (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, agente_id TEXT NOT NULL,
    repo TEXT, rama TEXT, accion TEXT NOT NULL, recurso TEXT NOT NULL,
    nivel TEXT NOT NULL CHECK(nivel IN ('routine','standard','elevated','maximum')),
    payload TEXT NOT NULL, payload_hash TEXT NOT NULL, firma TEXT NOT NULL,
    creada_en TEXT NOT NULL,
    FOREIGN KEY(agente_id,org_id) REFERENCES agentes(id,org_id), UNIQUE(id,org_id)
  ) STRICT;
  CREATE INDEX intenciones_agente ON intenciones(org_id,agente_id,creada_en);
  CREATE INDEX intenciones_rama ON intenciones(repo,rama);
  CREATE TABLE commits (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, repo TEXT NOT NULL, sha TEXT NOT NULL,
    patch_id TEXT, rama TEXT, agente_id TEXT NOT NULL, intencion_id TEXT,
    fecha_commit TEXT NOT NULL, registrado_en TEXT NOT NULL, firma TEXT,
    FOREIGN KEY(agente_id,org_id) REFERENCES agentes(id,org_id),
    FOREIGN KEY(intencion_id,org_id) REFERENCES intenciones(id,org_id),
    UNIQUE(repo,sha), UNIQUE(id,org_id)
  ) STRICT;
  CREATE INDEX commits_intencion ON commits(intencion_id);
  CREATE INDEX commits_agente ON commits(org_id,agente_id,registrado_en);
  CREATE TABLE escrituras (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id), node_id TEXT REFERENCES nodes(id),
    ruta TEXT NOT NULL,
    herramienta TEXT NOT NULL CHECK(herramienta IN ('create_note','replace_section','append_section')),
    cliente TEXT NOT NULL, agente_id TEXT, intencion_id TEXT,
    hash_antes TEXT, hash_despues TEXT NOT NULL, firma TEXT, creada_en TEXT NOT NULL,
    FOREIGN KEY(agente_id,org_id) REFERENCES agentes(id,org_id),
    FOREIGN KEY(intencion_id,org_id) REFERENCES intenciones(id,org_id),
    UNIQUE(id,org_id)
  ) STRICT;
  CREATE INDEX escrituras_nota ON escrituras(node_id,creada_en);
  CREATE INDEX escrituras_agente ON escrituras(org_id,agente_id,creada_en);
  CREATE TABLE bloqueos (
    artefacto_key TEXT PRIMARY KEY, org_id TEXT NOT NULL,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id),
    titular_tipo TEXT NOT NULL CHECK(titular_tipo IN ('app','agente')),
    titular_id TEXT NOT NULL, titular_nombre TEXT NOT NULL, pid INTEGER,
    vence_en TEXT NOT NULL, creado_en TEXT NOT NULL
  ) STRICT;
  CREATE INDEX bloqueos_vence ON bloqueos(vence_en);
  CREATE TRIGGER intenciones_solo_agregar_u BEFORE UPDATE ON intenciones BEGIN SELECT RAISE(ABORT,'intenciones es de solo agregar'); END;
  CREATE TRIGGER intenciones_solo_agregar_d BEFORE DELETE ON intenciones BEGIN SELECT RAISE(ABORT,'intenciones es de solo agregar'); END;
  CREATE TRIGGER commits_solo_agregar_u BEFORE UPDATE ON commits BEGIN SELECT RAISE(ABORT,'commits es de solo agregar'); END;
  CREATE TRIGGER commits_solo_agregar_d BEFORE DELETE ON commits BEGIN SELECT RAISE(ABORT,'commits es de solo agregar'); END;
  CREATE TRIGGER escrituras_solo_agregar_u BEFORE UPDATE ON escrituras BEGIN SELECT RAISE(ABORT,'escrituras es de solo agregar'); END;
  CREATE TRIGGER escrituras_solo_agregar_d BEFORE DELETE ON escrituras BEGIN SELECT RAISE(ABORT,'escrituras es de solo agregar'); END;
`
