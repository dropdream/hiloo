import { DatabaseSync } from 'node:sqlite'

export const schemaVersion = 2

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 150, enableForeignKeyConstraints: true, allowExtension: false })
  try {
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
    return db
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.close()
    throw error
  }
}
