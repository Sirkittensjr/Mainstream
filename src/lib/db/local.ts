import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Driver, QueryOptions, Row, Schema, TableName } from './types';

/**
 * Where the local driver keeps its data.
 *
 * `output: 'standalone'` makes the generated server chdir into
 * .next/standalone before it handles a request, so a plain
 * `process.cwd()/.data` silently resolves to a *different* directory than the
 * one `npm run seed` wrote — the server quietly serves its own auto-seeded
 * copy and every write lands somewhere nobody looks. Resolve back to the
 * project root in that case, and let a host override it outright.
 */
function resolveDataDir(): string {
  const override = process.env.FAYTARRA_DATA_DIR;
  if (override) return path.resolve(override);

  // Serverless platforms ship a read-only bundle with a writable temp dir.
  // Writing there keeps a warm instance working; it is still per-instance and
  // ephemeral, which is why production wants Supabase.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'faytarra-data');
  }

  const cwd = process.cwd();
  const standaloneSuffix = path.join('.next', 'standalone');
  if (cwd.endsWith(standaloneSuffix)) {
    return path.join(cwd.slice(0, -standaloneSuffix.length), '.data');
  }
  return path.join(cwd, '.data');
}

const DATA_DIR = resolveDataDir();
const DB_FILE = path.join(DATA_DIR, 'faytarra.json');
const MEDIA_DIR = path.join(DATA_DIR, 'uploads');

type Store = { [K in TableName]: Schema[K][] };

const EMPTY: Store = {
  users: [],
  posts: [],
  likes: [],
  comments: [],
  follows: [],
  blocks: [],
  challenges: [],
  ratings: [],
  rank_snapshots: [],
  notifications: [],
  reports: [],
  activity: [],
};

/**
 * File backed JSON store. It keeps the whole dataset in memory and serialises
 * writes through a single promise chain, which is plenty for local development
 * and demo deployments. Production swaps in the Supabase driver.
 */
class LocalDriver implements Driver {
  readonly name = 'local' as const;
  private store: Store | null = null;
  private loading: Promise<Store> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private pending: Promise<void> | null = null;
  /** Set once the filesystem has refused a write; we then serve from memory. */
  private persistenceDisabled = false;

  private async load(): Promise<Store> {
    if (this.store) return this.store;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await fs.readFile(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Partial<Store>;
        this.store = { ...structuredClone(EMPTY), ...parsed };
      } catch {
        this.store = structuredClone(EMPTY);
        // First run: populate with sample creators so the app never looks empty.
        const { seedInto } = await import('@/lib/seed/data');
        seedInto(this.store);
        await this.flush();
      }
      return this.store;
    })();
    return this.loading;
  }

  /**
   * Writes are coalesced: a burst (liking, rating, recording impressions for a
   * page of posts) serialises the store once on the next tick instead of once
   * per row.
   */
  private flush(): Promise<void> {
    this.pending ??= new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        this.pending = null;
        const snapshot = JSON.stringify(this.store);
        this.writeChain = this.writeChain
          .then(async () => {
            if (this.persistenceDisabled) return;
            try {
              await fs.mkdir(DATA_DIR, { recursive: true });
              await fs.writeFile(DB_FILE, snapshot, 'utf8');
            } catch (error) {
              // A read-only filesystem must not take the whole site down: keep
              // serving from memory and say so once, loudly.
              this.persistenceDisabled = true;
              console.warn(
                `[faytarra] Cannot write to ${DATA_DIR} (${(error as Error).message}). ` +
                  'Serving from memory only — nothing will be saved. Configure Supabase ' +
                  'to persist data.',
              );
            }
          })
          .then(resolve, reject);
      }, 0);
    });
    return this.pending;
  }

  async query<T extends TableName>(table: T, options: QueryOptions<Row<T>> = {}) {
    const store = await this.load();
    let rows = [...(store[table] as Row<T>[])];
    if (options.where) {
      const entries = Object.entries(options.where) as [keyof Row<T>, unknown][];
      rows = rows.filter((row) => entries.every(([key, value]) => row[key] === value));
    }
    if (options.in) {
      const entries = Object.entries(options.in) as [keyof Row<T>, unknown[]][];
      rows = rows.filter((row) =>
        entries.every(([key, values]) => !values || values.includes(row[key])),
      );
    }
    if (options.orderBy) {
      const key = options.orderBy;
      rows.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av === bv) return 0;
        return (av as never) > (bv as never) ? 1 : -1;
      });
      if (options.desc) rows.reverse();
    }
    if (options.limit != null) rows = rows.slice(0, options.limit);
    return structuredClone(rows);
  }

  async get<T extends TableName>(table: T, id: string) {
    const store = await this.load();
    const row = (store[table] as Row<T>[]).find((r) => (r as { id: string }).id === id);
    return row ? structuredClone(row) : null;
  }

  async insert<T extends TableName>(table: T, row: Row<T>) {
    const store = await this.load();
    (store[table] as Row<T>[]).push(row);
    await this.flush();
    return structuredClone(row);
  }

  async insertMany<T extends TableName>(table: T, rows: Row<T>[]) {
    const store = await this.load();
    (store[table] as Row<T>[]).push(...rows);
    await this.flush();
    return structuredClone(rows);
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const store = await this.load();
    const list = store[table] as Row<T>[];
    const index = list.findIndex((r) => (r as { id: string }).id === id);
    if (index === -1) return null;
    list[index] = { ...list[index], ...patch };
    await this.flush();
    return structuredClone(list[index]);
  }

  async remove<T extends TableName>(table: T, id: string) {
    const store = await this.load();
    const list = store[table] as Row<T>[];
    const index = list.findIndex((r) => (r as { id: string }).id === id);
    if (index !== -1) {
      list.splice(index, 1);
      await this.flush();
    }
  }

  async clear() {
    this.store = structuredClone(EMPTY);
    await this.flush();
  }

  async putMedia(fileName: string, _contentType: string, data: Uint8Array) {
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    await fs.writeFile(path.join(MEDIA_DIR, fileName), data);
    return `/api/media/${fileName}`;
  }
}

/** Survives Next.js hot reloads so dev sessions keep one in-memory copy. */
const globalRef = globalThis as typeof globalThis & { __fayLocalDriver?: LocalDriver };

export function localDriver(): Driver {
  globalRef.__fayLocalDriver ??= new LocalDriver();
  return globalRef.__fayLocalDriver;
}

export const LOCAL_MEDIA_DIR = MEDIA_DIR;
