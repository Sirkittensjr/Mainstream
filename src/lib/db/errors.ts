/**
 * "That table/column is not in this database" as a distinct kind of failure.
 *
 * A query against a relation the database does not have is not a request that
 * went wrong — it is a deployment whose schema is behind the code. The two need
 * to be told apart, because they deserve opposite handling: a genuine query
 * failure should surface loudly, while a feature whose storage was never
 * installed should switch itself off and leave the rest of the app alone.
 *
 * Getting this wrong is expensive. The unread-message badge renders in the
 * navigation, on every signed-in page; when a `messages` query threw a generic
 * Error against a database that predated migration 0003, the whole signed-in
 * site returned 500.
 */
export class MissingRelationError extends Error {
  readonly table: string;
  /** Null when the whole table is missing rather than one column. */
  readonly column: string | null;

  constructor(table: string, column: string | null, message: string) {
    super(message);
    this.name = 'MissingRelationError';
    this.table = table;
    this.column = column;
  }
}

/**
 * Deliberately not `instanceof` alone.
 *
 * The bundler is free to put this module in more than one server chunk, and
 * when it does, the class the driver throws is a different class object from
 * the one the service that catches it imported — `instanceof` is then false
 * and a missing column becomes an unhandled 500 instead of a feature switching
 * itself off. That is exactly what happened to the Top 3 save the first time
 * it met a database without its column, while the same guard one chunk over
 * worked fine. The name is set from a string literal in the constructor and
 * survives minification, so it identifies the error whichever copy built it.
 */
export function isMissingRelation(error: unknown): error is MissingRelationError {
  if (error instanceof MissingRelationError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'MissingRelationError' &&
    typeof (error as { table?: unknown }).table === 'string'
  );
}

/** True when this is a missing COLUMN on the given table, rather than a missing table. */
export function isMissingColumn(error: unknown, table: string, column: string): boolean {
  return isMissingRelation(error) && error.table === table && error.column === column;
}

/**
 * PostgREST's codes for the two cases, plus the underlying Postgres ones for
 * anything that reaches us straight from the database (a trigger, a function).
 *
 *   PGRST205 / 42P01 — the table is not there
 *   PGRST204 / 42703 — the table is, the column is not
 */
const MISSING_TABLE = new Set(['PGRST205', '42P01']);
const MISSING_COLUMN = new Set(['PGRST204', '42703']);

/** The column PostgREST names in `Could not find the 'x' column of 'y' …`. */
function namedColumn(message: string): string | null {
  return /could not find the '([^']+)' column/i.exec(message)?.[1] ?? null;
}

/**
 * Turns a PostgREST error into a `MissingRelationError` when that is what it
 * is, and a plain Error otherwise. Always throws.
 */
export function throwQueryError(
  table: string,
  error: { message: string; code?: string | null },
): never {
  const code = error.code ?? '';
  const text = `[supabase:${table}] ${error.message}`;
  if (MISSING_TABLE.has(code)) throw new MissingRelationError(table, null, text);
  if (MISSING_COLUMN.has(code)) {
    throw new MissingRelationError(table, namedColumn(error.message), text);
  }
  throw new Error(text);
}
