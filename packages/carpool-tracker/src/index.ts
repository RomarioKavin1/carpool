import type Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export * from "./embed.js";
export * from "./rank.js";
export * from "./normalize.js";
export * from "./defaults.js";

const META_TABLE = "tracker_meta";
const MAGNET_TABLE = "tracker_magnet";
const VEC_TABLE = "tracker_vec";

export interface TrackerIndexOptions {
  /** The registry's declared embedding tuple — see GET /.well-known/carpool. */
  model: string;
  dim: number;
}

interface MetaRow {
  model: string;
  dim: number;
}

interface MagnetRow {
  rowid: number;
}

interface SearchRow {
  magnet: string;
  distance: number;
}

/**
 * The vector index: `sqlite-vec`'s `vec0` extension loaded onto the
 * `better-sqlite3` handle this repo already uses elsewhere.
 *
 * `vec0` tables are fixed-dimension, and vectors from different embedding
 * models are not comparable — that's why there is no `embedding_model`
 * column on `artifact` (Task D's registry schema): the tuple belongs to the
 * registry, not to any one artifact. This class is the enforcement point —
 * the tuple it is *opened with* (`opts`, normally read live from
 * `GET /.well-known/carpool`) must match the tuple the database was *built
 * with* (recorded in `tracker_meta` the first time this ran against this
 * file). A mismatch means either the registry changed its embedding model
 * out from under an existing index, or this index file was copied onto the
 * wrong registry — either way, silently proceeding would rank on
 * incomparable vectors, so this throws naming both tuples instead.
 */
export class TrackerIndex {
  private readonly db: Database.Database;
  readonly model: string;
  readonly dim: number;

  constructor(db: Database.Database, opts: TrackerIndexOptions) {
    this.db = db;
    this.model = opts.model;
    this.dim = opts.dim;

    sqliteVec.load(db);

    db.exec(`
      CREATE TABLE IF NOT EXISTS ${META_TABLE} (
        id INTEGER PRIMARY KEY CHECK (id = 0),
        model TEXT NOT NULL,
        dim INTEGER NOT NULL
      );
    `);

    const existing = db.prepare(`SELECT model, dim FROM ${META_TABLE} WHERE id = 0`).get() as MetaRow | undefined;

    if (existing) {
      if (existing.model !== opts.model || existing.dim !== opts.dim) {
        throw new Error(
          `tracker index was opened with embedding tuple (model="${opts.model}", dim=${opts.dim}) but this ` +
            `database was built with (model="${existing.model}", dim=${existing.dim}) — vectors from different ` +
            `embedding models are not comparable; re-embed into a fresh index or point this at the registry ` +
            `that produced it`,
        );
      }
    } else {
      db.prepare(`INSERT INTO ${META_TABLE} (id, model, dim) VALUES (0, ?, ?)`).run(opts.model, opts.dim);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS ${MAGNET_TABLE} (
        rowid INTEGER PRIMARY KEY,
        magnet TEXT NOT NULL UNIQUE
      );
    `);
    // distance_metric=cosine so `search`'s score is a direct function of
    // cosine similarity regardless of whether the caller's vectors happen to
    // be unit-normalised (localEmbedder's are; an injected test embedder's
    // need not be).
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(
        embedding float[${opts.dim}] distance_metric=cosine
      );
    `);
  }

  private toBuffer(vec: Float32Array): Buffer {
    if (vec.length !== this.dim) {
      throw new Error(`vector has ${vec.length} dims, this index was opened with dim=${this.dim}`);
    }
    return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
  }

  private rowidFor(magnet: string): bigint | undefined {
    const row = this.db.prepare(`SELECT rowid FROM ${MAGNET_TABLE} WHERE magnet = ?`).get(magnet) as
      | MagnetRow
      | undefined;
    // vec0's xUpdate rejects a bound rowid unless it arrives as a 64-bit
    // integer value, which better-sqlite3 only guarantees for a JS BigInt —
    // a plain `number` (even an integral one) fails with "Only integers are
    // allows for primary key values", empirically, on every `vec0` INSERT
    // that names `rowid` explicitly. Every rowid this class hands to the vec
    // table is therefore a BigInt from the moment it's read.
    return row === undefined ? undefined : BigInt(row.rowid);
  }

  /** Insert or overwrite the vector for `magnet`. */
  upsert(magnet: string, vec: Float32Array): void {
    const buf = this.toBuffer(vec);
    const existingRowid = this.rowidFor(magnet);

    if (existingRowid !== undefined) {
      // vec0 rows are replaced by delete+insert, not UPDATE.
      this.db.prepare(`DELETE FROM ${VEC_TABLE} WHERE rowid = ?`).run(existingRowid);
      this.db.prepare(`INSERT INTO ${VEC_TABLE} (rowid, embedding) VALUES (?, ?)`).run(existingRowid, buf);
      return;
    }

    const info = this.db.prepare(`INSERT INTO ${MAGNET_TABLE} (magnet) VALUES (?)`).run(magnet);
    this.db
      .prepare(`INSERT INTO ${VEC_TABLE} (rowid, embedding) VALUES (?, ?)`)
      .run(BigInt(info.lastInsertRowid), buf);
  }

  /**
   * Whether `magnet` already has a vector in this index.
   *
   * The repair seam for the one case a publish-time index write cannot cover:
   * artifacts that were stored before this index existed (or by a registry
   * whose index file was lost). A caller that holds the manifests can ask
   * which are missing and re-embed exactly those, instead of re-embedding the
   * whole corpus on every boot.
   */
  has(magnet: string): boolean {
    return this.rowidFor(magnet) !== undefined;
  }

  /** Remove `magnet` from the index. A no-op if it was never indexed. */
  remove(magnet: string): void {
    const rowid = this.rowidFor(magnet);
    if (rowid === undefined) return;
    this.db.prepare(`DELETE FROM ${VEC_TABLE} WHERE rowid = ?`).run(rowid);
    this.db.prepare(`DELETE FROM ${MAGNET_TABLE} WHERE rowid = ?`).run(rowid);
  }

  /**
   * The `k` nearest indexed vectors to `vec`, by cosine similarity.
   * `score` is `1 - cosine_distance` — i.e. cosine similarity itself, in
   * roughly [-1, 1], higher meaning more similar. Ordering, thresholding and
   * everything else in `rank.ts` treats `score` as exactly this.
   */
  search(vec: Float32Array, k: number): { magnet: string; score: number }[] {
    const buf = this.toBuffer(vec);
    const rows = this.db
      .prepare(
        `SELECT ${MAGNET_TABLE}.magnet AS magnet, ${VEC_TABLE}.distance AS distance
         FROM ${VEC_TABLE}
         JOIN ${MAGNET_TABLE} ON ${MAGNET_TABLE}.rowid = ${VEC_TABLE}.rowid
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(buf, k) as SearchRow[];

    return rows.map((r) => ({ magnet: r.magnet, score: 1 - r.distance }));
  }
}
