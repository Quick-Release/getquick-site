// The publication store: the Site's durable last-known-good public content, in
// D1 (migrations/), bound to the Worker as PUBLICATION_DB. It knows rows,
// formats and ordering; what is promoted, and when, is delivery.ts's call.

/** The part of D1's API the store uses, so tests can run the same SQL on SQLite. */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
}

/**
 * The version of the stored body's shape. Bump it, with a parser for the old
 * format or none, when the shape changes: a row in a format this Worker
 * doesn't know is unusable, never misread.
 */
export const PUBLICATION_FORMAT = 1;

export type StoredPublication<T> =
  | { state: "published"; content: T; promotedAt: number }
  | { state: "missing"; promotedAt: number };

export type Promotion<T> = { state: "published"; content: T } | { state: "missing" };

/** Why a stored row can't be served: written in a format, or a shape, this Worker doesn't know. */
export interface Unusable {
  state: "unusable";
  message: string;
}

export interface RefreshAttempt {
  outcome: "promoted" | "superseded" | "kept";
  reason?: string;
  message?: string;
}

/** The store couldn't be read or written. Says nothing about the content. */
export class StoreFailure extends Error {}

interface PublicationRow {
  state: string;
  format: number;
  body: string | null;
  promoted_at: number;
}

export interface PublicationStore {
  /** The row at key, null if nothing was ever promoted there. */
  read<T>(
    key: string,
    parse: (body: unknown) => T | undefined,
  ): Promise<StoredPublication<T> | Unusable | null>;
  /**
   * Replaces the row at key unless a read that started later was already
   * promoted there; "superseded" then, and nothing changes.
   */
  promote<T>(
    key: string,
    publication: Promotion<T>,
    readStartedAt: number,
  ): Promise<"promoted" | "superseded">;
  recordAttempt(key: string, attempt: RefreshAttempt): Promise<void>;
}

async function guard<T>(action: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new StoreFailure(`The publication store couldn't ${action}: ${String(error)}`, {
      cause: error,
    });
  }
}

export function publicationStore(db: SqlDatabase): PublicationStore {
  return {
    async read(key, parse) {
      const row = await guard("be read", () =>
        db
          .prepare("SELECT state, format, body, promoted_at FROM publications WHERE key = ?")
          .bind(key)
          .first<PublicationRow>(),
      );
      if (!row) return null;
      if (row.format !== PUBLICATION_FORMAT) {
        return {
          state: "unusable",
          message: `${key} is stored in format ${row.format}; this Frontend serves format ${PUBLICATION_FORMAT}`,
        };
      }
      if (row.state === "missing") return { state: "missing", promotedAt: row.promoted_at };

      let content: ReturnType<typeof parse>;
      try {
        content = row.state === "published" && row.body ? parse(JSON.parse(row.body)) : undefined;
      } catch {
        content = undefined;
      }
      if (content === undefined) {
        return {
          state: "unusable",
          message: `${key} is stored with a body this Frontend can't read`,
        };
      }
      return { state: "published", content, promotedAt: row.promoted_at };
    },

    async promote(key, publication, readStartedAt) {
      const body = publication.state === "published" ? JSON.stringify(publication.content) : null;
      const result = await guard("be written", () =>
        db
          .prepare(
            `INSERT INTO publications (key, state, format, body, read_started_at, promoted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (key) DO UPDATE SET
               state = excluded.state,
               format = excluded.format,
               body = excluded.body,
               read_started_at = excluded.read_started_at,
               promoted_at = excluded.promoted_at
             WHERE excluded.read_started_at > publications.read_started_at`,
          )
          .bind(key, publication.state, PUBLICATION_FORMAT, body, readStartedAt, Date.now())
          .run(),
      );
      return result.meta.changes > 0 ? "promoted" : "superseded";
    },

    async recordAttempt(key, attempt) {
      await guard("record a refresh", () =>
        db
          .prepare(
            `INSERT INTO refresh_attempts (key, attempted_at, outcome, reason, message)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (key) DO UPDATE SET
               attempted_at = excluded.attempted_at,
               outcome = excluded.outcome,
               reason = excluded.reason,
               message = excluded.message`,
          )
          .bind(key, Date.now(), attempt.outcome, attempt.reason ?? null, attempt.message ?? null)
          .run(),
      );
    },
  };
}
