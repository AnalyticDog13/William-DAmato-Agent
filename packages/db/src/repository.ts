import type { z } from "zod";
import { nowIso } from "@william/core";
import type { Db } from "./database";

interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryConfig<T extends BaseRecord> {
  collection: string;
  // Input type is `any` because schemas with .default() accept wider input than T.
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  /** Extracts the owning lead id for timeline/filter queries. */
  leadId?: (item: T) => string | null;
  /** Extracts a status string for filter queries. */
  status?: (item: T) => string | null;
  /** Extracts one secondary sort/filter key (e.g. date, email, gate). */
  skey?: (item: T) => string | null;
  /** Extracts identity keys for exact-match lookup (dedupe, DNC). */
  keys?: (item: T) => string[];
}

export interface ListOptions {
  leadId?: string;
  status?: string;
  skey?: string;
  /** Case-insensitive substring match against the raw JSON. */
  search?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

export class Repository<T extends BaseRecord> {
  constructor(
    private readonly db: Db,
    private readonly config: RepositoryConfig<T>,
  ) {}

  get collection(): string {
    return this.config.collection;
  }

  insert(item: T): T {
    return this.write(this.config.schema.parse(item), "insert");
  }

  /** Validates, bumps updatedAt, and persists. */
  save(item: T): T {
    const next = { ...item, updatedAt: nowIso() };
    return this.write(this.config.schema.parse(next), "upsert");
  }

  private write(item: T, mode: "insert" | "upsert"): T {
    const { collection } = this.config;
    const sql =
      mode === "insert"
        ? `INSERT INTO records (collection, id, lead_id, status, skey, json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        : `INSERT INTO records (collection, id, lead_id, status, skey, json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (collection, id) DO UPDATE SET
             lead_id = excluded.lead_id, status = excluded.status, skey = excluded.skey,
             json = excluded.json, updated_at = excluded.updated_at`;
    this.db
      .prepare(sql)
      .run(
        collection,
        item.id,
        this.config.leadId?.(item) ?? null,
        this.config.status?.(item) ?? null,
        this.config.skey?.(item) ?? null,
        JSON.stringify(item),
        item.createdAt,
        item.updatedAt,
      );
    this.db.prepare(`DELETE FROM record_keys WHERE collection = ? AND id = ?`).run(collection, item.id);
    for (const key of this.config.keys?.(item) ?? []) {
      this.db
        .prepare(`INSERT OR IGNORE INTO record_keys (collection, key, id) VALUES (?, ?, ?)`)
        .run(collection, key, item.id);
    }
    return item;
  }

  get(id: string): T | null {
    const row = this.db
      .prepare(`SELECT json FROM records WHERE collection = ? AND id = ?`)
      .get(this.config.collection, id) as { json: string } | undefined;
    return row ? this.config.schema.parse(JSON.parse(row.json)) : null;
  }

  /** Exact-match lookup by identity key (see RepositoryConfig.keys). */
  findByKey(key: string): T[] {
    const rows = this.db
      .prepare(
        `SELECT r.json FROM record_keys k
         JOIN records r ON r.collection = k.collection AND r.id = k.id
         WHERE k.collection = ? AND k.key = ?`,
      )
      .all(this.config.collection, key) as { json: string }[];
    return rows.map((r) => this.config.schema.parse(JSON.parse(r.json)));
  }

  list(opts: ListOptions = {}): T[] {
    const where: string[] = ["collection = ?"];
    const params: unknown[] = [this.config.collection];
    if (opts.leadId) {
      where.push("lead_id = ?");
      params.push(opts.leadId);
    }
    if (opts.status) {
      where.push("status = ?");
      params.push(opts.status);
    }
    if (opts.skey) {
      where.push("skey = ?");
      params.push(opts.skey);
    }
    if (opts.search) {
      where.push("json LIKE ? COLLATE NOCASE");
      params.push(`%${opts.search}%`);
    }
    const order = opts.order === "asc" ? "ASC" : "DESC";
    const limit = Math.min(opts.limit ?? 100, 1000);
    const offset = opts.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT json FROM records WHERE ${where.join(" AND ")}
         ORDER BY created_at ${order} LIMIT ? OFFSET ?`,
      )
      .all(...(params as never[]), limit, offset) as { json: string }[];
    return rows.map((r) => this.config.schema.parse(JSON.parse(r.json)));
  }

  count(opts: Pick<ListOptions, "leadId" | "status" | "skey"> = {}): number {
    const where: string[] = ["collection = ?"];
    const params: unknown[] = [this.config.collection];
    if (opts.leadId) {
      where.push("lead_id = ?");
      params.push(opts.leadId);
    }
    if (opts.status) {
      where.push("status = ?");
      params.push(opts.status);
    }
    if (opts.skey) {
      where.push("skey = ?");
      params.push(opts.skey);
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where.join(" AND ")}`)
      .get(...(params as never[])) as { n: number };
    return row.n;
  }

  delete(id: string): void {
    this.db
      .prepare(`DELETE FROM records WHERE collection = ? AND id = ?`)
      .run(this.config.collection, id);
    this.db
      .prepare(`DELETE FROM record_keys WHERE collection = ? AND id = ?`)
      .run(this.config.collection, id);
  }
}
